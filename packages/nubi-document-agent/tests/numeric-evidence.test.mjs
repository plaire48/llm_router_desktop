import test from 'node:test';import assert from 'node:assert/strict';import{containsNumber}from'../eval/numeric-evidence.mjs';
test('numeric evidence accepts display precision without accepting a different amount or sign',()=>{
 assert.equal(containsNumber('수입 475.20만원',475.2),true);assert.equal(containsNumber('수입 1,475.20만원',475.2),false);assert.equal(containsNumber('격차 −60분',-60),true);assert.equal(containsNumber('격차 −60분',60),false);
});
