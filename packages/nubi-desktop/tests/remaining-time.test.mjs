import test from 'node:test';
import assert from 'node:assert/strict';
import {createProgressEstimator,progressEstimateLabel} from '../ui/remaining-time.mjs';
test('observed throughput produces a remaining time without inventing completion',()=>{
 const sample=createProgressEstimator();
 assert.equal(sample({id:'read',completed:0,total:100,now:0}).state,'measuring');
 const result=sample({id:'read',completed:20,total:100,now:20000});
 assert.equal(result.remainingMs,80000);assert.equal(progressEstimateLabel(result),'현재 단계 약 1분 20초 남음');
 assert(sample({id:'read',completed:20,total:100,now:40000}).remainingMs>result.remainingMs,'a stalled operation must not count down to fake zero');
 assert.equal(sample({id:'read',completed:100,total:100,now:50000}).state,'finishing');
});
test('resume excludes already completed files and phase changes discard old rate',()=>{
 const sample=createProgressEstimator();sample({id:'resume',completed:80,total:100,now:0});
 assert.equal(sample({id:'resume',completed:85,total:100,now:10000}).remainingMs,30000);
 assert.equal(sample({id:'write',completed:1,total:11,now:12000}).state,'measuring');
 assert.equal(sample({id:'write',completed:2,total:11,now:22000}).remainingMs,90000);
 assert.equal(sample({id:'write',completed:1,total:11,now:23000}).state,'measuring');
 assert.equal(sample({id:'write',completed:2,total:15,now:25000}).state,'measuring');
});
test('unknown totals and invalid observations never produce an ETA number',()=>{
 const sample=createProgressEstimator();
 for(const total of [undefined,0,NaN,Infinity])assert.equal(sample({id:'scan',completed:10,total,now:1000}).state,'unknown');
 assert.equal(progressEstimateLabel({state:'unknown'}),'전체 작업량 확인 중');
 assert.equal(progressEstimateLabel({state:'finishing'}),'마무리 확인 중');
});
