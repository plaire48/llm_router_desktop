const MAX_ERROR_BYTES = 16 * 1024;

async function responseSummary(response, token) {
  const reader = response.body?.getReader();
  if (!reader) return '응답 본문이 없습니다.';
  let timer;
  try {
    const text = await Promise.race([
      (async () => {
        const decoder = new TextDecoder();
        let size = 0, result = '';
        while (true) {
          const {done, value} = await reader.read();
          if (done) return result + decoder.decode();
          size += value.byteLength;
          if (size > MAX_ERROR_BYTES) throw new Error('size');
          result += decoder.decode(value, {stream: true});
        }
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 1500); }),
    ]);
    if (!text.trim()) return '응답 본문이 없습니다.';
    if (/^\s*</.test(text)) return 'HTML 응답입니다. JSON 오류 메시지가 없습니다.';
    let body;
    try { body = JSON.parse(text); } catch { return 'JSON 오류 메시지를 확인할 수 없습니다.'; }
    if (typeof body?.message !== 'string' || !body.message.trim()) return 'JSON 응답에 오류 메시지가 없습니다.';
    // Display only the top-level message, excluding raw payloads, HTML and
    // credential echoes. Limit response size and waiting time even on failure.
    const message = body.message;
    const tokenForms = token ? [String(token), encodeURIComponent(token), btoa(String(token))] : [];
    if (tokenForms.some(value => value && message.includes(value)) || /(?:authorization|set-cookie|cookie|(?:access[_-]?|refresh[_-]?)?token|client[_-]?secret|password)["']?\s*[:=]|\b(?:Bearer|Basic)\s+\S+|\bgh[pousr]_[\w]+|\bgithub_pat_[\w]+/i.test(message)) {
      return '인증 정보가 포함된 오류 메시지는 표시하지 않습니다.';
    }
    if (/<\/?[a-z][^>]*>/i.test(message)) return 'HTML이 포함된 오류 메시지는 표시하지 않습니다.';
    return message.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
  } catch (error) {
    return error.message === 'size' ? '응답 본문이 커서 오류 메시지를 생략했습니다.' : '응답 본문을 읽지 못했습니다.';
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

export async function githubReadFailure(response, {path, ref, url, token, body = false}) {
  const requestId = response.headers.get('x-github-request-id');
  const safeId = /^[a-z\d:_-]{1,128}$/i.test(requestId || '') && requestId !== token ? requestId : null;
  const requestUrl = new URL(url);
  requestUrl.username = ''; requestUrl.password = '';
  const summary = await responseSummary(response, token);
  const guidance = response.status === 401
    ? '로그인 인증이 거부되었습니다. 로그아웃 후 다시 로그인하세요.'
    : response.status >= 500 ? '다시 불러와도 실패하면 오류 정보를 담당자에게 전달하세요.' : '';
  const message = `GHES 마스터 ${body ? '본문 ' : ''}조회 실패: HTTP ${response.status}\n${path}${ref ? ` (${ref})` : ''}${guidance ? `\n${guidance}` : ''}\n서버 응답: ${summary}\n요청 주소: ${requestUrl.href}${safeId ? `\n요청 ID: ${safeId}` : ''}`;
  return Object.assign(new Error(message), {
    status: response.status, path, ref, requestUrl: requestUrl.href, requestId: safeId,
    diagnosticText: `${message}\n요청 방식: GET\n확인 시각: ${new Date().toISOString()}`,
  });
}
