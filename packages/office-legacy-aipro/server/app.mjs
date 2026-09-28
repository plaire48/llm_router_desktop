import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { providerConfig } from '../../office-copilot-aipro/src/aipro.js';
import { startLogin } from './auth.mjs';
import { createNubiRun } from './nubi-agent.mjs';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.woff2': 'font/woff2' };
function send(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); }
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 120000) throw new Error('요청 크기를 초과했습니다.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function createApp({ origin = 'https://localhost:8790', webRoot, fetchImpl = fetch, loginImpl = startLogin } = {}) {
  const csrf = randomBytes(32).toString('hex'), base = new URL(origin);
  let config, models = [], login, loginState = 'idle', loginError = '', generation = 0, busy = false, run;
  function status() { return { connected: !!config, mode: config?.mode ?? null, model: config?.model ?? null, models, loginState, loginError }; }
  function disconnect() { generation++; login?.cancel(); login = null; config = null; models = []; run?.cancel(); run = null; busy = false; loginState = 'idle'; loginError = ''; }
  const handler = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (req.headers.host !== base.host || (req.headers.origin && req.headers.origin !== origin)) return send(res, 403, { error: '허용되지 않은 요청입니다.' });
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith('/api/')) {
        if (req.method === 'GET' && url.pathname === '/api/session') return send(res, 200, { ...status(), csrf });
        const token = req.headers['x-aipro-session'];
        if (typeof token !== 'string' || token.length !== csrf.length || !timingSafeEqual(Buffer.from(token), Buffer.from(csrf))) return send(res, 403, { error: '연결 화면을 다시 여세요.' });
        if (req.method !== 'POST' || !req.headers['content-type']?.startsWith('application/json')) return send(res, 405, { error: '지원하지 않는 요청입니다.' });
        const data = await body(req);
        if (url.pathname === '/api/run-start') {
          if (!config) return send(res, 401, { error: 'AI Pro에 먼저 연결하세요.' });
          if (busy) return send(res, 409, { error: '다른 작업을 처리하고 있습니다.' });
          if (data.history !== undefined && !Array.isArray(data.history)) throw new Error();
          const current = createNubiRun({ input: data.input, history: data.history, config, fetchImpl, onFinish: () => { if (run === current) busy = false; } });
          run = current; busy = true; return send(res, 200, run.status());
        }
        if (['/api/run-state', '/api/run-result', '/api/run-cancel'].includes(url.pathname)) {
          if (!run || data.id !== run.id) return send(res, 404, { error: '진행 중인 작업을 찾을 수 없습니다.' });
          if (url.pathname === '/api/run-result') run.respond(data.callId, data.result);
          if (url.pathname === '/api/run-cancel') run.cancel();
          return send(res, 200, run.status());
        }
        if (url.pathname === '/api/disconnect') { disconnect(); return send(res, 200, status()); }
        if (url.pathname === '/api/login') {
          if (busy) return send(res, 409, { error: '현재 요청이 끝난 뒤 연결하세요.' });
          disconnect(); const current = generation; loginState = 'waiting';
          let pending;
          try { pending = await loginImpl({ fetchImpl }); }
          catch { if (current === generation) { loginState = 'failed'; loginError = '로그인을 시작하지 못했습니다.'; } throw new Error(); }
          if (current !== generation) { pending.cancel(); return send(res, 409, { error: '로그인이 취소되었습니다.' }); }
          login = pending;
          login.result.then(value => {
            if (generation !== current) return;
            models = value.models;
            config = providerConfig({ AIPRO_MODE: 'browser-token', AIPRO_ACCESS_TOKEN: value.token, AIPRO_MODEL_ID: models[0].id });
            loginState = 'complete'; login = null;
          }).catch(() => { if (generation === current) { loginState = 'failed'; loginError = '로그인을 완료하지 못했습니다. 새 로그인으로 다시 시도하세요.'; login = null; } });
          return send(res, 200, status());
        }
        if (url.pathname === '/api/connect-cli') {
          if (busy) return send(res, 409, { error: '현재 요청이 끝난 뒤 연결하세요.' });
          const next = providerConfig({ AIPRO_MODE: 'cli', AIPRO_CLI_BASE_URL: data.baseUrl, AIPRO_CLI_TOKEN: data.token, AIPRO_CLI_MODEL_ID: data.model });
          if (next.model.length > 200) throw new Error();
          disconnect(); config = next; models = [{ id: config.model, label: config.model }];
          return send(res, 200, status());
        }
        if (url.pathname === '/api/model') {
          if (busy || !config || !models.some(model => model.id === data.model)) return send(res, 409, { error: '모델을 선택할 수 없습니다.' });
          config = { ...config, model: data.model }; return send(res, 200, status());
        }
        return send(res, 404, { error: '지원하지 않는 요청입니다.' });
      }
      if (req.method !== 'GET' || !webRoot) { res.writeHead(404).end(); return; }
      const name = url.pathname === '/' ? '/taskpane.html' : decodeURIComponent(url.pathname);
      const path = resolve(webRoot, '.' + name);
      if (!path.startsWith(resolve(webRoot) + sep)) { res.writeHead(404).end(); return; }
      const extension = Object.keys(types).find(ext => path.endsWith(ext));
      if (!extension) { res.writeHead(404).end(); return; }
      const file = await readFile(path);
      res.writeHead(200, { 'Content-Type': types[extension] }); res.end(file);
    } catch (error) {
      if (!res.headersSent) send(res, error?.code === 'ENOENT' ? 404 : 400, { error: '입력값 또는 연결 상태를 확인하세요. 셀 적용 여부는 Excel 화면에서 확인하세요.' });
      else res.end();
    }
  };
  return { handler, close: disconnect };
}
