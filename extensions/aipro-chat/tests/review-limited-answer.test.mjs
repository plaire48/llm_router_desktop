import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

const goal = '선수의 종목과 소속을 찾아 출처와 함께 알려줘.';
const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent')).filter(tool => tool.function.name !== 'update_plan');
const call = (name, args = {}) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const base = () => ({goal, messages: [{role: 'user', content: goal}], tools, harness: true, signal: new AbortController().signal});
const check = (requirement, status) => ({requirement, status, evidence_ids: []});
const mostlyMet = () => ({status: 'revise', checks: [check('종목 제시', 'met'), check('소속 제시', 'met'), check('출처 URL 제시', 'met'), check('현재 소속의 최신성 근거', 'unknown')], next_step: '현재 소속의 최신성을 입증하세요.'});

test('a read-only run whose stalled final review has no unmet check releases the answer as unverified', async () => {
  let rounds = 0; const executed = [], outcomes = [];
  const result = await runAgent({...base(), recordOutcome: outcome => outcomes.push(outcome),
    complete: async () => ++rounds === 1 ? call('read_page') : {content: '종목은 사브르, 소속은 대전광역시청입니다. 출처: https://example.test/profile'},
    execute: async name => {executed.push(name); assert.equal(name, 'read_page'); return {text: '프로필 본문'};},
    reviewGoal: async () => mostlyMet()});
  assert.deepEqual(executed, ['read_page']);
  assert.notEqual(result.awaitingUser, true);
  assert.match(result.content, /^종목은 사브르/);
  assert.match(result.content, /검증 완료가 아닙니다/);
  assert.match(result.content, /- 현재 소속의 최신성 근거/);
  assert.equal(result.reviewLimited, true);
  assert(outcomes.every(outcome => outcome.verification !== 'passed'));
});

test('an unmet check, a minority of met checks, or a blocked review still withholds the answer', async () => {
  const cases = [
    {review: () => ({...mostlyMet(), checks: [...mostlyMet().checks, check('소속 시점', 'unmet')]}), first: 'read_page'},
    {review: () => ({status: 'revise', checks: [check('종목 제시', 'met'), check('소속', 'unknown'), check('출처', 'unknown')], next_step: 'x'}), first: 'read_page'},
    {review: () => ({...mostlyMet(), status: 'blocked', next_step: '어느 선수인가요?'}), first: 'read_page'}];
  for (const item of cases) {
    let rounds = 0; const executed = [];
    const result = await runAgent({...base(), ...(item.goal ? {goal: item.goal, messages: [{role: 'user', content: item.goal}]} : {}),
      complete: async () => ++rounds === 1 ? call(item.first, item.first === 'click_element' ? {ref: 'c-1'} : {}) : {content: '후보 답변'},
      execute: async name => {executed.push(name); return name === 'ask_user' ? {requiresUserInput: true} : name === 'click_element' ? {ok: true, actionIssued: true, observation: {frames: []}} : {text: '본문'};},
      reviewGoal: async () => item.review()}).catch(error => ({error: error.message}));
    assert.equal(result.reviewLimited, undefined, item.first);
    assert(!/검증 완료가 아닙니다/.test(result.content || ''), item.first);
  }
});
