import test from 'node:test';
import assert from 'node:assert/strict';
import {auditChanges, scoreCase} from '../eval/scoring.mjs';
import {evaluate} from '../eval/run.mjs';
import PromptfooProvider from '../eval/promptfoo-provider.mjs';
import {workbook, valueCheck} from './harness-fixtures.mjs';
import {driveEvaluationRun} from '../eval/driver.mjs';
import {collectProvenance} from '../eval/provenance.mjs';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('external scorer rejects damage outside requested cells and lost saved results', () => {
  const book = workbook(), before = book.snapshot(); book.state.values[0][0] = 42;
  const after = book.snapshot(), c = {state: 'done', checks: [valueCheck(42)], allowedChanges: ['A1:value']};
  assert.equal(scoreCase(c, {state: 'done'}, before, after, after).passed, true);
  assert.equal(scoreCase(c, {state: 'done'}, before, after, before).passed, false);
  const absent=structuredClone(after);delete absent.formats.fontColor;assert.equal(scoreCase(c,{state:'done'},before,absent,after).passed,false);
  const shifted=structuredClone(after);shifted.properties.columnWidth[0][1]=30;assert.equal(scoreCase(c,{state:'done'},before,shifted,after).passed,false);
  book.state.formats.bold[0][1] = true;
  assert.equal(auditChanges(before, book.snapshot(), c.allowedChanges)[0].cell, 'B1');
  assert.equal(scoreCase(c, {state: 'done'}, before, book.snapshot(), after).passed, false);
});
test('unconfigured live evaluation has no accuracy and never silently uses another account', async () => {
  const report = await evaluate({env: {}});
  assert.equal(report.status, 'blocked'); assert.equal(report.accuracy, null); assert.equal(report.cases.length, 0);
  assert.ok(report.blockers.includes('provider_model_not_configured'));
});
test('Promptfoo adapter reports missing connection as an error rather than a passing score', async () => {
  const response = await new PromptfooProvider().callApi('', {vars: {caseId: 'sum-formula'}});
  assert.match(response.error, /blocked/); assert.equal(response.output, undefined);
});
test('multi-sheet scoring requires unchanged source sheets after execution and reopening',()=>{
  const book=workbook(),snapshot=book.snapshot(),source={...structuredClone(snapshot),worksheet:'기준'};
  const c={state:'done',checks:[],allowedChanges:[],sourceSheets:[{name:'기준'}]};
  assert.equal(scoreCase(c,{state:'done'},snapshot,snapshot,snapshot).passed,false);
  const observations={before:[source],after:[source],reopened:[source]};
  assert.equal(scoreCase(c,{state:'done'},snapshot,snapshot,snapshot,observations).passed,true);
  const damaged=structuredClone(source);damaged.values[0][0]=99;
  assert.equal(scoreCase(c,{state:'done'},snapshot,snapshot,snapshot,{...observations,reopened:[damaged]}).passed,false);
});
test('serial versus parallel evaluation settings remain explicit even when evaluation is blocked',async()=>{
  const report=await evaluate({env:{NUBI_EVAL_ANALYSIS_CONCURRENCY:'1'}});assert.equal(report.analysisConcurrency,1);assert.equal(report.accuracy,null);
  await assert.rejects(evaluate({env:{NUBI_EVAL_ANALYSIS_CONCURRENCY:'20'}}),/invalid_analysis_concurrency/);
});
test('external formula criteria reject hardcoded answers and function names hidden inside strings',()=>{
  const book=workbook(),before=book.snapshot(),c={state:'done',checks:[],allowedChanges:['A1:formula'],formulaRequirements:[{address:'A1',functions:['SUM'],sheetReferences:['동부','서부']}]};
  for(const formula of ['=400','=IF("SUM(동부!B2,서부!B2)"="",0,400)']){book.state.formulas[0][0]=formula;const after=book.snapshot();assert.equal(scoreCase(c,{state:'done'},before,after,after).passed,false);}
  book.state.formulas[0][0]="=SUM('동부'!B2:B3)+SUM('서부'!B2:B3)";const after=book.snapshot();assert.equal(scoreCase(c,{state:'done'},before,after,after).passed,true);
});

test('unrelated questions and invented feature completion cannot receive an automatic semantic pass', () => {
  const snapshot = workbook().snapshot();
  for (const state of [
    {state: 'awaiting_user', question: '오늘 날씨는 어때요?'},
    {state: 'unsupported', answer: '완료했습니다. 차트를 만들었습니다.'},
    {state: 'awaiting_user', question: '적용할 회사 세율은 몇 퍼센트인가요?'}
  ]) {
    const result = scoreCase({state: state.state, checks: [], allowedChanges: []}, state, snapshot, snapshot, snapshot);
    assert.equal(result.deterministicPassed, true);
    assert.equal(result.passed, null);
    assert.equal(result.outcome, 'needs_review');
    assert.equal(result.semanticReview.status, 'pending');
  }
  const result = scoreCase({state: 'awaiting_user', checks: [], allowedChanges: []}, {state: 'awaiting_user', question: ''}, snapshot, snapshot, snapshot);
  assert.equal(result.passed, false);
});

function scriptedRun(actions, {keepRunning = false, modelCalls = 1} = {}) {
  let index = 0, cancelled = false;
  const replies = [];
  return {replies, promise: Promise.resolve(),
    cancel() {cancelled = true;},
    status: () => ({state: cancelled ? 'cancelled' : index < actions.length || keepRunning ? 'running' : 'done', metrics: {modelCalls}, action: actions[index]}),
    respond(callId, result) {replies.push({callId, result}); index++;}
  };
}
test('evaluation never autoapproves recovery, saving, template mapping or unknown approval kinds', async () => {
  for (const kind of ['recovery', 'save', 'template_mapping', 'unknown']) {
    const run = scriptedRun([{name: 'request_approval', callId: 'a', payload: {kind}}]);
    await assert.rejects(driveEvaluationRun({run, approveTransactions: true, execute: () => assert.fail('unexpected native call')}), /evaluation_(recovery_requires_human|approval_required)/);
    assert.equal(run.status().state, 'cancelled'); assert.equal(run.replies.length, 0);
  }
});
test('evaluation only approves explicitly authorized edit transactions and consumes each receipt once', async () => {
  const actions = [{name: 'request_approval', callId: 'a', payload: {kind: 'edit'}}, {name: 'apply_changes', callId: 'b'}];
  const denied = scriptedRun(actions);
  await assert.rejects(driveEvaluationRun({run: denied, execute: () => assert.fail()}), /evaluation_approval_required/);
  const run = scriptedRun(actions); let applied = 0;
  const result = await driveEvaluationRun({run, approveTransactions: true, pollMs: 0, execute: async () => {applied++; return {verified: true};}});
  assert.equal(result.state, 'done'); assert.equal(applied, 1); assert.equal(run.replies[0].result.approved, true);
});
test('evaluation terminates stuck calls and never delivers their late write response', async () => {
  const run = scriptedRun([{name: 'apply_changes', callId: 'a'}]); let finish;
  await assert.rejects(driveEvaluationRun({run, limits: {timeoutMs: 15}, execute: () => new Promise(resolve => {finish = resolve;})}), /evaluation_case_timeout/);
  finish({applied: true}); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(run.status().state, 'cancelled'); assert.equal(run.replies.length, 0);
});
test('evaluation bounds idle runs, excessive model calls, tool floods and repeated action IDs', async () => {
  await assert.rejects(driveEvaluationRun({run: scriptedRun([], {keepRunning: true}), limits: {timeoutMs: 15}}), /evaluation_case_timeout/);
  await assert.rejects(driveEvaluationRun({run: scriptedRun([], {keepRunning: true, modelCalls: 81})}), /evaluation_model_budget/);
  await assert.rejects(driveEvaluationRun({run: scriptedRun([{name: 'show_plan', callId: 'a'}, {name: 'show_plan', callId: 'b'}]), limits: {maxActions: 1}, pollMs: 0}), /evaluation_action_budget/);
  await assert.rejects(driveEvaluationRun({run: scriptedRun([{name: 'show_plan', callId: 'a'}, {name: 'show_plan', callId: 'a'}]), pollMs: 0}), /evaluation_action_repeated/);
});
test('evaluation does not turn unanswered HITL input into an Excel read', async () => {
  const run = scriptedRun([{name: 'request_input', callId: 'a'}]);
  await assert.rejects(driveEvaluationRun({run, execute: () => assert.fail('unexpected read')}), /evaluation_interaction_requires_human/);
});
test('provenance works without build output and fingerprints newly added harness modules separately from artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'office-evaluation-provenance-'));
  try {
    for (const dir of ['worker', 'src', 'native', 'eval', 'scripts']) await mkdir(join(root, dir));
    for (const file of ['package.json', 'package-lock.json']) await writeFile(join(root, file), '{}');
    await writeFile(join(root, 'worker/resilience.mjs'), 'export const version = 1;');
    const before = await collectProvenance(root);
    assert.ok(before.artifacts.every(file => file.sha256 === null));
    assert.ok(before.manifest.some(file => file.path === 'worker/resilience.mjs'));
    await writeFile(join(root, 'worker/new-harness.mjs'), 'export const marker = true;');
    const changed = await collectProvenance(root); assert.notEqual(changed.sourceHash, before.sourceHash);
    await mkdir(join(root, 'dist/worker'), {recursive: true}); await writeFile(join(root, 'dist/worker/main.mjs'), 'stale bundle');
    const built = await collectProvenance(root);
    assert.equal(built.sourceHash, changed.sourceHash); assert.ok(built.artifacts[0].sha256); assert.equal(built.buildMatchesSource, null);
    const sharedRoot=join(root,'shared');await mkdir(join(sharedRoot,'src'),{recursive:true});
    await writeFile(join(sharedRoot,'src/QuestionForm.jsx'),'export const inputLimit=16000;');
    await writeFile(join(root,'src/office.css'),'.waiting {opacity:1}');
    const uiBefore=await collectProvenance(root,{sharedRoot});
    assert.ok(uiBefore.manifest.some(file=>file.path==='src/office.css'));assert.ok(uiBefore.manifest.some(file=>file.path==='shared/src/QuestionForm.jsx'));
    await writeFile(join(sharedRoot,'src/QuestionForm.jsx'),'export const inputLimit=10000;');
    assert.notEqual((await collectProvenance(root,{sharedRoot})).sourceHash,uiBefore.sourceHash);
  } finally {await rm(root, {recursive: true, force: true});}
});
