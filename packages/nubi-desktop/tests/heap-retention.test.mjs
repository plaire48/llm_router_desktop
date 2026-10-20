import test from 'node:test';
import assert from 'node:assert/strict';
const collected=values=>values.map(usedSize=>({usedSize,forcedGc:true}));
const heap=await import('../scripts/heap-retention.mjs').catch(()=>({}));
test('retained heap is read after explicit CDP GC and invalid samples fail closed',async()=>{
 assert.equal(typeof heap.collectRetainedHeap,'function');const calls=[];
 const row=await heap.collectRetainedHeap({send:async(method)=>{calls.push(method);return {usedSize:100,totalSize:200};}});
 assert.deepEqual(calls,['HeapProfiler.collectGarbage','Runtime.getHeapUsage']);assert.equal(row.usedSize,100);assert.equal(row.forcedGc,true);
 await assert.rejects(()=>heap.collectRetainedHeap({send:async()=>({usedSize:NaN})}),/heap_sample_invalid/);
});
test('retention compares the same loaded boundary after a warm run and two independent cycles',async()=>{
 assert.equal(typeof heap.measureHeapRetention,'function');const events=[];let index=0;
 const result=await heap.measureHeapRetention({sample:async()=>{events.push('gc');return {usedSize:[100,105,108][index++],forcedGc:true};},cycle:async i=>events.push('cycle'+i)});
 assert.deepEqual(events,['gc','cycle1','gc','cycle2','gc']);assert.equal(result.samples.length,3);assert.equal(result.maxGrowthRatio,0.05);assert.equal(result.totalGrowthRatio,0.08);
});
test('ten percent is inclusive but growth above it remains a failure, not timing unjudged',()=>{
 assert.equal(typeof heap.heapRetentionViolations,'function');assert.deepEqual(heap.heapRetentionViolations({samples:collected([100,110,121])}),[]);
 assert.deepEqual(heap.heapRetentionViolations({samples:collected([100,111,111])}),['heap_growth']);
});
test('missing, invalid or uncollected heap samples cannot report success',()=>{
 assert.equal(typeof heap.heapRetentionViolations,'function');
 for(const samples of [[],collected([1]),collected([100,0,100]),collected([100,NaN,100]),[{usedSize:100},{usedSize:100},{usedSize:100}]])assert.deepEqual(heap.heapRetentionViolations({samples}),['heap_samples_invalid']);
});

test('GC failure does not produce a fabricated sample or continue with a heap read',async()=>{
 const calls=[];await assert.rejects(()=>heap.collectRetainedHeap({send:async method=>{calls.push(method);throw Error('gc_failed');}}),/gc_failed/);assert.deepEqual(calls,['HeapProfiler.collectGarbage']);
});

test('retained heap failures stay functional failures under load and shared-runner timing rules',async()=>{
 const {classifyFreezeResults}=await import('../scripts/freeze-environment.mjs');
 const {judgedTimingRow}=await import('../scripts/admission-calibration.mjs');
 const row={timingVerdict:'unjudged',violations:['input_delay','heap_growth'],environmentReasons:[{code:'loadavg_exceeded'}]};
 const judged=judgedTimingRow(row,new Set(['input_delay']));assert.deepEqual(judged.violations,['heap_growth']);assert.equal(classifyFreezeResults({results:[judged],baseline:true}),1);
});
