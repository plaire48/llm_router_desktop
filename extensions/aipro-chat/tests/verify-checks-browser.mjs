// Real Chrome: a malformed verify_page check says which check is wrong and how
// to correct it. Measured (M-08, candidate 39): two calls failed whole with a
// hint about scripts, and the model read the select value with scripts instead,
// which the review never took as a check. A select is checked with field_value
// and the value of the chosen option. A state shown only in class names (a
// starred row) is checked by its state word.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp, cp, readFile, writeFile, appendFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';

const page = `<!doctype html><html lang="ko"><title>신청 설정</title><body><form aria-label="신청 설정">
<label>참석 유형 <select id="kind"><option value="onsite">현장</option><option value="online">온라인</option></select></label>
<label>현장 메모 <input id="memo" value="기존 현장 안내"></label></form>
<button id="alert" type="button" role="switch" aria-checked="true">알림</button><button id="query" type="button" disabled>조회</button><button id="save" type="button">저장</button>
<div class="mails">${Array.from({length: 4}, (_, i) => `<div class="row" data-row="${i}"><button type="button" class="star" title="중요">☆</button><span>보낸사람${i} 교육 안내 ${i}</span></div>`).join('')}</div>
<script>for (const star of document.querySelectorAll('.star')) star.addEventListener('click', () => star.closest('.row').classList.toggle('starred'));</script></body></html>`;
const server = createServer((req, res) => {res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(page);});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'nubi-verify-checks-')), extension = resolve(profile, 'extension');
let context, count = 0;
const pass = label => {count++; console.log('PASS ' + label);};
try {
  await cp(process.env.NUBI_DIST || 'dist', extension, {recursive: true});
  const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8')); manifest.host_permissions.push(`${origin}/*`);
  await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
  await appendFile(resolve(extension, 'background.js'), '\nglobalThis.contentTest={runBrowserAgent,stopBrowserAgent,ready:serial(()=>Promise.resolve())};\n');
  context = await chromium.launchPersistentContext(profile, {headless: true, executablePath: process.env.CHROME_BINARY, args: [`--load-extension=${extension}`, `--disable-extensions-except=${extension}`]});
  const first = await context.newPage(); await first.goto(origin + '/start');
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(async () => {await contentTest.ready; await chrome.storage.local.set({browserWorkMode: 'current'});});
  await first.close();
  const url = `${origin}/form`, tab = await context.newPage(); await tab.goto(url);
  const tabId = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url).id, url);
  const run = (name, args = {}) => worker.evaluate(({tabId, name, args}) => contentTest.runBrowserAgent('checks', {tabId}, name, args).then(value => value.result), {tabId, name, args});
  const refs = result => {
    const elements = (result.observation || result).frames.flatMap(frame => frame.elements || []);
    return {kind: elements.find(el => el.name === '참석 유형'), memo: elements.find(el => el.name === '현장 메모')};
  };

  let latest = await run('browser_snapshot'), {kind, memo} = refs(latest);
  assert.deepEqual(kind.options.map(option => [option.value, option.label]), [['onsite', '현장'], ['online', '온라인']], 'the select lists option values and labels');
  // Measured with two models: a select's chosen option was checked as control_state
  // three times in a row and refused each time. It is judged as the chosen option.
  latest = await run('verify_page', {checks: [{kind: 'control_state', ref: kind.ref, expected: '현장'}, {kind: 'control_state', ref: kind.ref, expected: 'onsite'}, {kind: 'field_value', ref: memo.ref, expected: '기존 현장 안내'}]});
  assert.equal(latest.error, undefined, JSON.stringify(latest).slice(0, 300)); assert.equal(latest.verified, true, JSON.stringify(latest.checks));
  assert.deepEqual(latest.checks.slice(0, 2).map(check => check.checkedAs), ['chosen_option', 'chosen_option']);
  ({kind, memo} = refs(latest));
  latest = await run('verify_page', {checks: [{kind: 'control_state', ref: kind.ref, expected: '온라인'}]});
  assert.equal(latest.verified, false); assert.equal(latest.checks[0].passed, false);
  pass('a control_state check on a select is judged by its chosen option, by label or value');
  ({kind, memo} = refs(latest));
  latest = await run('verify_page', {checks: [{kind: 'control_state', ref: kind.ref, expected: 'x'.repeat(201)}, {kind: 'field_value', ref: memo.ref, expected: '기존 현장 안내'}]});
  assert.equal(latest.error, 'tool_arguments_invalid'); assert.equal(latest.reason, 'check_invalid');
  assert.deepEqual(latest.invalidChecks.map(item => [item.index, item.kind]), [[0, 'control_state']], JSON.stringify(latest.invalidChecks));
  assert.match(latest.instruction, /Correct only those/); assert.doesNotMatch(latest.instruction, /small script/);
  assert(latest.observation?.frames?.length, 'a fresh observation comes with the error');
  pass('a malformed control_state check is still named and refused before any check runs');

  ({kind, memo} = refs(latest));
  latest = await run('verify_page', {checks: [{kind: 'field_value', ref: kind.ref, expected: 'onsite'}, {kind: 'field_value', ref: memo.ref, expected: '기존 현장 안내'}]});
  assert.equal(latest.verified, true, JSON.stringify(latest).slice(0, 400));
  pass('the corrected check passes: a select is checked with field_value and the chosen option value');

  ({kind} = refs(latest));
  latest = await run('verify_page', {checks: [{kind: 'field_value', ref: kind.ref, expected: 'onsite'}, {kind: 'option_selected', ref: kind.ref, expected: '현장'}]});
  assert.deepEqual(latest.invalidChecks.map(item => item.index), [1]); assert.match(latest.invalidChecks[0].problem, /kind must be one of/);
  latest = await run('verify_page', {checks: []});
  assert.equal(latest.reason, 'check_invalid'); assert.match(latest.invalidChecks[0].problem, /list of 1 to \d+ checks/);
  pass('an unknown kind and an empty list are named too');

  // A star that only adds "starred" to its row: its state is checked by that word, read now.
  const stars = result => (result.observation || result).frames.flatMap(frame => frame.elements || []).filter(el => el.role === 'button' && el.context?.some(c => /보낸사람/.test(c.name || '')));
  const starOf = (result, row) => stars(result).find(el => el.context?.some(c => c.name?.includes(`보낸사람${row} `)));
  latest = await run('click_element', {ref: starOf(await run('browser_snapshot'), 2).ref});
  assert.equal(latest.effect?.controlsChanged?.[0]?.to?.row, 'starred', JSON.stringify(latest.effect));
  latest = await run('verify_page', {checks: [{kind: 'control_state', ref: starOf(latest, 2).ref, expected: 'true'}]});
  assert.equal(latest.checks[0].reason, 'check_target_incompatible');
  assert.deepEqual(latest.checks[0].stateWords, {own: [], row: ['starred']});
  assert.match(latest.checks[0].instruction, /control_state with one of them/);
  pass('a star shown only in its row class is named with its state words when checked as true');

  latest = await run('verify_page', {checks: [{kind: 'control_state', ref: starOf(latest, 2).ref, expected: 'starred'}, {kind: 'control_state', ref: starOf(latest, 1).ref, expected: 'starred'}]});
  assert.deepEqual(latest.checks.map(check => check.passed), [true, false], JSON.stringify(latest.checks));
  assert.equal(latest.checks[1].reason, undefined, 'an unstarred row is a failed check, not an incompatible one');
  pass('control_state with the state word checks the starred row and fails for another row');

  // Measured with Luna (E-10, M-10): a switch with aria-checked="true" checked as
  // "on" failed, and a button checked as "enabled" was refused.
  const control = name => (latest.observation || latest).frames.flatMap(frame => frame.elements || []).find(el => el.name === name);
  latest = await run('browser_snapshot');
  latest = await run('verify_page', {checks: [{kind: 'control_state', ref: control('알림').ref, expected: 'on'}, {kind: 'control_state', ref: control('알림').ref, expected: 'checked'},
    {kind: 'control_state', ref: control('조회').ref, expected: 'disabled'}, {kind: 'control_state', ref: control('저장').ref, expected: 'enabled'}]});
  assert.equal(latest.verified, true, JSON.stringify(latest.checks));
  assert.deepEqual(latest.checks.map(check => check.checkedAs), ['state', 'state', 'disabled_state', 'disabled_state']);
  latest = await run('verify_page', {checks: [{kind: 'control_state', ref: control('알림').ref, expected: 'off'}, {kind: 'control_state', ref: control('조회').ref, expected: 'enabled'}]});
  assert.deepEqual(latest.checks.map(check => check.passed), [false, false], JSON.stringify(latest.checks));
  pass('an ARIA switch is judged "on" by aria-checked, and a button "enabled" or "disabled" by its disabled state');
  console.log(`DONE ${count}`);
} finally {
  await context?.close().catch(() => {}); server.close(); await rm(profile, {recursive: true, force: true});
}
