// nubi-task-v1 in actual Chrome: official SDK over authenticated loopback HTTP.
// The model and the site are synthetic; the hub, host tools and UI are real.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import {ProjectService} from '../../../packages/nubi-desktop/runtime/project-service.mjs';
import {installAgent} from '../../../packages/nubi-desktop/runtime/agent.mjs';
import {git} from '../../../packages/nubi-desktop/runtime/files.mjs';
import {fixturePlan,fixtureReview} from '../../../packages/nubi-desktop/tests/fixtures.mjs';
installAgent(ProjectService);
import {COMPLETION_REVIEW_PROMPT} from '../completion-review.js';
import {planCompletion} from './fixtures/task-plan.mjs';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';

const site = createServer((_req, res) => {res.writeHead(200, {'content-type': 'text/html; charset=utf-8'}); res.end('<!doctype html><meta charset="utf-8"><title>공지</title><main><h1>2026년 하반기 안내</h1><p>게시일 2026-09-30</p></main>');});
await new Promise(done => site.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${site.address().port}`, notice = origin + '/notice';
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-a2a-workspace-')), extension = resolve(profile, 'extension'), root=resolve(profile,'workspace');
await mkdir(resolve(root,'src'),{recursive:true});await writeFile(resolve(root,'src/LoginService.java'),'class LoginService { String message = "Login failed"; }\n');await git(root,['init','-q']);
const service=new ProjectService({storageRoot:resolve(profile,'state')});await service.open(root);
const sourceTask=await service.createTask({request:'브라우저 공지 조회'});
await service.collaboration({action:'invite',recipient:'browser'});const hub=service.collaborationServer;
let desktopTurns=0;
service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async(messages)=>{
 const helper=fixturePlan(messages)||fixtureReview(messages);if(helper)return helper;
 if(++desktopTurns===1)return {content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name:'read_source',arguments:JSON.stringify({path:'src/LoginService.java'})}}]};
 return {content:'LoginService가 실패 메시지를 만듭니다.',calls:[]};
}};
const checks = [], errors = [];
const pass = label => {checks.push(label); console.log('PASS ' + label);};
const completion = (name, args = {}, content = '') => ({choices: [{message: {content, ...(name ? {tool_calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]} : {})}, finish_reason: name ? 'tool_calls' : 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 20, total_tokens: 120}});
let context, routeError, delegatedId = '';
const seenTools = {delegated: new Set(), ordinary: new Set()};
async function until(check, label) {
  for (let i = 0; i < 600; i++) {if (routeError) throw routeError; if (await check()) return; await new Promise(done => setTimeout(done, 50));}
  throw new Error(`timed out: ${label}`);
}
try {
  await cp('dist', extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions.push('http://*/*'); await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY || chromium.executablePath(), args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`]});
  context.setDefaultTimeout(15000);
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route('https://aipro.sdsdev.co.kr/api/models', route => route.fulfill({json: {modelList: [{name: 'GLM-5.2-NVFP4', context_length: 524288}]}}));
  await context.route('https://aipro.sdsdev.co.kr/api/v1/chat/completions', async route => {
    try {
      const body = route.request().postDataJSON(), plan = planCompletion(body), review = goalReviewPayload(body.messages);
      if (plan) return route.fulfill({json: plan});
      if (review) return route.fulfill({json: reviewCompletion(review)});
      if (body.messages[0].content.startsWith(COMPLETION_REVIEW_PROMPT)) return route.fulfill({json: completion(null, {}, JSON.stringify({decision: 'reply', scope: 'conversation', next_step: ''}))});
      const names = (body.tools || []).map(tool => tool.function.name), request = JSON.stringify(body.messages.filter(message => message.role === 'user'));
      const toolResult = body.messages.findLast(message => message.role === 'tool'), result = toolResult ? JSON.parse(toolResult.content) : null;
      const lastCall = body.messages.findLast(message => message.role === 'assistant' && message.tool_calls)?.tool_calls.at(-1).function.name;
      let response;
      if (request.includes('브라우저 사용자가 수락했습니다')) {
        for (const name of names) seenTools.delegated.add(name);
        if (!lastCall || lastCall === 'browser_snapshot') response = completion('navigate_page', {url: notice});
        else if (lastCall === 'navigate_page') response = completion('read_page', {});
        else if (lastCall === 'read_page') response = completion('report_facts', {facts: [{name: '제목', value: '2026년 하반기 안내', source_url: notice, quote: '2026년 하반기 안내'}, {name: '게시일', value: '2026-09-30', source_url: notice, quote: '게시일 2026-09-30'}]});
        else {assert.equal(lastCall, 'report_facts'); assert.equal(result.ok, true, JSON.stringify(result)); assert.deepEqual(result.unchecked, []); response = completion(null, {}, '공지 제목은 2026년 하반기 안내이고 게시일은 2026-09-30입니다.');}
      } else if (request.includes('결과 확인해줘')) {
        if (lastCall !== 'check_delegation') response = completion('check_delegation', {task_id: delegatedId});
        else {assert.equal(result.state, 'completed'); assert.equal(result.result.evidence[0].path, 'src/LoginService.java'); response = completion(null, {}, `데스크톱 결과: ${result.result.summary}`);}
      } else {
        for (const name of names) seenTools.ordinary.add(name);
        if (lastCall !== 'delegate_to_agent') response = completion('delegate_to_agent', {skill: 'source-search', request: '로그인 실패 메시지를 만드는 코드를 찾아 주세요.'});
        else {assert.equal(result.state, 'submitted'); delegatedId = result.task_id; response = completion(null, {}, '데스크톱에 요청했습니다.');}
      }
      await route.fulfill({json: response});
    } catch (error) {routeError = error; await route.abort();}
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const ui = await context.newPage(); await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await worker.evaluate(() => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token: 'synthetic', receivedAt: 123}}));
  const rpc = async message => {const value = await ui.evaluate(message => chrome.runtime.sendMessage(message), message); assert(value.ok, JSON.stringify(value)); return value.data;};
  await until(async () => (await rpc({type: 'GET_STATE'})).catalog?.models?.length === 1, 'models');
  assert.equal((await rpc({type: 'A2A_TASKS', action: 'list'})).connected, false);
  const connected = await rpc({type: 'A2A', action: 'connect', url: hub.invite('browser').url});assert(!connected.error, JSON.stringify(connected));
  const first = (await rpc({type: 'GET_STATE'})).chat.sessionId;

  // Desktop asks; nothing runs until the browser user accepts.
  const sent = await service.collaboration({action:'task_request',taskId:sourceTask.id,requestId:'workspace-browser-001',skill:'web-lookup',request:'공지 제목과 게시일을 찾아 주세요.',urls:[notice],facts:['제목','게시일']});
  const declined = await service.collaboration({action:'task_request',taskId:sourceTask.id,requestId:'workspace-decline-001',skill:'web-page-check',request:'공지 페이지가 열리는지 확인해 주세요.'});
  await ui.setViewportSize({width: 360, height: 850});
  await ui.getByRole('button', {name: '설정', exact: true}).click();await ui.getByRole('button', {name: '누비 작업 연결', exact: true}).click();
  const card = ui.locator('.a2a-task', {hasText: '공지 제목과 게시일'});await card.waitFor();
  assert.equal((await rpc({type: 'GET_STATE'})).chat.messages.length, 0, 'A received task starts nothing by itself');
  await ui.locator('.a2a-task', {hasText: '페이지가 열리는지'}).getByRole('button', {name: '거절', exact: true}).click();
  await until(async () => (await hub.tasks.get(declined.id)).state === 'rejected', 'rejected');pass('declining a received task tells the desktop without running it');
  await card.getByRole('button', {name: '수락 후 실행', exact: true}).click();
  await until(async () => (await hub.tasks.get(sent.id)).state === 'completed', 'completed');
  const state = await rpc({type: 'GET_STATE'});
  assert.notEqual(state.chat.sessionId, first, 'The accepted task runs in its own conversation');
  assert.match(state.chat.messages[0].content, /브라우저 사용자가 수락했습니다/);
  assert(seenTools.delegated.has('report_facts') && !seenTools.delegated.has('delegate_to_agent'), 'An accepted task reports facts and cannot delegate back');
  const done = await hub.tasks.get(sent.id);
  assert.equal(done.result.verification, 'host_checked');assert.deepEqual(done.result.facts.map(fact => fact.evidenceId), ['page-1', 'page-1']);assert.equal(done.result.evidence[0].url, notice);
  assert.equal(done.result.localRunId, state.chat.messages.at(-1).id);
  pass('an accepted task runs in a new conversation and returns facts checked against the page it read');

  // The browser asks the desktop and reads the result in a later turn.
  await rpc({type: 'NEW_CHAT'});
  await rpc({type: 'START_AGENT', text: '데스크톱에 로그인 실패 메시지 코드를 물어봐'});
  await until(async () => {const s = await rpc({type: 'GET_STATE'}); return !s.busy && s.chat.messages.at(-1)?.state === 'done';}, 'delegated');
  assert(seenTools.ordinary.has('delegate_to_agent') && !seenTools.ordinary.has('report_facts'));
  const asked = await hub.tasks.get(delegatedId);assert.equal(asked.requester, 'browser');assert.equal(asked.skill, 'source-search');
  assert.equal(desktopTurns,0);
  const {localTaskId}=await service.collaboration({action:'task_accept',id:delegatedId});
  assert.equal(desktopTurns,0,'Accept imports a chat without model execution');
  await service.startAgent({taskId:localTaskId});await service.agent.promise;
  const actualRun=service.task(localTaskId);assert.equal(actualRun.resultReview.status,'ready');
  await service.collaboration({action:'task_deliver',taskId:localTaskId,id:delegatedId});
  assert.equal((await hub.tasks.get(delegatedId)).result.localRunId,actualRun.resultReview.runId);
  await rpc({type: 'START_AGENT', text: '결과 확인해줘'});
  await until(async () => {const s = await rpc({type: 'GET_STATE'}); return !s.busy && s.chat.messages.at(-1)?.state === 'done';}, 'checked');
  assert.match((await rpc({type: 'GET_STATE'})).chat.messages.at(-1).content, /LoginService/);
  pass('the model delegates once to the desktop and reads the result in a later turn');

  const session = await worker.evaluate(() => chrome.storage.session.get(['a2a', 'a2aTasks']));
  assert(!JSON.stringify(await rpc({type: 'GET_STATE'})).includes(session.a2a.connection.token));
  assert(!JSON.stringify(await rpc({type: 'A2A_TASKS', action: 'list'})).includes(session.a2a.connection.token));
  assert.deepEqual(session.a2aTasks.pending, {});assert.deepEqual(errors, []);
  pass('the token stays out of public state and no message ID is left pending');
  await mkdir('verification/finish-improvements-2026-10-01', {recursive: true});
  await writeFile('verification/finish-improvements-2026-10-01/workspace-chrome.json', JSON.stringify({scope: 'actual-Workspace-SQLite-host-Chrome-and-A2A-HTTP-synthetic-model-and-site', checks, errors}, null, 2));
} finally {await context?.close(); await hub.close(); service.collaborationServer=null;service.dispose();service.store.close();site.close(); await rm(profile, {recursive: true, force: true});}
