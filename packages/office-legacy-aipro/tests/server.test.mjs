import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server/app.mjs';
import { startLogin, validateToken } from '../server/auth.mjs';
const jwt = `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: 'test', exp: Math.floor(Date.now()/1000)+600 })).toString('base64url')}.signature`;

async function fixture(t, options = {}) {
  let app; const server = createServer((req,res) => app.handler(req,res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`; app = createApp({ origin, ...options });
  t.after(() => { app.close(); server.close(); server.closeAllConnections(); });
  const session = await (await fetch(origin + '/api/session')).json();
  const post = (route,data,headers={}) => fetch(origin+'/api/'+route, { method:'POST', headers:{ 'Content-Type':'application/json', 'X-AIPro-Session':session.csrf, ...headers }, body:JSON.stringify(data) });
  return { origin, post };
}
test('local HTTP API protects credentials and validates Nubi input before provider calls', async t => {
  let calls = 0; const { origin, post } = await fixture(t, { fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'https://example.com/v1/chat/completions'); assert.equal(options.headers['User-Agent'], 'AIPROCLI'); assert.equal(options.headers.Authorization, 'Bearer secret');
    const body = JSON.parse(options.body); assert.match(body.messages[0].content, /perpetual Excel 2016/); assert.equal(body.stream, true);
    return Response.json({ choices: [{ message: { content: '분석 답변' }, finish_reason: 'stop' }] });
  } });
  assert.equal((await post('connect-cli', {}, { 'X-AIPro-Session': '' })).status, 403);
  assert.equal((await fetch(origin + '/api/session', { headers: { Origin: 'https://evil.example' } })).status, 403);
  const connected = await (await post('connect-cli', { baseUrl: 'https://example.com/v1', token: 'secret', model: 'test-model' })).json(); assert.equal(connected.connected, true); assert.equal(JSON.stringify(connected).includes('secret'), false);
  const input = { request: '요약', mode: 'analyze', worksheet: 'Sheet1', address: 'A1', values: [[1]], formulas: [[1]] };
  assert.equal((await post('run-start', { input: { ...input, address: 'XFD1048577' } })).status, 400); assert.equal(calls, 0);
  const run = await (await post('run-start', { input })).json();
  let observed; for (let i = 0; i < 20; i++) { observed = await (await post('run-state', { id: run.id })).json(); if (observed.state !== 'running') break; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.equal(observed.state, 'done'); assert.equal(observed.answer, '분석 답변'); assert.equal(calls, 1);
  await post('disconnect', {}); assert.equal((await post('run-start', { input })).status, 401);
});
test('browser SSO exchanges a callback once and validates upstream models', async t => {
  let callback, exchanges=0, release;
  const wait = new Promise(resolve => { release=resolve; });
  const login=await startLogin({ openBrowser:async url=>{ callback=`http://127.0.0.1:${new URL(url).searchParams.get('port')}/auth?status=00&code=one-time`; }, fetchImpl:async (url,options)=>{
    if(url.endsWith('/auth/exchange')) { exchanges++; assert.equal(options.body,'code=one-time'); await wait; return Response.json({token:jwt}); }
    assert.equal(options.headers.Authorization,`Bearer ${jwt}`); return Response.json({modelList:[{name:'model-a'},{name:'model-a'},{name:''}]});
  } });
  t.after(()=>login.cancel());
  assert.equal((await fetch(callback,{headers:{Origin:'https://evil.example'}})).status,403);
  const first=fetch(callback); await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal((await fetch(callback)).status,409); release();
  assert.equal((await first).status,200); const result=await login.result; assert.equal(result.token,jwt); assert.deepEqual(result.models,[{id:'model-a',label:'model-a'}]); assert.equal(exchanges,1);
});
test('cancelled or expired login never provides a credential', async () => {
  const login=await startLogin({openBrowser:async()=>{}}); login.cancel(); await assert.rejects(login.result,/취소/);
  const expired=await startLogin({openBrowser:async()=>{},timeoutMs:40}); await assert.rejects(expired.result,/만료/);
  assert.throws(()=>validateToken('not-a-token')); assert.throws(()=>validateToken('eyJhbGciOiJSUzI1NiJ9.W10.signature'));
});

test('a cancelled login startup cannot restore a connection when it finishes late', async t => {
  let release, cancelled = false;
  const ready = new Promise(resolve => { release = resolve; });
  const { origin, post } = await fixture(t, { loginImpl: async () => { await ready; return { result: Promise.resolve({ token: jwt, models: [{ id: 'late', label: 'late' }] }), cancel() { cancelled = true; } }; } });
  const pending = post('login', {});
  await new Promise(resolve => setTimeout(resolve, 20));
  await post('disconnect', {}); release();
  assert.equal((await pending).status, 409);
  const state = await (await fetch(origin + '/api/session')).json(); assert.equal(state.connected, false); assert.equal(cancelled, true);
});
