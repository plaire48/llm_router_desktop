import test from 'node:test';
import assert from 'node:assert/strict';
import {recordTarget, matchTarget, recordStep, replayRecord, runReplay, replayAnswer} from '../browser-replay.js';

const row = name => ({role: 'row', name});
const observation = (elements, frames = []) => ({frames: [{frame: 0, url: 'https://gw.test/draft?id=1', elements}, ...frames]});
const del = (ref, doc, extra = {}) => ({ref, role: 'button', name: '삭제', kind: 'control', tag: 'button', context: [row(`${doc} 김철수`)], ...extra});

test('a recorded target keeps what finds it again and never its ref', () => {
  const seen = observation([del('e-a-0-0', '2026 예산안', {id: 'del-1'}), del('e-a-0-1', '출장 보고서', {id: 'react-select-3-input'})]);
  const target = recordTarget(seen.frames[0].elements[0], seen);
  assert.deepEqual(target, {role: 'button', name: '삭제', kind: 'control', tag: 'button', context: [{role: 'row', name: '2026 예산안 김철수'}], id: 'del-1'});
  assert.equal(recordTarget(seen.frames[0].elements[1], seen).id, undefined, 'a generated id identifies nothing across visits');
});

test('the same control is found by its row in a fresh observation, with its new ref', () => {
  const before = observation([del('e-a-0-0', '2026 예산안'), del('e-a-0-1', '출장 보고서')]);
  const target = recordTarget(before.frames[0].elements[1], before);
  const now = observation([del('e-b-0-0', '신규 문서'), del('e-b-0-1', '2026 예산안'), del('e-b-0-2', '출장 보고서')]);
  assert.equal(matchTarget(target, now).element.ref, 'e-b-0-2');
});

test('a target that is gone or that several controls equally match stops the replay', () => {
  const before = observation([del('e-a-0-0', '출장 보고서')]);
  const target = recordTarget(before.frames[0].elements[0], before);
  assert.deepEqual(matchTarget(target, observation([del('e-b-0-0', '2026 예산안')])), {error: 'missing', candidates: 0});
  const twice = observation([del('e-b-0-0', '출장 보고서'), del('e-b-0-1', '출장 보고서')]);
  assert.deepEqual(matchTarget(target, twice), {error: 'ambiguous', candidates: 2});
});

test('controls that look the same are told apart by their place only when the page has as many', () => {
  const plain = ref => ({ref, role: 'button', name: '삭제', kind: 'control', tag: 'button'});
  const before = observation([plain('e-a-0-0'), plain('e-a-0-1'), plain('e-a-0-2')]);
  const target = recordTarget(before.frames[0].elements[1], before);
  assert.deepEqual([target.ordinal, target.alike], [1, 3]);
  assert.equal(matchTarget(target, observation([plain('e-b-0-0'), plain('e-b-0-1'), plain('e-b-0-2')])).element.ref, 'e-b-0-1');
  assert.equal(matchTarget(target, observation([plain('e-b-0-0'), plain('e-b-0-1')])).error, 'ambiguous');
});

test('a field is found by its name and column; a renamed or re-roled control is not the same', () => {
  const cell = (ref, day, column) => ({ref, role: 'textbox', name: '투입 시간', kind: 'field', tag: 'input', context: [row(day)], column});
  const before = observation([cell('e-a-0-0', '검색 기능', '월'), cell('e-a-0-1', '검색 기능', '화')]);
  const target = recordTarget(before.frames[0].elements[1], before);
  assert.equal(matchTarget(target, observation([cell('e-b-0-0', '검색 기능', '월'), cell('e-b-0-1', '검색 기능', '화')])).element.ref, 'e-b-0-1');
  assert.equal(matchTarget(target, observation([cell('e-b-0-0', '검색 기능', '수')])).error, 'missing');
  const link = {...before.frames[0].elements[1], ref: 'e-b-0-5', role: 'link'};
  assert.equal(matchTarget(target, observation([link])).error, 'missing');
});

test('a control under a dialog or overlay is reported as covered, not clicked', () => {
  const ok = (ref, extra = {}) => ({ref, role: 'button', name: '확인', kind: 'control', tag: 'button', ...extra});
  const before = observation([ok('e-a-0-0', {id: 'pageOk'})]);
  const target = recordTarget(before.frames[0].elements[0], before);
  assert.deepEqual(matchTarget(target, observation([ok('e-b-0-0', {id: 'pageOk', coveredBy: 'dialog "결재선 지정"'})])), {error: 'covered', candidates: 1, coveredBy: 'dialog "결재선 지정"'});
});

test('a target in a frame is looked for in the frame with the same address', () => {
  const body = ref => ({ref, role: 'textbox', name: '본문', kind: 'field', tag: 'body'});
  const before = {frames: [{frame: 0, url: 'https://mail.test/compose', elements: []}, {frame: 1, url: 'https://mail.test/editor.html?x=1', elements: [body('e-a-1-0')]}]};
  const target = recordTarget(before.frames[1].elements[0], before);
  assert.equal(target.frame, 'https://mail.test/editor.html');
  const now = {frames: [{frame: 0, url: 'https://mail.test/compose', elements: [body('e-b-0-9')]}, {frame: 1, url: 'https://mail.test/editor.html?x=2', elements: [body('e-b-1-0')]}]};
  assert.equal(matchTarget(target, now).element.ref, 'e-b-1-0');
});

// A time sheet run: fill three fields, verify them, ask for approval, register, verify.
const field = (ref, name) => ({ref, role: 'textbox', name, kind: 'field', tag: 'input', context: [{role: 'form', name: '업무 기록'}]});
const sheet = (prefix, extra = []) => ({url: 'https://iwms.test/sheet', frames: [{frame: 0, url: 'https://iwms.test/sheet?week=39', elements: [
  field(`${prefix}-0`, '업무 날짜'), field(`${prefix}-1`, '투입 시간'), field(`${prefix}-2`, '업무 내용'),
  {ref: `${prefix}-3`, role: 'button', name: '등록', kind: 'control', tag: 'button', context: [{role: 'form', name: '업무 기록'}]}, ...extra]}]});
function recorded() {
  const log = {steps: [], values: {}}; let n = 0; const slot = () => `v${n++}`;
  const add = (tool, args, observation, result) => {const step = recordStep(tool, args, observation, result, slot); if (step?.step) {log.steps.push(step.step); Object.assign(log.values, step.values);} else if (step?.unreplayable) log.unreplayable = step.unreplayable;};
  const a = sheet('a');
  add('browser_snapshot', {}, a, a);
  add('fill_form', {fields: [{field_id: 'a-0', value: '2026-09-24'}, {field_id: 'a-1', value: '8'}, {field_id: 'a-2', value: '로그인 오류 분석'}]}, a, {applied: 3, verified: true});
  add('verify_page', {checks: [{kind: 'field_value', ref: 'a-0', expected: '2026-09-24'}, {kind: 'field_value', ref: 'a-1', expected: '8'}]}, a, {ok: true, verified: true});
  add('request_approval', {ref: 'a-3'}, a, {requiresUserInput: true});
  add('apply_approved_action', {}, a, {ok: true});
  add('verify_page', {checks: [{kind: 'text_present', expected: '등록 완료'}]}, a, {ok: true, verified: true});
  return log;
}

test('a verified run is recorded as steps without refs or values, and the inputs to ask for', () => {
  const log = recorded(), record = replayRecord(log, {id: 'r1', goal: '공수 입력'});
  assert.deepEqual(record.steps.map(step => step.tool), ['fill_form', 'verify_page', 'request_approval', 'apply_approved_action', 'verify_page']);
  assert(!JSON.stringify(record).includes('a-0'), 'no ref is kept');
  assert(!JSON.stringify(record).includes('로그인 오류 분석'), 'no typed value is kept in the record');
  assert.deepEqual(record.inputs.map(input => input.label), ['업무 날짜 · 업무 기록', '투입 시간 · 업무 기록', '업무 내용 · 업무 기록']);
  assert.deepEqual(record.linked, {v3: 'v0', v4: 'v1'}, 'a check of a typed value follows that value');
  assert.equal(log.values.v2, '로그인 오류 분석');
  assert.equal(replayRecord({...log, unreplayable: 'click_at'}, {id: 'r2'}), null, 'a run that clicked coordinates is not replayed');
  assert.equal(replayRecord({steps: log.steps.filter(step => step.tool !== 'verify_page')}, {id: 'r3'}), null, 'a run with no passed check is not replayed');
});

test('a replay issues each step on the fresh refs with the new values, and stops at the approval card', async () => {
  const record = replayRecord(recorded(), {id: 'r1'});
  const calls = []; let turn = 0;
  const executeTool = async (name, args) => {
    calls.push([name, args]); const now = sheet(`b${++turn}`);
    if (name === 'browser_snapshot') return now;
    if (name === 'request_approval') return {requiresUserInput: true, questionId: 'q'};
    return {ok: true, verified: true, applied: 3, observation: now};
  };
  const values = {v0: '2026-10-01', v1: '6', v2: '검색 기능 점검', v5: '등록 완료'};
  const outcome = await runReplay({steps: record.steps, values, linked: record.linked}, {executeTool});
  assert.deepEqual(outcome, {awaitingApproval: {index: 2}});
  assert.deepEqual(calls.map(call => call[0]), ['browser_snapshot', 'fill_form', 'verify_page', 'request_approval']);
  assert.deepEqual(calls[1][1], {fields: [{field_id: 'b1-0', value: '2026-10-01'}, {field_id: 'b1-1', value: '6'}, {field_id: 'b1-2', value: '검색 기능 점검'}]});
  assert.deepEqual(calls[2][1].checks.map(check => [check.ref, check.expected]), [['b2-0', '2026-10-01'], ['b2-1', '6']], 'checks follow the new values');
  assert.equal(calls[3][1].ref, 'b3-3');
});

test('after approval the replay issues the approved action and its check, still without the model', async () => {
  const record = replayRecord(recorded(), {id: 'r1'});
  const calls = [];
  const executeTool = async (name, args) => {calls.push([name, args]); return {ok: true, verified: true, observation: sheet('c')};};
  const outcome = await runReplay({steps: record.steps, values: {v5: '등록 완료'}, linked: record.linked, startAt: 3, approved: true}, {executeTool});
  assert.deepEqual(calls.map(call => call[0]), ['apply_approved_action', 'verify_page']);
  assert.deepEqual(calls[1][1], {checks: [{kind: 'text_present', expected: '등록 완료'}]});
  assert.deepEqual(outcome, {completed: {steps: 2, filled: 0, checked: 1}});
  assert.match(replayAnswer(outcome), /모델 없이 다시 실행했습니다\. 확인 1개가 통과했습니다\./);
});

test('a field that is gone stops the replay before any write, with the reason in words', async () => {
  const record = replayRecord(recorded(), {id: 'r1'});
  const calls = [];
  const changed = {url: 'https://iwms.test/sheet', frames: [{frame: 0, url: 'https://iwms.test/sheet', elements: [field('d-0', '업무 날짜'), field('d-2', '업무 내용')]}]};
  const executeTool = async (name, args) => {calls.push(name); return name === 'browser_snapshot' ? changed : {ok: true};};
  const outcome = await runReplay({steps: record.steps, values: {v0: 'x', v1: 'y', v2: 'z'}, linked: record.linked}, {executeTool});
  assert.deepEqual(calls, ['browser_snapshot'], 'nothing was written');
  assert.match(outcome.stopped.text, /1번째 단계의 대상 "투입 시간"을\(를\) 지금 페이지에서 찾지 못했습니다\./);
  assert.match(replayAnswer(outcome), /작업 이어가기/);
});

test('a page that left controls out is looked at again by the target name before stopping', async () => {
  const record = replayRecord(recorded(), {id: 'r1'});
  const partial = {url: 'https://iwms.test/sheet', frames: [{frame: 0, url: 'https://iwms.test/sheet', omittedControls: 40, elements: [field('e-0', '업무 날짜')]}]};
  const queries = [];
  const executeTool = async (name, args) => {
    if (name === 'browser_snapshot') {queries.push(args.query || ''); return args.query ? sheet('f') : partial;}
    return name === 'request_approval' ? {requiresUserInput: true} : {ok: true, verified: true, observation: sheet('g')};
  };
  const outcome = await runReplay({steps: record.steps, values: {v0: '1', v1: '2', v2: '3'}, linked: record.linked}, {executeTool});
  assert.deepEqual(outcome, {awaitingApproval: {index: 2}});
  assert.deepEqual(queries, ['', '투입 시간']);
});

test('a replay that began on another page opens the recorded start page first', async () => {
  const record = replayRecord({...recorded(), startPage: 'https://iwms.test/sheet'}, {id: 'r1'});
  const calls = [];
  const elsewhere = {url: 'https://portal.test/home', frames: [{frame: 0, url: 'https://portal.test/home', elements: []}]};
  const executeTool = async (name, args) => {
    calls.push([name, args]);
    if (name === 'browser_snapshot') return elsewhere;
    if (name === 'navigate_page') return {ok: true, observation: sheet('h')};
    return name === 'request_approval' ? {requiresUserInput: true} : {ok: true, verified: true, observation: sheet('i')};
  };
  await runReplay({steps: record.steps, values: {v0: '1', v1: '2', v2: '3'}, linked: record.linked, startPage: record.startPage, startURL: 'https://iwms.test/sheet?week=40'}, {executeTool});
  assert.deepEqual(calls[1], ['navigate_page', {url: 'https://iwms.test/sheet?week=40'}]);
  assert.equal(calls[2][0], 'fill_form');
});

// The step kinds added after the first release: coordinates, drags, tabs, scripts, files.
const page2 = (prefix, extra = []) => ({url: 'https://gw.test/list', frames: [{frame: 0, url: 'https://gw.test/list', elements: [
  {ref: `${prefix}-0`, role: 'button', name: '결재선 지정', kind: 'control', tag: 'span'},
  {ref: `${prefix}-1`, role: 'listitem', name: '김철수', kind: 'control', tag: 'li', context: [{role: 'list', name: '조직도'}]},
  {ref: `${prefix}-2`, role: 'list', name: '결재선', kind: 'control', tag: 'ul'},
  {ref: `${prefix}-3`, role: 'textbox', name: '제목', kind: 'field', tag: 'input'},
  {ref: `${prefix}-4`, role: 'link', name: '교육 자료', kind: 'link', tag: 'a'}, ...extra]}]});
function recordAll(calls) {
  const log = {steps: [], values: {}}; let n = 0, uploadTargets = {};
  for (const [tool, args, observation, result] of calls) {
    const step = recordStep(tool, args, observation, result, () => `v${n++}`, {uploadTargets});
    if (step?.uploadTargets) uploadTargets = step.uploadTargets;
    else if (step?.step) {log.steps.push(step.step); Object.assign(log.values, step.values);}
    else if (step?.unreplayable) log.unreplayable = step.unreplayable;
  }
  return log;
}

test('a click at a point is kept as a click on the control it pressed; without one it is not replayable', () => {
  const seen = page2('a');
  const log = recordAll([['click_at', {screenshot_id: 's', x: 10, y: 20}, seen, {ok: true, pointedRef: 'a-0'}]]);
  assert.deepEqual(log.steps, [{tool: 'click_element', target: recordTarget(seen.frames[0].elements[0], seen), args: {}, via: 'click_at'}]);
  assert.equal(recordAll([['click_at', {x: 1, y: 2}, seen, {ok: true}]]).unreplayable, 'point', 'a canvas point names no control');
});

test('drags, tab switches, scripts and file transfers replay on the page as it is now', async () => {
  const seen = page2('a');
  const log = recordAll([
    ['drag_element', {source_ref: 'a-1', target_ref: 'a-2'}, seen, {ok: true}],
    ['switch_tab', {tab_id: '101'}, seen, {ok: true, observation: {url: 'https://gw.test/popup?id=3', title: '결재선 지정'}}],
    ['run_playwright', {code: 'await browser.ref("a-3").fill("10월 교육 안내"); await browser.ref(\'a-3\').press("Tab");'}, seen, {ok: true}],
    ['list_upload_targets', {}, seen, {targets: [{ref: 'upload-1', label: '첨부 파일', url: 'https://gw.test/list'}]}],
    ['prepare_file_upload', {ref: 'upload-1', file_ids: ['att-1']}, seen, {requiresUserInput: true}],
    ['apply_approved_action', {}, null, {ok: true}],
    ['prepare_download', {ref: 'a-4'}, seen, {requiresUserInput: true}],
    ['verify_page', {checks: [{kind: 'text_present', expected: '업로드 완료'}]}, seen, {ok: true, verified: true}],
  ]);
  const record = replayRecord(log, {id: 'r9'});
  assert.deepEqual(record.steps.map(step => step.tool), ['drag_element', 'switch_tab', 'run_playwright', 'prepare_file_upload', 'apply_approved_action', 'prepare_download', 'verify_page']);
  assert(!JSON.stringify(record).includes('10월 교육 안내') && !JSON.stringify(record).includes('att-1'), 'script text and attachment ids stay in memory');
  assert.deepEqual(record.memory, ['v0', 'v1']);
  const calls = [];
  const executeTool = async (name, args) => {
    calls.push([name, args]);
    if (name === 'browser_snapshot') return page2('b');
    if (name === 'list_tabs') return {tabs: [{tab_id: '7', url: 'https://gw.test/list', title: '목록'}, {tab_id: '9', url: 'https://gw.test/popup?id=4', title: '결재선 지정'}]};
    if (name === 'list_upload_targets') return {targets: [{ref: 'upload-9', label: '첨부 파일', url: 'https://gw.test/list'}]};
    if (name === 'prepare_file_upload') return {requiresUserInput: true};
    return {ok: true, observation: page2('c')};
  };
  const outcome = await runReplay({steps: record.steps, values: log.values, linked: record.linked}, {executeTool});
  assert.deepEqual(outcome, {awaitingApproval: {index: 3}});
  assert.deepEqual(calls.find(call => call[0] === 'drag_element')[1], {source_ref: 'b-1', target_ref: 'b-2'});
  assert.deepEqual(calls.find(call => call[0] === 'switch_tab')[1], {tab_id: '9'});
  assert.equal(calls.find(call => call[0] === 'run_playwright')[1].code, 'await browser.ref("c-3").fill("10월 교육 안내"); await browser.ref("c-3").press("Tab");');
  assert.deepEqual(calls.find(call => call[0] === 'prepare_file_upload')[1], {ref: 'upload-9', file_ids: ['att-1']});
  const rest = [];
  const after = await runReplay({steps: record.steps, values: log.values, linked: record.linked, startAt: 4, approved: true}, {executeTool: async (name, args) => {rest.push(name); return name === 'prepare_download' ? {requiresUserInput: true} : {ok: true, observation: page2('d')};}});
  assert.deepEqual(rest, ['apply_approved_action', 'prepare_download']);
  assert.deepEqual(after, {awaitingApproval: {index: 5}});
});

test('a script step whose code is no longer in memory, or a tab that is gone, stops the replay', async () => {
  const seen = page2('a');
  const log = recordAll([
    ['run_playwright', {code: 'await browser.ref("a-3").fill("x");'}, seen, {ok: true}],
    ['verify_page', {checks: [{kind: 'text_present', expected: 'x'}]}, seen, {ok: true, verified: true}],
  ]);
  const record = replayRecord(log, {id: 'r10'});
  const outcome = await runReplay({steps: record.steps, values: {}, linked: record.linked}, {executeTool: async name => name === 'browser_snapshot' ? page2('b') : {ok: true}});
  assert.match(outcome.stopped.text, /메모리에만 둔 내용이 필요한데/);
  const tabs = recordAll([['switch_tab', {tab_id: '1'}, seen, {ok: true, observation: {url: 'https://gw.test/popup', title: '팝업'}}], ['verify_page', {checks: [{kind: 'text_present', expected: 'y'}]}, seen, {ok: true, verified: true}]]);
  const gone = await runReplay({steps: replayRecord(tabs, {id: 'r11'}).steps, values: tabs.values}, {executeTool: async name => name === 'browser_snapshot' ? page2('b') : name === 'list_tabs' ? {tabs: []} : {ok: true}});
  assert.match(gone.stopped.text, /전환할 탭\(https:\/\/gw\.test\/popup\)을 찾지 못했습니다/);
});
