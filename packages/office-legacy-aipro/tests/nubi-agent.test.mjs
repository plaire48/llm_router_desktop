import test from 'node:test';
import assert from 'node:assert/strict';
import { createNubiRun } from '../server/nubi-agent.mjs';
import { mockAiPro } from './mock-aipro.mjs';
import { fakeExcel } from './fake-excel.mjs';
import { readSelection, readSnapshot, makeInput, applyPlan } from '../src/excel.js';
const config = { mode: 'cli', endpoint: 'https://example.com/v1/chat/completions', token: 'synthetic', model: 'model' };
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
test('reuses the real Nubi Pi loop for read -> Excel edit/readback -> answer', async () => {
  const { excel, state } = fakeExcel(); let snapshot = await readSelection(excel);
  const input = makeInput(snapshot, '첫 행 서식 정리', 'edit'), run = createNubiRun({ input, config, fetchImpl: mockAiPro });
  try {
    for (let tries = 0; tries < 100 && run.status().state === 'running'; tries++) {
      const { action } = run.status();
      if (action) {
        let result = {};
        if (action.name === 'apply_changes') result = await applyPlan(snapshot, action.plan, makeInput(snapshot, input.request, input.mode), excel);
        snapshot = await readSnapshot(snapshot, excel); run.respond(action.callId, { ...result, snapshot });
      } else await pause();
    }
    await run.finish; assert.equal(run.status().state, 'done'); assert.equal(run.status().engine, 'pi-agent-core@0.86.1'); assert.equal(run.status().writes, 1); assert.equal(state.styles[0][0].bold, true);
    assert.deepEqual(run.status().trace.map(step => [step.tool, step.status]), [['read_selection', 'done'], ['apply_changes', 'done']]);
  } finally { run.cancel(); }
});
test('Excel failure ends the Nubi run without further provider calls or write replay', async () => {
  const { excel } = fakeExcel(), snapshot = await readSelection(excel); let calls = 0;
  const run = createNubiRun({ input: makeInput(snapshot, '수정', 'edit'), config, fetchImpl: (...args) => { calls++; return mockAiPro(...args); } });
  try {
    for (let tries = 0; tries < 100 && run.status().state === 'running'; tries++) {
      const { action } = run.status();
      if (action) run.respond(action.callId, action.name === 'apply_changes' ? { error: '일부 변경이 이미 반영되었을 수 있습니다.' } : { snapshot }); else await pause();
    }
    await run.finish; assert.equal(run.status().state, 'failed'); assert.match(run.status().error, /일부 변경/); assert.equal(calls, 2);
  } finally { run.cancel(); }
});
test('cancellation invalidates pending Excel tools', async () => {
  const { excel } = fakeExcel(), snapshot = await readSelection(excel), run = createNubiRun({ input: makeInput(snapshot, '요약', 'analyze'), config, fetchImpl: mockAiPro });
  while (!run.status().action) await pause();
  const action = run.status().action; run.cancel();
  assert.throws(() => run.respond(action.callId, { snapshot }), /Stale/); await run.finish; assert.equal(run.status().state, 'cancelled');
});
