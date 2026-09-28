import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { inputSchema } from './contract.js';
import { createAdvisor, providerConfig, ProviderError } from './aipro.js';
import { createVerifier, identityConfig } from './auth.js';

export function publicOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || /^(localhost|127\.|\[::1\])/.test(url.hostname)) throw new Error('PUBLIC_ORIGIN must be a remote HTTPS origin without a path.');
  return url.origin;
}

function send(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 160000) throw new Error('Request too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createToolServer(advise, signal = new AbortController().signal) {
  const mcp = new McpServer({ name: 'office-copilot-aipro', version: '0.1.0' });
  mcp.registerTool('aipro_excel_plan', {
    title: 'AI Pro로 Excel 작업 검토',
    description: 'Ask AI Pro to analyze the observed Excel selection or propose requested cell edits. Returns a validated proposal, never edits the workbook. Requires current values/formulas. Do not send secrets. Copilot must apply and verify changes with its Excel tools.',
    inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  }, async (input, extra) => {
    try {
      const result = await advise(input, AbortSignal.any([signal, extra.signal]));
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: error instanceof ProviderError ? error.code : 'invalid_request', message: error instanceof ProviderError ? error.message : '선택 범위와 현재 값·수식 데이터를 확인하세요.', applied: false }) }] };
    }
  });
  return mcp;
}

export function createBridge({ origin, identity, verify, advise }) {
  let active = 0;
  return createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const path = req.url?.split('?')[0];
    if (req.headers.origin && req.headers.origin !== origin) return send(res, 403, { error: 'Origin not allowed.' });
    if (req.method === 'GET' && path === '/health') return send(res, 200, { status: 'ok', service: 'office-copilot-aipro', workbookAccess: false });
    if (req.method === 'GET' && ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'].includes(path)) {
      return send(res, 200, { resource: `${origin}/mcp`, authorization_servers: [identity.issuer], scopes_supported: [`api://${identity.audience}/access_as_user`], bearer_methods_supported: ['header'] });
    }
    if (path !== '/mcp') return send(res, 404, { error: 'Not found.' });
    try { await verify(req.headers.authorization); }
    catch {
      res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`);
      return send(res, 401, { error: 'Microsoft 계정 인증 또는 허용된 사용자 설정을 확인하세요.' });
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'Use stateless MCP POST requests.' }); }
    if (!req.headers['content-type']?.startsWith('application/json')) return send(res, 415, { error: 'Expected application/json.' });
    if (active >= 2) return send(res, 429, { error: '요청을 처리 중입니다. 잠시 후 다시 시도하세요.' });
    active += 1;
    let body;
    try { body = await readBody(req); } catch { active -= 1; return send(res, 400, { error: 'Invalid or oversized request.' }); }
    const cancellation = new AbortController();
    const mcp = createToolServer(advise, cancellation.signal);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    let closed = false;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      active -= 1;
      cancellation.abort();
      void mcp.close().catch(() => {});
    };
    res.once('close', cleanup);
    try {
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) send(res, 500, { error: 'MCP request failed.' });
      else res.end();
      cleanup();
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const origin = publicOrigin(process.env.PUBLIC_ORIGIN);
    const identity = identityConfig(process.env);
    const port = Number(process.env.PORT || 8789);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
    const server = createBridge({ origin, identity, verify: createVerifier(identity), advise: createAdvisor(providerConfig(process.env)) });
    server.requestTimeout = 30000;
    server.headersTimeout = 10000;
    server.on('error', () => { console.error('연결 서버를 시작하지 못했습니다. 포트 설정을 확인하세요.'); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`Copilot AI Pro bridge listening on 127.0.0.1:${port}; HTTPS proxy required.`));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
