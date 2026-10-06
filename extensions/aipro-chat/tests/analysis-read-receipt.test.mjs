import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisCoordinator} from '../analysis-agents.js';
import {analysisReadReceipt} from '../analysis-read-receipt.js';
import {goalReviewMessages, reviewEvidence} from '../goal-review.js';
import {contextTokens} from '../context-manager.js';

const hash = 'a'.repeat(64);
const page = markdown => ({ok: true, dataKind: 'page_content', url: 'https://example.com/rules', frame: 0,
  content_hash: hash, characters: 100000, coverage: {partial: true}, ranges: [{start: 31000, end: 31000 + markdown.length, markdown}]});

async function receipt(t, source, input = {}) {
  const receipts = [];
  const coordinator = createAnalysisCoordinator({signal: new AbortController().signal, modelId: 'fixture',
    tools: [{type: 'function', function: {name: 'read_source', parameters: {type: 'object', properties: {}}}}],
    onDelivery: value => receipts.push(value), execute: async () => assert.fail('No live access'),
    run: async ({execute, complete}) => {
      await execute('read_analysis_evidence', {evidence_id: 'ev_1', ...input});
      return complete([], []);
    }, complete: async () => ({content: JSON.stringify({status: 'partial', summary: 'Partial source', findings: [], uncertainties: ['Unread text'], next_step: 'Read the missing range'})})});
  t.after(() => coordinator.dispose());
  coordinator.observe('read_page', {}, source);
  const delegated = await coordinator.execute('delegate_analysis', {tasks: [{role: 'research', task: 'Inspect assigned text', done_when: 'Report observed scope', evidence_ids: ['ev_1']}]});
  assert(!delegated.error, JSON.stringify(delegated));
  await coordinator.collect();
  await coordinator.collect({task_ids: [delegated.tasks[0].task_id]});
  assert.equal(receipts.length, 1);
  return receipts[0];
}

test('delivery preserves host source identity and actual source offsets, not model assertions', async t => {
  const markdown = 'Basic rule\nException: March is open. "Quoted" \\ path 😀';
  const delivered = await receipt(t, page(markdown));
  assert.equal(delivered.source_reads.sources[0].page_content.content_hash, hash);
  assert.deepEqual(delivered.source_reads.sources[0].page_content.returned_ranges, [{start: 31000, end: 31000 + markdown.length}]);
  assert.equal(delivered.source_reads.sources[0].page_content.characters, 100000);
  assert.equal(delivered.source_reads.sources[0].observation_coverage, 'complete');
  assert.equal(delivered.report_status, 'partial');
  assert(!JSON.stringify(delivered).includes('March is open'), 'The receipt carries scope, never source text or findings');
});

test('partial serialized reads map escaped text to original offsets without crediting unseen prefix or suffix', async t => {
  const markdown = ('head\n"quoted"\\😀 ').repeat(700);
  const source = page(markdown);
  const wire = JSON.stringify({input: {}, result: source});
  const start = wire.indexOf('head') + 11;
  const delivered = await receipt(t, source, {offset: start});
  const read = delivered.source_reads.sources[0];
  assert.equal(read.observation_coverage, 'partial');
  const ranges = read.page_content.returned_ranges;
  assert(ranges[0].start > 31000);
  assert(ranges.at(-1).end < source.ranges[0].end);
  // Every credited UTF-16 unit must be inside the actual 6000-character wire read.
  const prefix = wire.indexOf('head');
  let encoded = prefix, original = 31000;
  for (const char of markdown) {
    const width = JSON.stringify(char).length - 2;
    const credited = ranges.some(range => range.start <= original && range.end >= original + char.length);
    assert.equal(credited, encoded >= start && encoded + width <= start + 6000);
    encoded += width; original += char.length;
  }
});

test('failed, malformed and truncated snapshots cannot certify page source ranges', async t => {
  for (const source of [{...page('fact'), ok: false, error: 'read_failed'},
    {...page('fact'), ranges: [{start: 31000, end: 31001, markdown: 'wrong length'}]},
    page('x'.repeat(210000))]) {
    const delivered = await receipt(t, source);
    assert.equal(delivered.source_reads.sources[0].page_content, undefined);
  }
});

test('reading only metadata or no matching range never becomes original-page coverage', async t => {
  const source = page('z'.repeat(18000));
  const delivered = await receipt(t, source, {offset: JSON.stringify({input: {}, result: source}).length - 5});
  assert.deepEqual(delivered.source_reads.sources[0].page_content.returned_ranges, []);
  const empty = await receipt(t, source, {query: 'no_such_term'});
  assert.deepEqual(empty.source_reads.sources, []);
});

test('duplicate strings in input cannot credit an unread page and receipt bounds declare omissions', () => {
  const source = page('DUPLICATE');
  const wire = JSON.stringify({input: {query: 'DUPLICATE'}, result: source});
  const sources = new Map(Array.from({length: 10}, (_, index) => [`ev_${index}`, {tool: 'read_page', kind: 'page', status: 'observed', text: wire, truncated: false}]));
  const first = wire.indexOf('DUPLICATE');
  const reads = new Map([...sources.keys()].map(id => [id, [{start: first, end: first + 9}]]));
  const output = analysisReadReceipt(sources, reads);
  assert(output.sources.length <= 8);
  assert.equal(output.sources.length + output.omitted_sources, 10);
  assert(output.sources.every(item => !item.page_content.returned_ranges.length));
  assert(JSON.stringify(output).length < 6500);
  output.sources[0].returned_wire_ranges[0].end = 999999;
  assert.equal(analysisReadReceipt(sources, reads).sources[0].returned_wire_ranges[0].end, first + 9);
});

test('both step and final review preserve child source scope without turning counts into facts', async t => {
  const delivered = await receipt(t, page('Partial source only'));
  const evidence = [reviewEvidence(1, 'analysis_receipt', {}, delivered)];
  for (const phase of ['plan_step', 'final']) {
    const review = goalReviewMessages({goal: 'Read the end exception', answer: 'Not yet complete', history: [], evidence, phase,
      inputBudget: 16000, stepOutcomes: [{id: 's1', expected_outcome: 'Read the end exception'}]});
    assert.match(review.messages[0].content, /returned_wire_ranges/);
    assert.equal(review.evidence[0].result.source_reads.sources[0].page_content.content_hash, hash);
    assert.equal(review.evidence[0].result.report_status, 'partial');
  }
});

test('review compaction retains delivered child receipts amid later page observations', async t => {
  const delivered = await receipt(t, page('Observed exception only'));
  const evidence = [reviewEvidence(1, 'analysis_receipt', {}, delivered),
    reviewEvidence(2, 'analysis_receipt', {}, {...delivered, task_id: 'other-child', report_status: 'complete'}),
    ...Array.from({length: 30}, (_, index) => reviewEvidence(index + 3, 'verify_page', {},
      {ok: true, verified: true, text: 'intermediate page detail '.repeat(160)})),
    reviewEvidence(33, 'browser_snapshot', {}, {ok: true, frames: [{frame: 0, text: 'Current page'}]})];
  for (const phase of ['plan_step', 'final']) {
    const review = goalReviewMessages({goal: 'Compare sources using child analysis', answer: 'Qualified comparison',
      history: [], evidence, phase, inputBudget: 60000,
      stepOutcomes: [{text: 'Compare sources', expected_outcome: 'Include observed exceptions'}]});
    const payload = JSON.parse(review.messages[1].content);
    assert.equal(payload.omitted, true, 'Exercise actual context pruning');
    const receipts = review.evidence.filter(item => item.tool === 'analysis_receipt');
    assert.deepEqual(receipts.map(item => item.id), [1, 2]);
    assert.equal(receipts[0].result.report_status, 'partial');
    assert.equal(receipts[1].result.task_id, 'other-child');
    assert.deepEqual(receipts[0].result.source_reads, delivered.source_reads);
    assert(payload.citeable_evidence_ids.includes(1));
    assert(!JSON.stringify(receipts).includes('Observed exception only'), 'Scope cannot replace original facts');
  }
});

test('a hard model budget cannot be met by silently dropping a child execution receipt', async t => {
  const delivered = await receipt(t, page('Partial source'));
  const request = {goal: 'Verify the child read the assigned range', answer: 'Still partial', history: [],
    evidence: [reviewEvidence(1, 'analysis_receipt', {}, delivered),
      reviewEvidence(2, 'browser_snapshot', {}, {ok: true, frames: [{frame: 0, text: 'Current page'}]})]};
  const full = goalReviewMessages({...request, inputBudget: 60000});
  assert.throws(() => goalReviewMessages({...request, inputBudget: contextTokens(full.messages) - 1}),
    error => error.message === 'goal_review_failed' && error.reviewReason === 'context_budget');
});

test('failed, superseded and truncated child records are not reserved as usable proof', () => {
  const valid = {ok: true, dataKind: 'analysis_execution', task_id: 'child', status: 'done', delivered: true};
  const evidence = [reviewEvidence(1, 'analysis_receipt', {}, {...valid, ok: false, error: 'analysis_failed'}),
    {...reviewEvidence(2, 'analysis_receipt', {}, valid), usable: false, superseded: true},
    reviewEvidence(3, 'analysis_receipt', {}, {...valid, text: 'x'.repeat(20000)}),
    reviewEvidence(4, 'browser_snapshot', {}, {ok: true, frames: [{frame: 0, text: 'Current page'}]})];
  const request = {goal: 'Review observed progress', answer: 'Partial', history: [], evidence};
  const minimal = goalReviewMessages({...request, evidence: evidence.slice(-1), inputBudget: 60000});
  const review = goalReviewMessages({...request, inputBudget: contextTokens(minimal.messages) + 100});
  assert.deepEqual(review.evidence.map(item => item.id), [4]);
  assert.deepEqual(JSON.parse(review.messages[1].content).citeable_evidence_ids, [4]);
});
