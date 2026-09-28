import { createServer } from 'node:http';
import { execFile } from 'node:child_process';

const ORIGIN = 'https://aipro.sdsdev.co.kr';
export function openLoginBrowser(url) {
  return new Promise((resolve, reject) => {
    const executable = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
    execFile(executable, args, error => error ? reject(new Error('로그인 브라우저를 열지 못했습니다.')) : resolve());
  });
}
async function json(response) {
  if (!response.ok) { await response.body?.cancel(); throw new Error(`AI Pro 인증 요청 실패 (HTTP ${response.status}).`); }
  if (!response.body) throw new Error('AI Pro 인증 응답이 비어 있습니다.');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > 1000000) throw new Error('AI Pro 인증 응답 크기를 초과했습니다.');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function validateToken(token) {
  if (typeof token !== 'string' || token.length > 16384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('AI Pro 인증값을 확인할 수 없습니다.');
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  if (!claims || typeof claims !== 'object' || Array.isArray(claims) || !Object.keys(claims).length || (claims.exp !== undefined && (!Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()))) throw new Error('AI Pro 인증이 만료되었습니다.');
  return token;
}
export async function fetchModelCatalog(token, fetchImpl = fetch, signal) {
  const response = await fetchImpl(`${ORIGIN}/api/models`, { headers: { Authorization: `Bearer ${validateToken(token)}`, Accept: 'application/json' }, cache: 'no-store', redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]) });
  const body = await json(response);
  if (body.success === false || body.ok === false || !Array.isArray(body.modelList)) throw new Error('AI Pro 모델 목록을 확인할 수 없습니다.');
  const summary = {received: body.modelList.length, usable: 0, excluded: {name: 0, duplicate: 0, target: 0, agent: 0}};
  const seen = new Set();
  const models = body.modelList.flatMap(item => {
    const id = typeof item?.name === 'string' ? item.name.trim() : '';
    if (!id || id.length > 200 || /[\x00-\x1f\x7f]/.test(id)) {summary.excluded.name++; return [];}
    if (seen.has(id)) {summary.excluded.duplicate++; return [];}
    seen.add(id);
    return [{ id, label: typeof item.display_name === 'string' && item.display_name.trim() ? item.display_name.trim().slice(0, 200) : id,
      ...(Number.isSafeInteger(item.context_length) && item.context_length > 0 ? {contextLength: item.context_length} : {}),
      ...(Number.isSafeInteger(item.max_input_tokens) && item.max_input_tokens > 0 ? {maxInputTokens: item.max_input_tokens} : {}) }];
  });
  if (!models.length) throw new Error('사용 가능한 AI Pro 모델이 없습니다.');
  summary.usable = models.length;
  return {models, diagnostics: {source: '/api/models', status: response.status, summary}, fetchedAt: Date.now()};
}
export async function fetchModels(token, fetchImpl = fetch, signal) {return (await fetchModelCatalog(token, fetchImpl, signal)).models;}

export async function startLogin({ fetchImpl = fetch, openBrowser = openLoginBrowser, timeoutMs = 180000 } = {}) {
  const controller = new AbortController();
  let consumed = false, finished = false, pendingResponse;
  let resolve, reject;
  const result = new Promise((yes, no) => { resolve = yes; reject = no; });
  result.catch(() => {});
  function complete(error, value) {
    if (finished) return;
    finished = true;
    clearTimeout(timer); controller.abort();
    if (pendingResponse && !pendingResponse.writableEnded) {
      pendingResponse.writeHead(error ? 400 : 200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
      pendingResponse.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><title>AI Pro for Excel</title><body style="font-family:Malgun Gothic,sans-serif;padding:60px;background:#f1f7fe;color:#191f28"><h1>${error ? '로그인을 완료하지 못했습니다' : 'Excel에 연결했습니다'}</h1><p>${error ? 'Excel로 돌아가 새 로그인을 시작하세요.' : '이 창을 닫고 Excel에서 이어서 작업하세요.'}</p></body></html>`);
    }
    server.close(); server.closeIdleConnections();
    error ? reject(error) : resolve(value);
  }
  const server = createServer((request, response) => {
    const port = server.address()?.port;
    const origin = request.headers.origin;
    if (![`localhost:${port}`, `127.0.0.1:${port}`].includes(request.headers.host) || (origin && ![ORIGIN, 'https://epsso.samsung.net'].includes(origin))) { response.writeHead(403).end(); return; }
    let url; try { url = new URL(request.url, 'http://localhost'); } catch { response.writeHead(400).end(); return; }
    if (request.method !== 'GET' || url.pathname !== '/auth') { response.writeHead(404).end(); return; }
    if (consumed || finished) { response.writeHead(409).end(); return; }
    const code = url.searchParams.get('code');
    if (url.searchParams.get('status') !== '00' || !code || code.length > 16384 || /[\s\x00-\x1f\x7f]/.test(code)) { response.writeHead(400).end('Invalid callback'); return; }
    consumed = true; pendingResponse = response;
    void (async () => {
      try {
        const payload = await json(await fetchImpl(`${ORIGIN}/auth/exchange`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams({ code }).toString(), redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }));
        if (payload.ok === false || payload.success === false) throw new Error();
        const token = validateToken(payload.token);
        const catalog = await fetchModelCatalog(token, fetchImpl, controller.signal);
        complete(null, { token, ...catalog });
      } catch { complete(new Error('AI Pro 로그인 또는 모델 확인에 실패했습니다. 새 로그인으로 다시 시도하세요.')); }
    })();
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000;
  const timer = setTimeout(() => complete(new Error('로그인 시간이 만료되었습니다.')), timeoutMs);
  try {
    await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
    const url = `${ORIGIN}/auth/cli/login?port=${server.address().port}`;
    await openBrowser(url);
  } catch (error) { complete(new Error('로그인 수신기 또는 브라우저를 시작하지 못했습니다.')); }
  return { result, cancel: () => complete(new Error('로그인을 취소했습니다.')) };
}
