import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisCoordinator} from '../analysis-agents.js';
import {runAgent} from '../agent-runtime.js';

const hash = 'a'.repeat(64);
const source = text => ({ok: true, dataKind: 'page_content', content_hash: hash, frame: 0,
  url: 'https://example.com/rules', characters: text.length, ranges: [{start: 0, end: text.length, markdown: text}], coverage: {partial: false}});
const report = (quote, id = 'ev_1') => ({content: JSON.stringify({status: 'complete', summary: 'Observed exception',
  findings: [{text: 'March is open', evidence_ids: [id], ...(quote !== undefined ? {quotes: [{evidence_id: id, quote, start: 999999, content_hash: 'forged'}]} : {})}], uncertainties: [], next_step: ''})});

async function run(t, text, output, read = {offset: 0}) {
  let modelCalls = 0;
  const c = createAnalysisCoordinator({signal: new AbortController().signal, modelId: 'fixture', tools: [],
    run: runAgent, execute: async () => assert.fail('No live tool'), complete: async messages => {
      modelCalls++;
      if (modelCalls === 1) return {calls: [{id: 'read', function: {name: 'read_analysis_evidence', arguments: JSON.stringify({evidence_id: 'ev_1', ...read})}}]};
      return output;
    }});
  t.after(() => c.dispose());
  c.observe('read_page', {}, source(text));
  const delegated = await c.execute('delegate_analysis', {tasks: [{role: 'page', task: 'Inspect assigned information', done_when: 'Return supported findings', require_quotes: true, evidence_ids: ['ev_1']}]});
  assert.equal(delegated.ok, true);
  const result = (await c.collect()).results[0];
  return {result, modelCalls};
}

test('exact source quotes get host-derived offsets and hashes, ignoring model-authored bindings', async t => {
  const text = 'Rule\nException: "March" is open. 😀';
  const quote = '"March" is open.';
  const {result} = await run(t, text, report(quote));
  assert.equal(result.report.status, 'complete');
  assert.deepEqual(result.report.findings[0].quotes[0], {evidence_id: 'ev_1', quote, frame: 0, content_hash: hash,
    start: text.indexOf(quote), end: text.indexOf(quote) + quote.length});
  assert.equal(result.advisory, true, 'Exact quotation is not independent semantic validation');
});

test('fabricated or missing quotes cannot survive the bounded repair as complete findings', async t => {
  for (const quote of ['Every month is closed', undefined]) {
    const {result, modelCalls} = await run(t, 'March is open', report(quote));
    assert.equal(result.report.status, 'partial');
    assert.deepEqual(result.report.findings, []);
    assert(modelCalls <= 4);
  }
});

test('a real quote from an unread source tail is rejected', async t => {
  const text = 'x'.repeat(9000) + 'March is open';
  const {result} = await run(t, text, report('March is open'));
  assert.equal(result.report.status, 'partial');
  assert.deepEqual(result.report.findings, []);
});

test('an exact quote becomes eligible only after the child actually reads its range', async t => {
  const text = 'x'.repeat(9000) + 'March is open';
  const {result} = await run(t, text, report('March is open'), {offset: 9000});
  assert.equal(result.report.status, 'complete');
  assert.equal(result.report.findings[0].quotes[0].start, 9000);
});

test('quote text in a source cannot authorize another unassigned evidence ID', async t => {
  const {result} = await run(t, 'March is open', report('March is open', 'ev_99'));
  assert.equal(result.report.status, 'partial');
  assert.deepEqual(result.report.findings, []);
});
