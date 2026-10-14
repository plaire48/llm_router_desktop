// Request metadata only. Do not include query strings, headers or response bodies.
export function githubRequestDiagnostic(url,method,response,token) {
  const secrets=token?[String(token),encodeURIComponent(token)]:[];
  try {if(token)secrets.push(btoa(String(token)));} catch {/* Non-ASCII credentials are never copied. */}
  const safe=value=>typeof value==='string'&&!secrets.some(secret=>secret&&value.includes(secret));
  let endpoint='',teamSlug='';
  try {
    const parsed=new URL(url);
    const candidate=parsed.origin+parsed.pathname;
    if(['https:','http:'].includes(parsed.protocol)&&candidate.length<=2048&&safe(candidate)) {
      endpoint=candidate;
      teamSlug=parsed.pathname.match(/\/teams\/([a-z\d][a-z\d-]{0,99})\/members(?:hips\/[^/]+)?$/i)?.[1]||'';
    }
  } catch {/* Preserve the error even when no safe request address is available. */}
  const rawId=response.headers.get('x-github-request-id');
  const requestId=/^[a-z\d:_-]{1,128}$/i.test(rawId||'')&&safe(rawId)?rawId:'';
  const verb=['GET','POST','PUT','PATCH','DELETE'].includes(method)?method:'확인 불가';
  return {teamSlug,diagnosticText:[
    `요청: ${verb} ${endpoint||'(주소 확인 불가)'}`,
    `상태: HTTP ${response.status}`,
    `요청 ID: ${requestId||'(확인 불가)'}`,
    `확인 시각: ${new Date().toISOString()}`,
  ].join('\n')};
}
