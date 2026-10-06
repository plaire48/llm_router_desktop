import assert from 'node:assert/strict';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {planCompletion} from './fixtures/task-plan.mjs';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';

const profile = await mkdtemp(resolve(tmpdir(), 'nubi-action-visual-')), extension = resolve(profile, 'extension');
const origin = 'https://action-visual.example.test', model = 'QWEN3.8-27B-FP8-256K';
let context, ui, worker, source, round = 0, failure, imageRequests = 0;
const checks = [], errors = [], toolCalls = [];
const state = () => ui.evaluate(async () => (await chrome.runtime.sendMessage({type: 'GET_STATE'})).data);
const reply = (name, args = {}, content = '안내 창을 열고 마감일 2026년 10월 15일을 확인했습니다.') => ({choices: [{message: name ? {content: '', tool_calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]} : {content}, finish_reason: name ? 'tool_calls' : 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 10, total_tokens: 110}});
async function until(fn) {
  for (let i = 0; i < 600; i++) {if (failure) throw failure; if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 50));}
  throw new Error('Action visual recovery did not finish');
}
try {
  await cp(resolve(process.env.TEST_EXTENSION || 'dist'), extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
  // Pregrant the same browsing permission the real send gesture requests.
  // A headless browser cannot accept that native prompt. Production is unchanged.
  manifest.host_permissions.push('https://*/*', 'http://*/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.route(`${origin}/**`, route => route.fulfill({contentType: 'text/html; charset=utf-8', body: route.request().url().endsWith('/rules')
    ? '<title>신청 안내</title><h1>신청 안내</h1><p>마감일 2026년 10월 15일</p>'
    : `<title>안내 선택</title><h1>안내 선택</h1><label>메모<input value="사용자의 원본"></label>
      <section><h2>신청 안내</h2><button id="primary" onclick="window.opens++;window.open('${origin}/rules','nubi-rules')">열기</button></section>
      <section><h2>기타 안내</h2><button id="other" onclick="window.wrong++">열기</button></section>
      <script>window.opens=0;window.wrong=0;window.inputs=0;addEventListener('input',()=>window.inputs++);</script>`}));
  await context.route('https://aipro.sdsdev.co.kr/**', async route => {try {
    if (route.request().url().endsWith('/api/models')) return route.fulfill({json: {modelList: [{name: model, context_length: 262144, max_input_tokens: 221184}]}});
    const body = route.request().postDataJSON(), planning = planCompletion(body);
    assert.equal(body.model, model);
    if (planning) return route.fulfill({json: planning});
    const review = goalReviewPayload(body.messages);
    if (review) return route.fulfill({json: review.phase === 'checkpoint'
      ? reply(null, {}, JSON.stringify({status: 'revise', checks: [{requirement: '안내 창 열기', status: 'unknown', evidence_ids: []}], next_step: '기존 실패 영수증과 최신 캡처의 고유 ref로 신청 안내만 여세요.'}))
      : reviewCompletion(review)});
    const last = body.messages.findLast(message => message.role === 'tool'), result = last && JSON.parse(last.content);
    const images = body.messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(part => part.type === 'image_url') : []);
    if (images.length) imageRequests++;
    const current = round++; let name, args = {};
    if (current === 0) name = 'browser_snapshot';
    if ([1, 2].includes(current)) {name = 'run_playwright'; args = {code: 'await page.getByRole("button",{name:"열기",exact:true}).click();'};}
    if (current === 2) {assert.equal(result.reason, 'script_locator'); assert.equal(images.length, 0);}
    if (current === 3) {
      assert.equal(result.reason, 'script_locator'); assert.equal(result.actionIssued, false);
      assert.equal(images.length, 1, 'Qwen receives the automatic viewport capture after the second ambiguous action');
      assert.equal(result.visualRecovery.capture_mode, 'viewport');
      assert.equal(result.execution.commands.at(-1).state, 'failed');
      const target = result.observation.frames.flatMap(frame => frame.elements || []).find(element => element.id === 'primary');
      assert(target); assert(result.visualRecovery.visualTargets.some(element => element.ref === target.ref));
      assert.match(body.messages.find(message => message.role === 'system').content, /prefer declared semantic tools/);
      name = 'click_element'; args = {ref: target.ref};
    }
    if (current === 4) {
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.observation.url, `${origin}/rules`);
      name = 'verify_page'; args = {checks: [{kind: 'url_page_is', expected: `${origin}/rules`}, {kind: 'text_present', expected: '마감일 2026년 10월 15일'}]};
    }
    if (current === 5) assert.equal(result.verified, true);
    assert(current < 9, 'No repeated opener or unbounded repair');
    if (name) toolCalls.push(name);
    return route.fulfill({json: reply(name, args)});
  } catch (error) {failure = error; await route.fulfill({status: 400, body: 'Synthetic assertion failed'});}});
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => chrome.storage.local.set({browserWorkMode: 'current', debugMode: true}));
  await worker.evaluate(() => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token: 'synthetic', receivedAt: 1001}}));
  source = await context.newPage(); await source.goto(`${origin}/start`);
  ui = await context.newPage(); await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`);
  await until(async () => (await state()).catalog?.models?.length === 1);
  const tabId = await worker.evaluate(async origin => (await chrome.tabs.query({})).find(tab => tab.url === `${origin}/start`).id, origin);
  const uiId = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(({tabId, uiId}) => chrome.storage.session.set({chatSourceTabs: {[uiId]: tabId}}), {tabId, uiId});
  const started = Date.now();
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill('신청 안내의 열기를 눌러 새 창의 마감일을 확인해줘. 메모는 바꾸지 마.');
  await ui.getByRole('button', {name: '전송', exact: true}).click();
  await until(async () => ['done', 'error'].includes((await state()).chat.messages.at(-1)?.state));
  const saved = await state(), answer = saved.chat.messages.at(-1);
  assert.equal(answer.state, 'done', JSON.stringify(answer)); assert.equal(saved.chat.task.goalReview.status, 'complete');
  assert.deepEqual(await source.evaluate(() => ({opens, wrong, inputs})), {opens: 1, wrong: 0, inputs: 0});
  assert.equal(await source.getByLabel('메모').inputValue(), '사용자의 원본');
  assert.equal(answer.trace.filter(step => step.tool === 'capture_page' && step.status === 'done').length, 1);
  assert.equal(answer.trace.filter(step => step.tool === 'run_playwright' && step.status === 'error').length, 2);
  assert(imageRequests >= 1); assert.deepEqual(errors, []);
  checks.push('Two actual ambiguous locator failures dispatch no click and produce one masked viewport image for Qwen',
    'Fresh screenshot refs select the intended semantic target and open the new tab exactly once',
    'The landed URL and visible deadline pass host verification and independent final review',
    'The wrong button and original memo receive no action; no completed input is replayed');
  await mkdir('verification', {recursive: true});
  await writeFile('verification/action-visual-recovery-browser.json', JSON.stringify({checks, errors, elapsedMs: Date.now() - started, model, toolCalls, imageRequests,
    syntheticModelResponses: true, realBrowserActions: true, realQwenInference: false, windowsSamsungVerified: false}, null, 2));
  checks.forEach(check => console.log(`PASS ${check}`));
} catch (error) {
  const saved = ui && await state().catch(() => null);
  console.error({round, routeFailure: failure?.message, task: saved?.chat?.task, answer: saved?.chat?.messages?.at(-1), errors});
  throw error;
} finally {await context?.close(); await rm(profile, {recursive: true, force: true});}
