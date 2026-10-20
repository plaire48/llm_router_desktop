import test from 'node:test';import assert from 'node:assert/strict';
import {runDurabilityScenario} from './helpers/wiki-durability-fixture.mjs';
test('zero-fault generation fixture verifies eleven sources through the real provider and native runner with explicit limits',async()=>{
 const result=await runDurabilityScenario({injection:'none',concurrency:1,maxToolCalls:16,modelDelayMs:0});
 assert.equal(result.state,'completed');assert.equal(result.verified,true);assert.equal(result.injected,0);assert.equal(result.concurrency,1);assert.equal(result.maxToolCalls,16);assert.equal(result.sources,11);assert.equal(result.plannedPages,3);assert.equal(result.verifiedPages,3);assert(result.generationMs>0);assert(result.pageOutputTokens.length>0);assert(result.pageOutputTokens.every(n=>n===16384));
});
