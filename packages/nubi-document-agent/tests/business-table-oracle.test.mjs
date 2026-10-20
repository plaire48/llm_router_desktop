import test from 'node:test';import assert from 'node:assert/strict';import{inspectBusinessTables}from'../eval/business-table-oracle.mjs';import{cases}from'../eval/open-composition-cases.mjs';
test('correct grand totals cannot hide an incorrect supplier or monthly subtotal',()=>{
 const c=cases[0],bad=[{headers:['공급사','미납(개)'],rows:[['동해','25'],['서진','35'],['한빛','35'],['합계','100']]}];const first=inspectBusinessTables(c,bad);assert.equal(first.passed,false);assert.equal(first.checks[0].expected,30);
 const good=structuredClone(bad);good[0].rows[0][1]='30';assert.equal(inspectBusinessTables(c,good).passed,true);
 const monthly=[{headers:['공급사','월','미납(개)'],rows:[['동해','2월','10']]}];const result=inspectBusinessTables(c,monthly);assert.equal(result.passed,false);assert.equal(result.checks[0].expected,15);
});
