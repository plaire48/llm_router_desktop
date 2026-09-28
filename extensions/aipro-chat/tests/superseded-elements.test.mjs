import test from 'node:test';
import assert from 'node:assert/strict';
import {clearSupersededElements} from '../context-evidence.js';

const elements = (count, tag) => Array.from({length: count}, (_, i) => ({ref: `c-${tag}-${i}`, name: `항목 ${i} ${'가'.repeat(30)}`, role: 'link', kind: 'link', tag: 'a', inViewport: true, destination: `https://example.test/${tag}/${i}`, type: '', disabled: false}));
const observation = (tag, count = 60) => ({title: tag, url: 'https://example.test/' + tag, frames: [{frame: 0, url: 'https://example.test/' + tag, elements: elements(count, tag), text: `본문 ${tag}`, headings: [{level: 1, name: tag}]}]});
let id = 0;
const pair = (name, result) => {const call = `call-${++id}`; return [{role: 'assistant', content: '', tool_calls: [{id: call, type: 'function', function: {name, arguments: '{}'}}]}, {role: 'tool', tool_call_id: call, content: JSON.stringify(result)}];};
const parsed = message => JSON.parse(message.content);

test('only element lists older than the two latest DOM results are removed', () => {
  const wire = [{role: 'system', content: 's'}, {role: 'user', content: '검색해줘'}, ...pair('inspect_dom', observation('home')),
    ...pair('fill_form', {ok: true, applied: 1, verified: false, fields: [{ref: 'c-home-1', value_set: true}], observation: observation('home-filled')}),
    ...pair('press_key', {ok: true, inputExecution: {commands: [{method: 'press', key: 'Enter'}]}, observation: observation('results')}),
    ...pair('browser_snapshot', observation('results-2'))];
  const next = clearSupersededElements(wire), tools = next.filter(message => message.role === 'tool').map(parsed);
  assert.equal(tools[0].frames[0].elements, undefined);
  assert.deepEqual(tools[0].frames[0].elementsCleared, {count: 60, reason: 'superseded_observation'});
  assert.equal(tools[0].frames[0].text, '본문 home'); assert.deepEqual(tools[0].frames[0].headings, [{level: 1, name: 'home'}]);
  assert.equal(tools[1].observation.frames[0].elements, undefined);
  assert.equal(tools[1].applied, 1); assert.deepEqual(tools[1].fields, [{ref: 'c-home-1', value_set: true}]);
  assert.equal(tools[2].observation.frames[0].elements.length, 60);
  assert.equal(tools[3].frames[0].elements.length, 60);
  assert(JSON.stringify(next).length < JSON.stringify(wire).length * .6);
  assert.equal(next.length, wire.length);
  assert.deepEqual(next.map(message => message.tool_call_id), wire.map(message => message.tool_call_id));
  assert.equal(JSON.stringify(wire).includes('elementsCleared'), false);
});

test('uncertain, approval-bound, cancelled and small results stay whole', () => {
  const protectedResults = [{uncertain: true}, {requiresApproval: true}, {requiresUserInput: true}, {cancelled: true}, {unresolvedAction: true}]
    .flatMap(flag => pair('click_element', {...flag, observation: observation('kept')}));
  const wire = [...protectedResults, ...pair('inspect_dom', observation('small', 2)), ...pair('inspect_dom', observation('a')), ...pair('inspect_dom', observation('b'))];
  assert.equal(clearSupersededElements(wire), wire);
});

test('two or fewer DOM results and non-DOM results are unchanged', () => {
  const wire = [...pair('read_page', {ok: true, dataKind: 'page_content', ranges: [{start: 0, end: 5000, markdown: 'x'.repeat(5000)}]}),
    ...pair('inspect_dom', observation('a')), ...pair('inspect_dom', observation('b'))];
  assert.equal(clearSupersededElements(wire), wire);
});

test('a fully passed verification keeps its checks and text but not its element list', async () => {
  const {clearVerifiedElements} = await import('../context-evidence.js');
  const verified = {ok: true, verified: true, checks: [{kind: 'text_present', passed: true}, {kind: 'link_destination', passed: true}], observation: observation('verified')};
  const wire = [...pair('verify_page', verified), ...pair('verify_page', {...verified, ok: false, verified: false, error: 'verification_failed', checks: [{kind: 'url_is', passed: false, reason: 'url_query_mismatch'}]}),
    ...pair('browser_snapshot', observation('snapshot')), ...pair('verify_page', {...verified, uncertain: true})];
  const tools = clearVerifiedElements(wire).filter(message => message.role === 'tool').map(parsed);
  assert.deepEqual(tools[0].checks, verified.checks); assert.equal(tools[0].verified, true);
  assert.equal(tools[0].observation.frames[0].elements, undefined);
  assert.deepEqual(tools[0].observation.frames[0].elementsCleared, {count: 60, reason: 'verification_passed'});
  assert.equal(tools[0].observation.frames[0].text, '본문 verified');
  assert.equal(tools[1].observation.frames[0].elements.length, 60);
  assert.equal(tools[2].frames[0].elements.length, 60);
  assert.equal(tools[3].observation.frames[0].elements.length, 60);
  const unchanged = pair('verify_page', {ok: true, verified: true, checks: [{passed: true}], observation: observation('small', 0)});
  assert.equal(clearVerifiedElements(unchanged), unchanged);
  const last = pair('verify_page', verified);
  assert.equal(clearVerifiedElements(last), last, 'the latest observation keeps the refs the next action needs');
});
