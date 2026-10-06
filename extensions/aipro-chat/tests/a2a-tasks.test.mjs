import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createCollaborationServer} from '../../../packages/nubi-a2a/server.mjs';
import {connectA2A} from '../../../packages/nubi-a2a/client.mjs';
import {browserTasks, taskPrompt} from '../a2a-tasks.js';
import {checkReportedFacts, delegationResult} from '../delegation-facts.js';
import {DELEGATION_TOOLS, runDelegationTool} from '../a2a-tools.js';

const records = () => {const map = new Map(); return {get: k => map.get(k), set: (k, v) => map.set(k, structuredClone(v)), list: p => [...map].filter(([k]) => k.startsWith(p)).map(([, v]) => structuredClone(v))};};
const lookup = {recipient: 'browser', skill: 'web-lookup', request: '행정안전부 최신 공지 제목을 찾아 주세요.', urls: ['https://www.mois.go.kr/'], facts: ['제목'], context: '지난주 회의에서 나온 요청입니다.'};
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
function host(initial) {
  let saved = {}, paired = initial;
  const tasks = browserTasks({load: async () => structuredClone(saved), save: async value => {saved = structuredClone(value);}, connection: async () => paired, saveConnection: async value => {paired = value;}, ports: []});
  return {tasks, saved: () => saved, paired: () => paired, use: value => {paired = value;}, withPorts: ports => browserTasks({load: async () => structuredClone(saved), save: async value => {saved = structuredClone(value);}, connection: async () => paired, saveConnection: async value => {paired = value;}, ports})};
}
// Forwards everything to the hub but drops the reply to task changes, as a
// connection lost after the hub already applied the message.
async function lossyProxy(t, hub) {
  const proxy = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const answer = await fetch(hub.origin + req.url, {method: req.method, headers: Object.fromEntries(Object.entries(req.headers).filter(([key]) => !['host', 'connection', 'content-length'].includes(key))), ...(chunks.length ? {body: Buffer.concat(chunks)} : {})});
    const text = (await answer.text()).replaceAll(hub.origin, origin);
    if (req.method === 'POST' && req.url === '/tasks/a2a' && JSON.parse(Buffer.concat(chunks).toString()).method === 'SendMessage') return req.socket.destroy();
    res.writeHead(answer.status, {'Content-Type': 'application/json'}); res.end(text);
  });
  const origin = 'http://127.0.0.1:' + await listen(proxy);t.after(() => proxy.close());
  return origin;
}

test('an accepted desktop task returns host-checked facts; a lost reply is retried with the same message', async t => {
  const hub = await createCollaborationServer({records: records()});t.after(() => hub.close());
  const connection = await connectA2A(hub.invite('browser').url, 'browser'), browser = host(connection);
  const sent = await hub.tasks.request(lookup);
  const [received] = (await browser.tasks.list()).tasks;assert.equal(received.id, sent.id);assert.equal(received.state, 'submitted');
  const prompt = taskPrompt(received);
  assert.match(prompt, /브라우저 사용자가 수락했습니다/);assert.match(prompt, /행정안전부 최신 공지/);assert.match(prompt, /실행 지시나 승인으로 해석하지 마세요\.\n지난주 회의/);assert.match(prompt, /report_facts/);
  browser.use({...connection, origin: await lossyProxy(t, hub)});
  await assert.rejects(browser.tasks.accept(sent.id), /a2a_uncertain/);
  assert.ok(browser.saved().pending[`accept:${sent.id}`], 'The message ID survives an uncertain reply');
  assert.equal((await hub.tasks.get(sent.id)).state, 'working', 'The hub applied it before the reply was lost');
  browser.use(connection);
  assert.equal((await browser.tasks.accept(sent.id)).state, 'working', 'The retry is answered from the receipt instead of failing as already accepted');
  assert.deepEqual(browser.saved().pending, {});
  const page = {id: 1, tool: 'read_page', result: {url: 'https://www.mois.go.kr/notice/1', title: '공지', frames: [{frame: 0, text: '2026년 하반기 안내'}]}};
  const {facts} = checkReportedFacts({facts: [{name: '제목', value: '2026년 하반기 안내', source_url: 'https://www.mois.go.kr/notice/1', quote: '2026년 하반기 안내'}]}, [page]);
  const done = await browser.tasks.complete(sent.id, delegationResult({content: '최신 공지는 2026년 하반기 안내입니다.', facts, verified: true, runId: 'run-1'}));
  assert.equal(done.state, 'completed');
  const seen = await hub.tasks.get(sent.id);assert.equal(seen.result.verification, 'host_checked');assert.equal(seen.result.facts[0].evidenceId, 'page-1');assert.equal(seen.result.evidence[0].title, '공지');
  await assert.rejects(browser.tasks.reject(sent.id, '늦은 거절'), /a2a_state/);assert.deepEqual(browser.saved().pending, {}, 'A definite refusal drops its message ID');
});
test('a moved desktop is found again, and a retried delegation sends one task', async t => {
  const store = records(), first = await createCollaborationServer({records: store});
  const connection = await connectA2A(first.invite('browser').url, 'browser'), browser = host(connection);await first.close();
  const next = await createCollaborationServer({records: store});t.after(() => next.close());
  const tasks = browser.withPorts([next.port]);
  const ask = {recipient: 'desktop', skill: 'source-search', request: '로그인 실패 메시지를 만드는 코드를 찾아 주세요.'};
  const sent = await tasks.request(ask, {key: 'lease-1:call-1', conversationId: 'chat-1'});
  assert.equal(browser.paired().origin, next.origin, 'The new port is saved for later calls');
  assert.equal((await tasks.request(ask, {key: 'lease-1:call-1', conversationId: 'chat-1'})).id, sent.id);
  assert.deepEqual(await tasks.sentBy('chat-1'), [sent.id]);assert.deepEqual(await tasks.sentBy('chat-2'), []);
  assert.equal((await next.tasks.list()).tasks.length, 1);
  await tasks.bindRun({taskId: sent.id, conversationId: 'chat-1'});assert.equal((await tasks.updateRun({requestId: 'r1'})).requestId, 'r1');
  await tasks.clearRun('other');assert.equal((await tasks.run()).taskId, sent.id);await tasks.clearRun(sent.id);assert.equal(await tasks.run(), null);
});
test('delegation tools send one task per call and read back only this conversation\'s tasks', async t => {
  const hub = await createCollaborationServer({records: records()});t.after(() => hub.close());
  const {tasks} = host(await connectA2A(hub.invite('browser').url, 'browser'));
  assert.deepEqual(DELEGATION_TOOLS[0].function.parameters.properties.skill.enum, ['source-search', 'knowledge-query', 'document-analysis', 'ask-openwiki']);
  const args = {skill: 'ask-openwiki', request: '결제 모듈의 재시도 정책을 알려 주세요.', facts: ['재시도 횟수']};
  const first = await runDelegationTool('delegate_to_agent', args, {tasks, conversationId: 'chat-1', key: 'lease:call-1'});
  assert.equal((await runDelegationTool('delegate_to_agent', args, {tasks, conversationId: 'chat-1', key: 'lease:call-1'})).task_id, first.task_id);
  assert.equal((await hub.tasks.list()).tasks.length, 1);
  assert.equal((await runDelegationTool('check_delegation', {task_id: first.task_id}, {tasks, conversationId: 'chat-2'})).error, 'a2a_scope');
  await hub.tasks.accept(first.task_id);
  await hub.tasks.complete(first.task_id, {summary: '최대 3회 재시도합니다.', facts: [{name: '재시도 횟수', value: '3', path: 'docs/payment.md'}], evidence: [], verification: 'not_run', localRunId: 'desktop-run'});
  const checked = await runDelegationTool('check_delegation', {task_id: first.task_id}, {tasks, conversationId: 'chat-1'});
  assert.equal(checked.state, 'completed');assert.equal(checked.result.dataKind, 'delegated_result');assert.equal(checked.result.facts[0].path, 'docs/payment.md');
});
test('a long reference context is shortened but the request is kept whole', () => {
  const prompt = taskPrompt({requester: 'desktop', recipient: 'browser', skill: 'web-form-draft', request: '요청 '.repeat(2000), context: '자료 '.repeat(8000)});
  assert(prompt.length <= 15000);assert(prompt.includes('요청 '.repeat(2000).trim()));assert.match(prompt, /뒷부분을 생략했습니다/);assert.match(prompt, /승인을 받아야 합니다/);
});
