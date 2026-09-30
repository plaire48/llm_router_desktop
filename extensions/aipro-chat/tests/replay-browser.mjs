// Real Chrome: a verified run is repeated without the model, as Nanobrowser and
// browser-use rerun a saved history. The model fills a time sheet, verifies it,
// asks for approval and registers it. The answer keeps the steps; "모델 없이 다시
// 실행" asks for the values again (the ones typed last time come from memory),
// finds each target again, stops for the same approval and registers once more,
// with no request to the model. On a page whose field was renamed it stops
// before writing anything.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {planCompletion, fixturePlan} from './fixtures/task-plan.mjs';
import {goalReviewPayload, reviewCompletion} from './fixtures/goal-review.mjs';

const form = hours => `<!doctype html><html lang="ko"><title>업무 기록</title><body style="font:15px sans-serif;padding:20px">
<h1>업무 기록</h1><form onsubmit="return false"><label>업무 날짜 <input name="date"></label><br><label>${hours} <input name="hours"></label><br>
<label>업무 내용 <textarea name="body"></textarea></label><br><button type="button" id="register">등록</button></form><p id="done"></p>
<script>window.submits=[];document.getElementById('register').onclick=()=>{const f=document.forms[0];submits.push({date:f.date.value,hours:f.hours.value,body:f.body.value});document.getElementById('done').textContent='등록 완료';};</script></body></html>`;
let renamed = false;
const server = createServer((req, res) => {res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(req.url.startsWith('/elsewhere') ? '<!doctype html><title>포털</title><p>포털 첫 화면</p>' : form(renamed ? '작업 시간' : '투입 시간'));});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-replay-')), extension = resolve(profile, 'extension');
const token = `header.${Buffer.from(JSON.stringify({exp: Math.floor(Date.now() / 1000) + 3600})).toString('base64url')}.signature`;
let context, ui, worker, page, failure, round = 0, modelCalls = 0, count = 0;
const pass = label => {count++; console.log('PASS ' + label);};
const state = () => ui.evaluate(async () => (await chrome.runtime.sendMessage({type: 'GET_STATE'})).data);
const reply = (name, args = {}, content = '') => ({choices: [{message: {content, ...(name ? {tool_calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]} : {})}, finish_reason: name ? 'tool_calls' : 'stop'}],
  usage: {prompt_tokens: 100, completion_tokens: 20, total_tokens: 120}});
const ref = (result, name) => {const found = (result.observation || result).frames.flatMap(f => f.elements || []).find(e => e.name === name); assert(found, name); return found.ref;};
async function until(fn, label, ms = 30000) {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) {if (failure) throw failure; last = await fn(); if (last) return last; await new Promise(r => setTimeout(r, 100));}
  throw new Error(`timed out: ${label} ${JSON.stringify(last)}`);
}
try {
  await mkdir('verification', {recursive: true});
  await cp(process.env.NUBI_DIST || 'dist', extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8')); manifest.host_permissions.push('https://*/*', 'http://*/*');
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]});
  context.setDefaultTimeout(15000);
  await context.route('https://aipro.sdsdev.co.kr/**', async route => {try {
    if (route.request().url().endsWith('/api/models')) return route.fulfill({json: {modelList: [{name: 'GLM-5.2-NVFP4', context_length: 524288}]}});
    const body = route.request().postDataJSON(); modelCalls++;
    const planning = planCompletion(body); if (planning) return route.fulfill({json: planning});
    const review = goalReviewPayload(body.messages); if (review) return route.fulfill({json: reviewCompletion(review)});
    const last = body.messages.findLast(m => m.role === 'tool'), result = last ? JSON.parse(last.content) : null, current = round++;
    let name, args = {};
    if (current === 0) name = 'browser_snapshot';
    if (current === 1) {name = 'fill_form'; args = {fields: [{field_id: ref(result, '업무 날짜'), value: '2026-09-24'}, {field_id: ref(result, '투입 시간'), value: '8'}, {field_id: ref(result, '업무 내용'), value: '로그인 오류 분석'}]};}
    if (current === 2) {assert.equal(result.applied, 3, JSON.stringify(result).slice(0, 300)); name = 'verify_page'; args = {checks: [['업무 날짜', '2026-09-24'], ['투입 시간', '8']].map(([field, expected]) => ({kind: 'field_value', ref: ref(result, field), expected}))};}
    if (current === 3) {assert.equal(result.verified, true); name = 'request_approval'; args = {ref: ref(result, '등록'), summary: '업무 기록을 등록합니다.'};}
    if (current === 4) {name = 'verify_page'; args = {checks: [{kind: 'text_present', expected: '등록 완료'}]};}
    if (current === 5) {assert.equal(result.verified, true); name = 'update_plan'; args = {steps: fixturePlan.map(step => ({...step, status: 'completed'}))};}
    if (current === 6) return route.fulfill({json: reply(null, {}, '업무 기록을 등록하고 확인했습니다.')});
    assert(current <= 6, `unexpected model round ${current}`);
    return route.fulfill({json: reply(name, args)});
  } catch (error) {failure = error; return route.fulfill({status: 500, body: 'fixture failed'});}});
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  page = await context.newPage(); await page.goto(`${origin}/sheet?week=39`);
  await worker.evaluate(() => chrome.storage.local.set({browserWorkMode: 'current'}));
  await worker.evaluate(token => chrome.storage.session.set({credential: {provider: 'aipro', mode: 'browser', token, receivedAt: 1}}), token);
  ui = await context.newPage(); await ui.goto(`chrome-extension://${new URL(worker.url()).hostname}/index.html`); await ui.setViewportSize({width: 400, height: 900});
  await until(async () => !!(await state()).catalog?.models?.length, 'models');
  const tabId = await worker.evaluate(async origin => (await chrome.tabs.query({})).find(t => (t.url || '').startsWith(origin)).id, origin), uiId = await ui.evaluate(async () => (await chrome.tabs.getCurrent()).id);
  await worker.evaluate(({tabId, uiId}) => chrome.storage.session.set({chatSourceTabs: {[uiId]: tabId}}), {tabId, uiId});

  // 1. The model's run, approved once.
  await ui.getByRole('textbox', {name: '메시지', exact: true}).fill('이 페이지에 오늘 업무 기록을 등록해줘. 9월 24일, 8시간, 로그인 오류 분석.');
  await ui.getByRole('button', {name: '전송', exact: true}).click();
  await until(async () => (await state()).chat.task?.status === 'awaiting_user', 'approval card');
  await ui.getByRole('button', {name: '등록', exact: true}).click();
  await until(async () => {const now = await state(); return now.chat.task?.status === 'done' && !now.chatLease;}, 'model run finished');
  const first = (await state()).chat.messages.at(-1);
  assert.equal(first.error ?? null, null, JSON.stringify(first).slice(0, 400));
  assert.deepEqual(await page.evaluate(() => submits), [{date: '2026-09-24', hours: '8', body: '로그인 오류 분석'}]);
  assert.deepEqual(first.replay.steps.map(step => step.tool), ['fill_form', 'verify_page', 'request_approval', 'apply_approved_action', 'verify_page']);
  assert.deepEqual(first.replay.inputs.map(input => input.label.split(' · ')[0]), ['업무 날짜', '투입 시간', '업무 내용']);
  // The request itself is the user's message of this conversation; the steps hold no typed value.
  assert(!JSON.stringify(first.replay.steps).includes('로그인 오류 분석') && !JSON.stringify(first.replay.steps).includes('2026-09-24'), 'the saved steps hold no typed value');
  const memory = (await worker.evaluate(() => chrome.storage.session.get('replayValues'))).replayValues[first.replay.id].values;
  assert.deepEqual(first.replay.inputs.map(input => memory[input.slot]), ['2026-09-24', '8', '로그인 오류 분석'], 'the typed values are kept in memory only');
  pass('a verified, approved run keeps its steps and the inputs to ask for, without the typed values');

  // 2. The same task again without the model, one value changed, started from
  // another page: the recorded page opens first, its query kept in memory.
  await page.goto(`${origin}/elsewhere`);
  const callsBefore = modelCalls;
  await ui.getByRole('button', {name: '모델 없이 다시 실행', exact: true}).last().click();
  const card = ui.getByRole('region', {name: '모델 없이 다시 실행'}).or(ui.locator('.replay-card'));
  await ui.locator('.replay-card input').first().waitFor();
  assert.deepEqual(await ui.locator('.replay-card input').evaluateAll(inputs => inputs.map(input => input.value)), ['2026-09-24', '8', '로그인 오류 분석'], 'the values typed last time come back from memory');
  await ui.locator('.replay-card input').nth(1).fill('6');
  await ui.locator('.replay-card').screenshot({path: resolve('verification/replay-card.png')});
  await card.getByRole('button', {name: '실행', exact: true}).click();
  await until(async () => (await state()).chat.task?.status === 'awaiting_user', 'replay reached the approval');
  assert.equal(modelCalls, callsBefore, 'no model request before the approval');
  assert.equal(new URL(page.url()).search, '?week=39', 'the recorded page opened with its query');
  assert.equal(await page.inputValue('input[name="hours"]'), '6'); assert.deepEqual(await page.evaluate(() => submits), []);
  await ui.getByRole('button', {name: '등록', exact: true}).click();
  await until(async () => {const now = await state(); return now.chat.task?.status === 'done' && !now.chatLease;}, 'replay finished');
  const second = (await state()).chat.messages.at(-1);
  assert.equal(modelCalls, callsBefore, 'no model request at all during the replay');
  assert.deepEqual(await page.evaluate(() => submits), [{date: '2026-09-24', hours: '6', body: '로그인 오류 분석'}]);
  assert.match(second.content, /기록한 절차 \d+단계를 모델 없이 다시 실행했습니다\./);
  assert(second.replay, 'the replayed answer can be repeated again');
  const shown = (await state()).chat.messages.findLast(item => item.role === 'user' && item.replayOf);
  assert.equal(shown.displayContent, '기록한 절차를 모델 없이 다시 실행');
  pass('the replay opens the recorded page, finds each target again with the new value, stops for the same approval and registers once, with no model request');

  // 3. The same page with a field renamed: nothing is written.
  renamed = true; await page.goto(`${origin}/sheet?week=39`);
  await ui.getByRole('button', {name: '모델 없이 다시 실행', exact: true}).last().click();
  await ui.locator('.replay-card input').first().waitFor();
  await ui.locator('.replay-card').getByRole('button', {name: '실행', exact: true}).click();
  await until(async () => {const now = await state(); return now.chat.messages.at(-1)?.state === 'error' && now.chat.task?.status === 'paused' && !now.chatLease;}, 'replay stopped');
  const stopped = (await state()).chat.messages.at(-1);
  assert.equal(stopped.error, 'replay_stopped');
  assert.match(stopped.content, /"투입 시간"을\(를\) 지금 페이지에서 찾지 못했습니다/);
  assert.equal(await page.inputValue('input[name="date"]'), '', 'nothing was written before the missing field');
  assert.equal(modelCalls, callsBefore, 'still no model request');
  await ui.getByRole('button', {name: '작업 이어가기', exact: true}).waitFor();
  pass('on a page whose field was renamed the replay stops before writing and offers to continue with the model');
  console.log(`DONE ${count}`);
} finally {
  await context?.close().catch(() => {}); server.close(); await rm(profile, {recursive: true, force: true});
}
