// Heap evidence is independent of the timing verdict. Read only primitive sizes;
// no heap objects, document contents or allocation snapshots leave the renderer.
export async function collectRetainedHeap(client){
 await client.send('HeapProfiler.collectGarbage');
 const {usedSize,totalSize,embedderHeapUsedSize,backingStorageSize}=await client.send('Runtime.getHeapUsage');
 if(!Number.isFinite(usedSize)||usedSize<=0||!Number.isFinite(totalSize)||totalSize<usedSize)throw Error('heap_sample_invalid');
 return {usedSize,totalSize,embedderHeapUsedSize:embedderHeapUsedSize??null,backingStorageSize:backingStorageSize??null,forcedGc:true};
}
export function heapRetentionMetrics(samples){
 const valid=samples?.length===3&&samples.every(s=>s.forcedGc===true&&Number.isFinite(s.usedSize)&&s.usedSize>0);
 if(!valid)return {valid:false,samples:samples||[]};
 const cycles=samples.slice(1).map((row,i)=>({cycle:i+1,deltaBytes:row.usedSize-samples[i].usedSize,growthRatio:(row.usedSize-samples[i].usedSize)/samples[i].usedSize}));
 return {valid:true,samples,cycles,maxGrowthRatio:Math.max(0,...cycles.map(c=>c.growthRatio)),totalGrowthRatio:(samples[2].usedSize-samples[0].usedSize)/samples[0].usedSize};
}
export function heapRetentionViolations(result,{maxGrowthRatio=0.10}={}){
 if(!Number.isFinite(maxGrowthRatio)||maxGrowthRatio<0)throw Error('heap_limit_invalid');
 const metrics=heapRetentionMetrics(result.samples);if(!metrics.valid)return ['heap_samples_invalid'];
 return metrics.maxGrowthRatio-maxGrowthRatio>Number.EPSILON?['heap_growth']:[];
}
export async function measureHeapRetention({sample,cycle}){
 const samples=[await sample()];
 for(let i=1;i<=2;i++){await cycle(i);samples.push(await sample());}
 return {...heapRetentionMetrics(samples),boundary:'Warm loaded scene, then two unmount/remount cycles with the same workload; explicit renderer GC before every sample.'};
}
