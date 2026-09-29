import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
import {browserTools, BUILTIN_SKILLS} from '../skills.js';

// Measured on a filter-and-sort request: one plan stage was reviewed nine
// times, each time with a fresh observation, until the caller gave up.
const goal = '검색 필터에서 동영상을 선택하고 업로드 날짜순으로 정렬해 줘.';
const tools = browserTools({}, BUILTIN_SKILLS.find(skill => skill.id === 'browser-agent'));
const call = (name, args = {}) => ({calls: [{id: crypto.randomUUID(), type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
const plan = [{text: '필터와 정렬 적용', status: 'in_progress', expected_outcome: '동영상 필터와 날짜순 정렬이 적용됨'}, {text: '결과 정리', status: 'pending', expected_outcome: '상위 3개 정리'}];

async function run(review) {
  let turn = 0, reviews = 0; const executed = [], questions = [];
  const result = await runAgent({goal, messages: [{role: 'user', content: goal}], tools, harness: true, signal: new AbortController().signal,
    complete: async () => {
      turn++;
      if (turn === 1) return call('update_plan', {steps: plan});
      return turn % 2 === 0 ? call('browser_snapshot') : {content: `필터를 적용했습니다 ${turn}`};
    },
    execute: async (name, args) => {
      executed.push(name);
      if (name === 'update_plan') return {ok: true, plan: args.steps};
      if (name === 'ask_user') {questions.push(args.question); return {requiresUserInput: true};}
      return {url: 'https://example.test/results', frames: [{frame: 0, text: `관찰 ${executed.length}`, elements: []}]};
    },
    reviewGoal: async payload => review(++reviews, payload)}).catch(error => ({error: error.message}));
  return {result, reviews, executed, questions};
}
const revise = {status: 'revise', checks: [{requirement: '정렬 적용 상태 확인', status: 'unknown', evidence_ids: []}], next_step: '정렬 상태를 다시 확인하세요.'};

test('a stage whose review keeps asking for more is handed to the user after four reviews', async () => {
  const {result, reviews, questions, executed} = await run(() => revise);
  assert.equal(reviews, 4); assert.equal(result.awaitingUser, true);
  assert.equal(questions.length, 1);
  assert.match(questions[0], /^다음 단계를 4번 확인했지만 결과를 검증하지 못했습니다: 필터와 정렬 적용\. 계속 확인할까요\?$/);
  assert.equal(result.reviewLimited, undefined);
  assert.equal(executed.at(-1), 'ask_user');
});

test('a stage that passes within the limit continues to the next stage', async () => {
  const {reviews, questions} = await run((index, payload) => index < 3 ? revise
    : {status: 'complete', checks: [{requirement: '확인', status: 'met', evidence_ids: [1]}], next_step: ''});
  assert(reviews >= 3); assert.equal(questions.length, 0);
});
