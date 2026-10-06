import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {BUILTIN_SKILLS, browserTools} from '../skills.js';
import {createHarness, hostVerifiedFill} from '../agent-harness.js';
import {taskReceipt} from '../context-state.js';
import {contextBudget, createRunContext, contextTokens} from '../context-manager.js';

// Measured on the simplest form task: after a fill the host had already read
// back, the model spent two calls (a blocked update_plan, then verify_page) on
// the same values. A read-back that holds is the step's outcome check.
const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent'));
const call = (name, args = {}, id = name) => ({content: '', calls: [{id, type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const base = () => ({messages: [{role: 'user', content: '신청서 입력'}], tools, signal: new AbortController().signal});
const filled = {ok: true, actionIssued: true, applied: 2, matched: 2, verified: true, submitted: false};

test('a fill whose every field read back is its own outcome check; anything less is not', () => {
  assert.equal(hostVerifiedFill('fill_form', filled), true);
  assert.equal(hostVerifiedFill('fill_form', {...filled, otherFields: {passed: true, kept: 3, changed: 0, missing: 0}}), true);
  // A page whose only fields were written has nothing else to keep.
  assert.equal(hostVerifiedFill('fill_form', {...filled, otherFields: {passed: false, kept: 0, changed: 0, missing: 0, reason: 'no_fields'}}), true);
  for (const result of [{...filled, matched: 1, ok: false, verified: false, error: 'fill_not_retained'}, {...filled, invalidFields: 1},
    {...filled, otherFields: {passed: false, kept: 2, changed: 1, reason: 'value_changed'}}, {...filled, otherFields: {passed: false, kept: 2, changed: 0, missing: 1, reason: 'field_missing'}},
    {...filled, effect: {fieldsChanged: {count: 1, first: ['부서']}}}, {...filled, applied: 0, matched: 0}, {...filled, actionIssued: false}])
    assert.equal(hostVerifiedFill('fill_form', result), false, JSON.stringify(result));
  assert.equal(hostVerifiedFill('click_element', {ok: true, verified: true, applied: 1, matched: 1}), false);
  const harness = createHarness(tools);
  harness.observe('fill_form', filled);
  assert.equal(harness.needsCheck(), false);
  harness.observe('fill_form', {...filled, invalidFields: 1});
  assert.equal(harness.needsCheck(), true, 'a field the page marks invalid still needs a look');
  harness.observe('verify_page', {ok: true, verified: true});
  assert.equal(harness.needsCheck(), false);
  harness.observe('click_element', {ok: true, actionIssued: true});
  assert.equal(harness.needsCheck(), true, 'a later click needs its own check');
  const started = taskReceipt({requestId: 'r', steps: []}, 'fill_form', 'start', {});
  assert.equal(started.verification.status, 'pending');
  assert.equal(taskReceipt(started, 'fill_form', 'end', filled).verification.status, 'passed');
  assert.equal(taskReceipt(started, 'fill_form', 'end', {...filled, effect: {fieldsChanged: {count: 2}}}).verification.status, 'pending');
});

test('after a read-back fill the step closes without a separate check', async () => {
  const plan = [{text: '초안 입력', status: 'in_progress'}, {text: '결과 보고', status: 'pending'}];
  const executed = []; let round = 0;
  await runAgent({...base(), harness: true, resumePlan: plan, complete: async () => {
    if (++round === 1) return call('fill_form', {fields: [{field_id: 'f1', value: '초안'}]});
    if (round === 2) return call('update_plan', {steps: [{...plan[0], status: 'completed'}, {...plan[1], status: 'in_progress'}]});
    if (round === 3) return call('ask_user', {question: '등록할까요?'});
    assert.fail('the question pauses the run');
  }, execute: async (name, args) => {executed.push(name); return name === 'ask_user' ? {requiresUserInput: true} : name === 'update_plan' ? {ok: true, plan: args.steps} : filled;}});
  assert.deepEqual(executed, ['fill_form', 'update_plan', 'ask_user']);
});

test('a stage whose review did not pass holds the changes after it in the same response, not its checks', async () => {
  const plan = [{text: '초안 입력', status: 'in_progress', expected_outcome: '초안 입력됨'}, {text: '제출 준비', status: 'pending', expected_outcome: '제출 준비됨'}];
  const closing = [{...plan[0], status: 'completed'}, {...plan[1], status: 'in_progress'}];
  const executed = []; let round = 0, reviews = 0;
  await runAgent({...base(), harness: true, resumePlan: plan, complete: async messages => {
    round++;
    // A click the host cannot read back, then its check: the stage is reviewed when it closes.
    if (round === 1) return call('click_element', {ref: 'c1'});
    if (round === 2) return call('verify_page', {checks: [{kind: 'text_present', expected: '초안'}]}, 'first-check');
    if (round === 3) return {calls: [...call('update_plan', {steps: closing}, 'close').calls, ...call('fill_form', {fields: [{field_id: 'f2', value: '다음'}]}, 'next').calls,
      ...call('verify_page', {checks: [{kind: 'text_present', expected: '초안'}]}, 'check').calls]};
    if (round === 4) {
      assert.equal(JSON.parse(messages.find(message => message.tool_call_id === 'close').content).reason, 'verification_required');
      assert.equal(JSON.parse(messages.find(message => message.tool_call_id === 'next').content).reason, 'stage_not_closed');
      return call('ask_user', {question: '어떻게 할까요?'});
    }
    assert.fail('the question pauses the run');
  }, execute: async (name, args) => {executed.push(name); return name === 'ask_user' ? {requiresUserInput: true} : name === 'update_plan' ? {ok: true, plan: args.steps} : name === 'verify_page' ? {ok: true, verified: true, checks: [{kind: 'text_present', passed: true}]}
    : name === 'click_element' ? {ok: true, actionIssued: true} : filled;},
  reviewGoal: async () => {reviews++; return {status: 'revise', checks: [{requirement: '초안 입력됨', status: 'unmet', evidence_ids: [1]}], next_step: '초안을 다시 확인하세요.'};}});
  assert.equal(reviews, 1);
  assert.deepEqual(executed, ['click_element', 'verify_page', 'verify_page', 'ask_user'], 'the second fill waited; the check ran');
});

test('in a run observed from its start, a reading stage and a stage of read-back fills close without stage reviews', async () => {
  // Measured (candidate 60): reviews of a stage that only looked at the page asked
  // for more checks of what nobody had changed (W-01 five calls, H-10 up to six).
  const plan = [{text: '입력란 확인', status: 'in_progress', expected_outcome: '입력란 확인'}, {text: '초안 입력', status: 'pending', expected_outcome: '초안 입력됨'}, {text: '결과 보고', status: 'pending', expected_outcome: '결과 보고'}];
  const executed = []; let round = 0, reviews = 0;
  // As in the product (src/api.js), a planner is available for a run that has none yet.
  await runAgent({...base(), harness: true, preparePlan: async () => plan, complete: async messages => {
    round++;
    if (round === 1) return call('update_plan', {steps: plan});
    if (round === 2) {
      assert(messages.some(message => message.role === 'tool' && /입력 양식/.test(String(message.content))), 'the first page read followed the plan in the same round');
      return call('update_plan', {steps: [{...plan[0], status: 'completed'}, {...plan[1], status: 'in_progress'}, plan[2]]});
    }
    if (round === 3) return call('fill_form', {fields: [{field_id: 'f1', value: '초안'}]});
    if (round === 4) return call('update_plan', {steps: [{...plan[0], status: 'completed'}, {...plan[1], status: 'completed'}, {...plan[2], status: 'in_progress'}]});
    if (round === 5) return call('ask_user', {question: '등록할까요?'});
    assert.fail('the question pauses the run');
  }, execute: async (name, args) => {executed.push(name); return name === 'ask_user' ? {requiresUserInput: true} : name === 'update_plan' ? {ok: true, plan: args.steps}
    : name === 'browser_snapshot' ? {url: 'https://example.test/form', frames: [{frame: 0, text: '입력 양식', elements: []}]} : filled;},
  reviewGoal: async () => {reviews++; return {status: 'complete', checks: [], next_step: ''};}});
  assert.deepEqual(executed, ['update_plan', 'browser_snapshot', 'update_plan', 'fill_form', 'update_plan', 'ask_user']);
  assert.equal(reviews, 0, 'neither stage changed anything the host could not read back');
});

test('the model window decides where history is summarized, and a large request the server could not answer lowers it', async () => {
  // AI Pro's windows: glm-5.2 524288, qwen3.8-27b 262144, gpt-oss-120b 131072.
  for (const [contextLength, trigger] of [[524288, 449740], [262144, 213811], [131072, 83559]]) assert.equal(contextBudget({contextLength}).trigger, trigger, String(contextLength));
  const small = contextBudget({contextLength: 64000});
  assert.equal(small.trigger, Math.floor(small.input * .75), 'under a 128K input budget one observation is a large share of it');
  assert.equal(contextBudget({}).trigger, 90000, 'an unknown window keeps the default budget');
  // The provider's count of the whole input replaces the estimate as it is.
  const model = {name: 'qwen3.8-27b', contextLength: 262144};
  const wire = [{role: 'system', content: '지침'}, {role: 'user', content: '가'.repeat(40000)}];
  const run = createRunContext({model, tools: [], goal: '조사', invoke: async () => ({content: '{}'}), signal: new AbortController().signal});
  const estimate = contextTokens(wire, []);
  run.record({prompt_tokens: Math.round(estimate * .5)}, wire);
  assert(Math.abs(run.size(wire) - estimate * .5) <= 1, 'a ratio of one half is taken, not floored at .7');
  run.record({prompt_tokens: Math.round(estimate * .1)}, wire);
  assert(Math.abs(run.size(wire) - estimate * .1) <= 1, 'the exact measured prefix accepts a valid count even outside the estimator ratio bounds');
  const tail = {role: 'assistant', content: 'a new result'};
  assert.equal(run.size([...wire, tail]), Math.round(estimate * .1) + contextTokens([tail]) - contextTokens([]), 'new results use their own estimate rather than the old prose ratio');
  const edited = [{...wire[0], content: 'updated instruction'}, wire[1]];
  assert.equal(run.size(edited), Math.ceil(contextTokens(edited) * (Math.round(estimate * .5) / estimate)), 'edited requests invalidate exact prefix measurement and retain the last bounded ratio');
  // A server failure at a large size becomes that model's limit (less a fifth):
  // a later run summarizes a history the window alone would still have taken.
  assert.equal(run.pressure(wire), false, 'a small request is not blamed on its size');
  const pressured = {name: 'pressure-test-model', contextLength: 262144}, fresh = {name: 'fresh-test-model', contextLength: 262144};
  const summary = JSON.stringify({goal: '조사', constraints: [], decisions: [], completed: [], pending: [], references: []});
  const history = tokens => [{role: 'system', content: '지침'}, {role: 'user', content: '조사'},
    ...Array.from({length: 6}, (_, i) => ({role: i % 2 ? 'user' : 'assistant', content: 'a'.repeat(Math.floor(tokens / 6) * 4)}))];
  const contextFor = model => createRunContext({model, tools: [], goal: '조사', invoke: async () => ({content: summary}), signal: new AbortController().signal});
  const failed = contextFor(pressured), failedWire = history(150000);
  assert(failed.size(failedWire) >= failed.largeInput);
  assert.equal(failed.pressure(failedWire), true);
  const later = history(130000);
  assert.equal((await contextFor(fresh).prepare(later)).length, later.length, '130K is under the window trigger of 213,811');
  const compacted = await contextFor(pressured).prepare(later);
  assert(compacted.length < later.length && compacted.some(message => String(message.content).includes('Current task memory')), 'the pressured model summarizes from 120K');
});

test('a check and the plan update after it run in one response; a plan update after any other operation still waits', async () => {
  const plan = [{text: '팝업 열기', status: 'in_progress', expected_outcome: '참석 설정 팝업이 열림'}, {text: '결과 보고', status: 'pending', expected_outcome: '열린 팝업 보고'}];
  const closing = [{...plan[0], status: 'completed'}, {...plan[1], status: 'in_progress'}];
  const executed = []; let round = 0, reviews = 0;
  await runAgent({...base(), harness: true, resumePlan: plan, complete: async messages => {
    round++;
    if (round === 1) return call('click_element', {ref: 'c1'});
    if (round === 2) return {calls: [...call('verify_page', {checks: [{kind: 'text_present', expected: '참석 설정'}]}, 'check').calls, ...call('update_plan', {steps: closing}, 'close').calls]};
    if (round === 3) {
      assert.equal(JSON.parse(messages.find(message => message.tool_call_id === 'close').content).ok, true, 'the plan update after the check was not deferred');
      return call('ask_user', {question: '계속할까요?'});
    }
    assert.fail('the question pauses the run');
  }, execute: async (name, args) => {executed.push(name); return name === 'ask_user' ? {requiresUserInput: true} : name === 'update_plan' ? {ok: true, plan: args.steps}
    : name === 'verify_page' ? {ok: true, verified: true, checks: [{kind: 'text_present', passed: true}]} : {ok: true, actionIssued: true};},
  reviewGoal: async () => {reviews++; return {status: 'complete', checks: [{requirement: '팝업 열림', status: 'met', evidence_ids: [1]}], next_step: ''};}});
  assert.deepEqual(executed, ['click_element', 'verify_page', 'update_plan', 'ask_user']);
  assert.equal(reviews, 1, 'the closed stage still got its review');
});

test('a lookup closes a step after a click without a check, and still checks the latest outcome once before its answer', async () => {
  // Measured: every institution of a three-library lookup (H-04) cost a refused
  // update_plan and a verify_page; and without the check before the answer the
  // host withheld a reviewed answer as unverified (M-10, candidate 58).
  const plan = [{text: '처리 건수 조회', status: 'in_progress', expected_outcome: '처리 건수 확인'}, {text: '결과 보고', status: 'pending', expected_outcome: '건수 보고'}];
  const executed = [], closed = []; let round = 0, repaired = false;
  const result = await runAgent({messages: [{role: 'user', content: '처리 건수를 조회해 줘'}], tools, signal: new AbortController().signal, harness: true, complete: async messages => {
    round++;
    if (round === 1) return call('update_plan', {steps: plan});
    if (round === 2) return call('click_element', {ref: 'query'});
    if (round === 3) return call('update_plan', {steps: [{...plan[0], status: 'completed'}, {...plan[1], status: 'in_progress'}]}, 'close');
    if (round === 4) {
      assert.equal(JSON.parse(messages.find(message => message.tool_call_id === 'close').content).ok, true, 'the lookup step closed without a check');
      return {content: '처리 완료 37건입니다.', calls: null};
    }
    if (!repaired && !executed.includes('verify_page')) {repaired = true; return call('verify_page', {checks: [{kind: 'text_present', expected: '처리 완료 37건'}]});}
    return {content: '처리 완료 37건입니다.', calls: null};
  }, execute: async (name, args) => {
    executed.push(name); if (name === 'update_plan') closed.push(args.steps.map(step => step.status).join());
    return name === 'update_plan' ? {ok: true, plan: args.steps} : name === 'verify_page' ? {ok: true, verified: true, checks: [{kind: 'text_present', passed: true}]} : {ok: true, actionIssued: true, observation: {url: 'https://example.test/', frames: []}};
  }, reviewGoal: async () => ({status: 'complete', checks: [{requirement: '처리 건수 보고', status: 'met', evidence_ids: [1]}], next_step: ''})});
  assert(executed.includes('verify_page'), `the answer waited for one check: ${executed.join()}`);
  assert.equal(executed.filter(name => name === 'verify_page').length, 1);
  assert.equal(result.awaitingUser, undefined);
});
