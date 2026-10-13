import test from 'node:test';
import assert from 'node:assert/strict';
import {responseTimer,durationLabel} from '../runtime/response-timing.mjs';

test('live elapsed labels always include seconds without a zero-minute prefix',()=>{
 for(const [ms,label] of [[0,'0초'],[999,'0초'],[12000,'12초'],[59000,'59초'],[60000,'1분 0초'],[83000,'1분 23초'],[3600000,'1시간 0초'],[3660000,'1시간 1분 0초']])assert.equal(durationLabel(ms,{keepSeconds:true}),label);
 assert.equal(durationLabel(60000),'1분');assert.equal(durationLabel(-1,{keepSeconds:true}),null);assert.equal(durationLabel(undefined,{keepSeconds:true}),null);
});
test('finished execution clocks retain the same duration after completion or interruption',async()=>{
 const timer=responseTimer();await new Promise(resolve=>setTimeout(resolve,12));assert(timer.snapshot().elapsedMs>=0);
 const completed=timer.finish('interrupted');assert.equal(completed.state,'interrupted');assert(Number.isFinite(completed.durationMs));
 await new Promise(resolve=>setTimeout(resolve,12));assert.deepEqual(timer.snapshot(),completed);assert.deepEqual(timer.finish('completed'),completed);
});
