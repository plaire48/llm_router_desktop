import test from 'node:test';
import assert from 'node:assert/strict';
import {createComparisonAnalysis} from '../comparison-analysis.js';
import {createAnalysisCoordinator} from '../analysis-agents.js';
import {runAgent} from '../agent-runtime.js';

function setup(execute, hasEvidence, goal = '출처 비교') {
  const jobs = [], batches = [], steps = [], launched = [];
  let enabled = true;
  const scheduler = createComparisonAnalysis({goal, allowed: () => enabled,
    onStep: step => steps.push(step), onLaunch: id => launched.push(id),
    analyses: {status: () => jobs, hasEvidence, execute: async (_, {tasks}) => {
      batches.push(tasks);
      if (execute) return execute(tasks);
      const added = tasks.map((task, i) => ({task_id: `task-${jobs.length + i}`, status: 'complete', delivered: false, task}));
      jobs.push(...added); return {ok: true, tasks: added};
    }}});
  const observe = (i, evidence = `ev_${i}`, options) => scheduler.observe(`source-${i}`, `https://source${i}.example/article`, evidence, options);
  return {...scheduler, observeSource: observe, jobs, batches, steps, launched, disable: () => {enabled = false;}};
}

const reference = (start, end, hash = 'a'.repeat(64), frame = 0) => ({ok: true, dataKind: 'page_content',
  url: 'https://source1.example/article', source_key: 'b'.repeat(64), content_hash: hash,
  frame, characters: 20000, ranges: [{start, end, markdown: 'x'.repeat(end - start)}], coverage: {partial: true}});

test('oversized automatic requests stay with the leader without dispatching a truncated task', async () => {
  const s = setup(undefined, undefined, '비교'.padEnd(2001, 'x'));
  s.observeSource(1, 'ev_first', {eager: true, reference: reference(0, 5000)});
  await s.flush(); await s.flush();
  assert.equal(s.batches.length, 0);
  assert.equal(s.status()[0].status, 'needs_leader_review');
  assert.equal(s.status()[0].reason, 'analysis_request_budget');
  assert.equal(s.status()[0].pending_snapshots, 1);
});

test('new end ranges trigger a bounded follow-up with both original and exception evidence', async () => {
  const s = setup();
  s.observeSource(1, 'ev_first', {eager: true, reference: reference(0, 5000)}); await s.flush();
  s.observeSource(1, 'ev_end', {eager: true, reference: reference(15000, 20000)}); await s.flush();
  assert.equal(s.launched.length, 1, 'Do not duplicate an uncollected assignment');
  s.jobs[0].delivered = true; await s.flush();
  assert.equal(s.launched.length, 2);
  assert.deepEqual(s.batches[1][0].evidence_ids, ['ev_first', 'ev_end']);
  s.jobs[1].delivered = true;
  s.observeSource(1, 'ev_duplicate', {eager: true, reference: reference(15000, 20000)}); await s.flush();
  assert.equal(s.launched.length, 2, 'A new handle for the same range is not progress');
});

test('document versions and frames never mix and snapshot mutation cannot rewrite source state', async () => {
  const s = setup(), first = reference(0, 5000);
  s.observeSource(1, 'ev_old', {eager: true, reference: first}); await s.flush();
  first.ranges[0].end = 20000;
  s.jobs[0].delivered = true;
  s.observeSource(1, 'ev_new', {eager: true, reference: reference(0, 5000, 'c'.repeat(64))}); await s.flush();
  s.observeSource(1, 'ev_frame', {eager: true, reference: reference(0, 5000, 'c'.repeat(64), 1)}); await s.flush();
  assert.deepEqual(s.batches.flat().map(task => task.evidence_ids), [['ev_old'], ['ev_new'], ['ev_frame']]);
  assert(s.status().every(row => row.captured_characters === 5000));
});

test('automatic continuation stops at its bound and retains visible pending coverage', async () => {
  const s = setup();
  for (let index = 0; index < 5; index++) {
    s.jobs.forEach(job => {job.delivered = true;});
    s.observeSource(1, `ev_${index}`, {eager: true, reference: reference(index * 1000, (index + 1) * 1000)});
    await s.flush();
  }
  assert.equal(s.launched.length, 3);
  assert.equal(s.status()[0].status, 'needs_leader_review');
  assert.equal(s.status()[0].pending_snapshots, 2);
});

test('a range arriving during dispatch stays pending instead of being falsely counted as assigned', async () => {
  let release;
  const barrier = new Promise(resolve => {release = resolve;});
  const s = setup(async () => {await barrier; return {ok: true, tasks: [{task_id: 'running'}]};});
  s.observeSource(1, 'ev_first', {eager: true, reference: reference(0, 5000)});
  const flushing = s.flush();
  s.observeSource(1, 'ev_tail', {eager: true, reference: reference(15000, 20000)});
  release(); await flushing;
  assert.equal(s.status()[0].pending_snapshots, 1);
});

test('an authorized comparison starts its first analyst before the next source exists',async()=>{
  const s=setup();s.observeSource(1,'ev_1',{eager:true});await s.flush();
  assert.equal(s.launched.length,1);assert.deepEqual(s.batches[0][0].evidence_ids,['ev_1']);
  await s.flush();assert.equal(s.launched.length,1);
  s.observeSource(2);await s.flush();assert.equal(s.launched.length,2);
  const disabled=setup();disabled.disable();disabled.observeSource(1);await disabled.flush();assert.equal(disabled.launched.length,0);
});

test('new sources wait for undelivered reports, then fill freed slots without repeating delivered jobs', async () => {
  const s = setup();
  for (let i = 1; i <= 9; i++) {s.observeSource(i); await s.flush();}
  assert.equal(s.launched.length, 6);
  for (const job of s.jobs) job.delivered = true;
  await s.flush(); await s.flush();
  assert.equal(s.launched.length, 9);
  assert.deepEqual(s.batches.flat().map(task => task.evidence_ids[0]), Array.from({length: 9}, (_, i) => `ev_${i + 1}`));
  for (const job of s.jobs) job.delivered = true;
  s.observeSource(1, 'ev_reread'); await s.flush(); assert.equal(s.launched.length, 9);
});

test('capacity rejection retains the latest pending snapshot; noncapacity failures are attempted once', async () => {
  let busy = true;
  const s = setup(tasks => busy ? {ok: false, error: 'analysis_busy'} : {ok: true, tasks: tasks.map((_, i) => ({task_id: String(i)}))});
  s.observeSource(1); s.observeSource(2); await s.flush();
  s.observeSource(1, 'ev_fresh'); busy = false; await s.flush(); await s.flush();
  assert.equal(s.batches.length, 2); assert.equal(s.batches[1][0].evidence_ids[0], 'ev_fresh');
  for (const execute of [() => ({ok: false, error: 'analysis_scope'}), () => {throw Error('transport');}]) {
    const failed = setup(execute); failed.observeSource(1); failed.observeSource(2);
    await failed.flush().catch(() => {}); await failed.flush();
    assert.equal(failed.batches.length, 1);
  }
});

test('display snapshots do not duplicate query sources, while separate captured queries stay distinct', async () => {
  const s = setup(), url = 'https://search.example/results';
  s.observe(url, url, 'ev_display'); s.observeSource(2); await s.flush();
  s.observe('query-hash-a', url, 'ev_a'); s.observe(url, url, 'ev_display_again');
  await s.flush(); assert.equal(s.launched.length, 2);
  s.observe('query-hash-b', url, 'ev_b'); await s.flush();
  assert.equal(s.launched.length, 3); assert.equal(s.batches.at(-1)[0].evidence_ids[0], 'ev_b');
});

test('automatic source budget and disabling preserve pending work without dispatching it', async () => {
  const s = setup();
  for (let i = 1; i <= 20; i++) {s.observeSource(i); s.jobs.forEach(job => {job.delivered = true;}); await s.flush();}
  assert.equal(s.launched.length, 16);
  const cancelled = setup(); cancelled.observeSource(1); cancelled.observeSource(2); cancelled.disable();
  await cancelled.flush(); assert.equal(cancelled.batches.length, 0);
});

test('evicted source evidence cannot reject valid peers or occupy admission slots', async () => {
  const retained = new Set(['ev_live']);
  const s = setup(tasks => tasks.some(task => !task.evidence_ids.length || task.evidence_ids.some(id => !retained.has(id)))
    ? {error: 'analysis_scope'} : {ok: true, tasks: tasks.map(() => ({task_id: 'live'}))}, id => retained.has(id));
  s.observeSource(1, 'ev_old_1', {eager: true, reference: reference(0, 5000)});
  s.observeSource(2, 'ev_old_2', {eager: true, reference: reference(0, 5000)});
  s.observeSource(3, 'ev_live', {eager: true, reference: reference(0, 5000)});
  await s.flush(); await s.flush();
  assert.deepEqual(s.batches.map(tasks => tasks.map(task => task.evidence_ids)), [[['ev_live']]]);
  assert.deepEqual(s.launched, ['live']);
  assert(s.status().slice(0, 2).every(row => row.status === 'needs_leader_review' && row.unavailable_snapshots === 1));
});

test('a lost earlier rule is not silently removed from an exception reconciliation', async () => {
  const retained = new Set(['ev_rule', 'ev_exception']);
  const s = setup(undefined, id => retained.has(id));
  s.observeSource(1, 'ev_rule', {eager: true, reference: reference(0, 5000)});
  await s.flush(); s.jobs[0].delivered = true;
  retained.delete('ev_rule');
  s.observeSource(1, 'ev_exception', {eager: true, reference: reference(15000, 20000)});
  await s.flush(); await s.flush();
  assert.equal(s.batches.length, 1, 'Do not spend another model call on an incomplete reconciliation brief');
  const status = s.status()[0];
  assert.equal(status.pending_snapshots, 1);
  assert.equal(status.unavailable_snapshots, 1);
  assert.equal(status.status, 'needs_leader_review');
  assert.match(status.instruction, /re-observe/i);
});

test('lost display evidence stays visible and cannot poison a captured source batch', async () => {
  const s = setup(undefined, id => id === 'ev_live');
  s.observeSource(1, 'ev_display', {eager: true});
  s.observeSource(2, 'ev_live', {eager: true, reference: reference(0, 5000)});
  await s.flush();
  assert.deepEqual(s.batches[0].map(task => task.evidence_ids), [['ev_live']]);
  assert.equal(s.status().find(row => row.url.includes('source1.')).unavailable_snapshots, 1);
});

test('real coordinator eviction admits the surviving source with no browser tool or missing-source call', async t => {
  let calls = 0;
  const analyses = createAnalysisCoordinator({signal: new AbortController().signal, modelId: 'qwen3.8-27b', run: runAgent,
    tools: [], execute: async () => assert.fail('No browser tools in an analyst'),
    complete: async () => {calls++; return {content: JSON.stringify({status: 'partial', summary: 'Observed excerpt only',
      findings: [], uncertainties: ['Full source is not captured'], next_step: ''})};}});
  t.after(() => analyses.dispose());
  const launched = [];
  const scheduler = createComparisonAnalysis({analyses, allowed: () => true, goal: 'Compare rules and exceptions',
    onStep: () => assert.fail('A valid peer must not fail admission'), onLaunch: id => launched.push(id)});
  const old = reference(0, 5000);
  const missingId = analyses.observe('read_page', {}, old);
  scheduler.observe('old', old.url, missingId, {eager: true, reference: old});
  for (let i = 0; i < 60; i++) analyses.observe('read_page', {}, {text: `Unrelated observation ${i}`});
  assert.equal(analyses.hasEvidence(missingId), false);
  const fresh = reference(0, 5000, 'c'.repeat(64)), currentId = analyses.observe('read_page', {}, fresh);
  scheduler.observe('fresh', fresh.url, currentId, {eager: true, reference: fresh});
  await scheduler.flush();
  const delivered = await analyses.collect();
  assert.equal(launched.length, 1);
  assert.deepEqual(delivered.results[0].assignment.evidence_ids, [currentId]);
  assert.equal(delivered.results[0].report.status, 'partial');
  await scheduler.flush();
  assert.equal(calls, 1);
  assert.equal(scheduler.status()[0].status, 'needs_leader_review');
});
