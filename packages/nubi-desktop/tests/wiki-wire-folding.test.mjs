import {test} from 'node:test';
import assert from 'node:assert/strict';
import {foldWikiWire, FOLDABLE_WIKI_TOOLS} from '../generated/openwiki.mjs';

// Wiki scale/quality design C8 (2026-10-21): a repeated read-only call supersedes its older
// copy, old unique results fold only beyond the budget, receipts and the newest stay verbatim.
const call = (id, name, args = {path: id}) => ({id, type: 'function', function: {name, arguments: JSON.stringify(args)}});
const wire = () => {
  const messages = [{role: 'system', content: 'S'.repeat(3000)}, {role: 'user', content: 'Write the page.'}];
  for (let index = 0; index < 8; index++) {
    messages.push({role: 'assistant', content: '', tool_calls: [call('r' + index, 'read_file')]});
    messages.push({role: 'tool', tool_call_id: 'r' + index, content: ('line ' + index + '\n').repeat(1500)});
  }
  messages.push({role: 'assistant', content: '', tool_calls: [call('w1', 'write_file')]});
  messages.push({role: 'tool', tool_call_id: 'w1', content: JSON.stringify({receipt: 'w1', ok: true}).padEnd(2000, ' ')});
  messages.push({role: 'assistant', content: '', tool_calls: [call('g1', 'grep')]});
  messages.push({role: 'tool', tool_call_id: 'g1', content: 'match\n'.repeat(400)});
  messages.push({role: 'assistant', content: '', tool_calls: [call('s1', 'submit_page')]});
  messages.push({role: 'tool', tool_call_id: 's1', content: JSON.stringify({error: 'wiki_review_rejected', claims: ['x']}).padEnd(3000, ' ')});
  return messages;
};
const size = messages => messages.reduce((sum, message) => sum + (message.content || '').length + JSON.stringify(message.tool_calls || []).length, 0);

test('a wire under the budget is returned untouched', () => {
  const small = wire().slice(0, 4);
  assert.equal(foldWikiWire(small, {budget: 48000}), small);
});

test('folding replaces the oldest read-only results first, keeps receipts and the newest results, and stops at the budget', () => {
  const input = wire();
  const before = size(input);
  // 95,315 characters in; each read_file fold removes 10,365, so a 45,000 budget stops after the fifth fold.
  const output = foldWikiWire(input, {budget: 45000, keepLast: 3});
  assert.notEqual(output, input);
  assert.ok(size(output) <= 45000, 'folded wire fits the budget');
  assert.ok(size(output) < before);
  const byId = Object.fromEntries(output.filter(message => message.role === 'tool').map(message => [message.tool_call_id, message.content]));
  assert.match(byId.r0, /^\[folded earlier read_file result: 10,500 characters removed to save context\. Call read_file again with the same arguments only if you still need it\.\]$/);
  assert.equal(byId.w1, input.find(message => message.tool_call_id === 'w1').content, 'write_file receipt stays verbatim');
  assert.equal(byId.s1, input.find(message => message.tool_call_id === 's1').content, 'submit_page feedback stays verbatim');
  // The newest three foldable results (r6, r7, g1) are never folded.
  for (const id of ['r6', 'r7', 'g1']) assert.equal(byId[id], input.find(message => message.tool_call_id === id).content, id + ' stays verbatim');
  // Folding stops once the budget is met instead of folding every candidate.
  const foldedCount = output.filter(message => /^\[folded earlier/.test(message.content || '')).length;
  assert.equal(foldedCount, 5);
  assert.equal(byId.r5, input.find(message => message.tool_call_id === 'r5').content, 'r5 stays verbatim once the budget is met');
  assert.deepEqual(output.filter(message => message.role !== 'tool'), input.filter(message => message.role !== 'tool'), 'system, user and assistant messages are unchanged');
  assert.equal(input[3].content.length, 10500, 'input is not mutated');
});

test('folding is deterministic and idempotent so the prefix stays stable between calls', () => {
  const once = foldWikiWire(wire(), {budget: 30000});
  const twice = foldWikiWire(once, {budget: 30000});
  assert.deepEqual(twice, once);
  assert.deepEqual(foldWikiWire(wire(), {budget: 30000}), once);
});

test('only read-only tools are foldable', () => {
  assert.deepEqual([...FOLDABLE_WIKI_TOOLS].sort(), ['glob', 'grep', 'ls', 'read_file', 'read_review_source']);
  const input = wire().map(message => message.role === 'tool' && message.tool_call_id.startsWith('r') ? {...message, tool_call_id: message.tool_call_id} : message);
  const receiptsOnly = input.filter(message => !(message.role === 'tool' && /^r/.test(message.tool_call_id)) && !(message.role === 'assistant' && message.tool_calls?.[0]?.function.name === 'read_file'));
  const big = receiptsOnly.map(message => message.role === 'tool' ? {...message, content: message.content.padEnd(20000, '.')} : message);
  assert.equal(foldWikiWire(big, {budget: 1000}), big, 'nothing foldable leaves the wire as is');
});

test('a repeated read-only call folds its older copy even under the budget, but different arguments stay', () => {
  const input = [{role: 'system', content: 'S'}, {role: 'user', content: 'Write.'},
    {role: 'assistant', content: '', tool_calls: [call('a1', 'read_file', {path: 'lib/a.js'})]}, {role: 'tool', tool_call_id: 'a1', content: 'A'.repeat(3000)},
    {role: 'assistant', content: '', tool_calls: [call('b1', 'read_file', {path: 'lib/b.js'})]}, {role: 'tool', tool_call_id: 'b1', content: 'B'.repeat(3000)},
    {role: 'assistant', content: '', tool_calls: [call('a2', 'read_file', {path: 'lib/a.js'})]}, {role: 'tool', tool_call_id: 'a2', content: 'A'.repeat(3000)},
    {role: 'assistant', content: '', tool_calls: [call('a3', 'read_file', {path: 'lib/a.js', offset: 100})]}, {role: 'tool', tool_call_id: 'a3', content: 'A'.repeat(3000)}];
  const output = foldWikiWire(input, {budget: 120000, keepLast: 8});
  const byId = Object.fromEntries(output.filter(message => message.role === 'tool').map(message => [message.tool_call_id, message.content]));
  assert.equal(byId.a1, '[folded earlier read_file result: 3,000 characters. The same call was repeated later; use the newer result below.]');
  assert.equal(byId.b1, 'B'.repeat(3000), 'a different path is not a duplicate');
  assert.equal(byId.a2, 'A'.repeat(3000), 'the newest copy stays verbatim');
  assert.equal(byId.a3, 'A'.repeat(3000), 'different arguments are a different call');
  assert.deepEqual(foldWikiWire(output, {budget: 120000, keepLast: 8}), output, 'idempotent');
});
