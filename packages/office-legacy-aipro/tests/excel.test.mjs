import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeExcel } from './fake-excel.mjs';
import { readSelection, makeInput, applyPlan } from '../src/excel.js';

test('writes values, formulas and formatting into captured worksheet and reads back', async () => {
  const { excel, state } = fakeExcel(), snapshot = await readSelection(excel), input = makeInput(snapshot, '합계와 서식', 'edit');
  const result = await applyPlan(snapshot, { answer: '작업 제안', operations: [{ type: 'set_values', address: 'A2', values: [[null]] }, { type: 'set_formulas', address: 'B2', formulas: [['=SUM(A1:B1)']] }, { type: 'format_range', address: 'A1:B1', bold: true, fillColor: '#E8F1FE', numberFormat: '0.00' }] }, input, excel);
  assert.equal(result.applied, true); assert.equal(state.values[1][0], ''); assert.equal(state.formulas[1][1], '=SUM(A1:B1)'); assert.equal(state.styles[0][0].bold, true); assert.equal(state.syncs, 5);
});
test('rejects a stale snapshot before writing', async () => {
  const { excel, state } = fakeExcel(), snapshot = await readSelection(excel), input = makeInput(snapshot, '바꿔줘', 'edit'); state.values[0][0] = 999;
  await assert.rejects(applyPlan(snapshot, { answer: '변경', operations: [{ type: 'set_values', address: 'A1', values: [[1]] }] }, input, excel), /셀 내용이 바뀌었습니다/); assert.equal(state.writes, 0);
});
test('rejects out of scope and formula-like raw values without writing', async () => {
  const { excel, state } = fakeExcel(), snapshot = await readSelection(excel), input = makeInput(snapshot, '수정', 'edit');
  for (const op of [{ type: 'set_values', address: 'C1', values: [[1]] }, { type: 'set_values', address: 'A1', values: [['=1+1']] }]) await assert.rejects(applyPlan(snapshot, { answer: '수정', operations: [op] }, input, excel));
  assert.equal(state.writes, 0);
});
test('reports possible partial changes and Excel formula errors without retry', async () => {
  for (const failure of ['failure', 'formulaError']) {
    const { excel, state } = fakeExcel(), snapshot = await readSelection(excel), input = makeInput(snapshot, '수식', 'edit'); state[failure] = true;
    await assert.rejects(applyPlan(snapshot, { answer: '수식', operations: [{ type: 'set_formulas', address: 'A1', formulas: [['=SUM(B1)']] }] }, input, excel), /일부 변경이 이미 반영/); assert.equal(state.writes, 1);
  }
});
test('analysis mode and overlapping formats cannot silently write', async () => {
  const { excel, state } = fakeExcel(), snapshot = await readSelection(excel);
  const op = { type: 'format_range', address: 'A1', bold: true };
  await assert.rejects(applyPlan(snapshot, { answer: '분석', operations: [op] }, makeInput(snapshot, '분석', 'analyze'), excel));
  await assert.rejects(applyPlan(snapshot, { answer: '서식', operations: [op, op] }, makeInput(snapshot, '서식', 'edit'), excel), /중복/); assert.equal(state.writes, 0);
});
