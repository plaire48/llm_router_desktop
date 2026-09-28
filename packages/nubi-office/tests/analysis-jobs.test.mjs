import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisJobs} from '../worker/analysis-jobs.mjs';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const success={summary:'Observed source',missing:[]};
function fixture(complete,maxConcurrency=2){
  const controller=new AbortController(),calls=[],states=[];
  const jobs=createAnalysisJobs({providers:{status:()=>({provider:'aipro',model:'test'}),complete:async(messages,tools,signal)=>{
    const index=Number(messages[0].content);calls.push(index);return complete(index,signal);
  }},signal:controller.signal,maxConcurrency,activity:{start:()=>({}),end:()=>{}},metrics:{modelCalls:0}});
  const prepared=Array.from({length:4},(_,index)=>({key:String(index),goal:`Task ${index}`,brief:{goal:`Task ${index}`},
    messages:[{role:'user',content:String(index)}],parse:()=>success,
    onState:(state,result)=>states.push({index,state,result})}));
  return{jobs,prepared,calls,states,controller};
}
const unauthorized=()=>Object.assign(new Error('unauthorized'),{status:401});

for(const concurrency of [1,2])test(`permanent failure stops queued analysis requests at concurrency ${concurrency}`,async()=>{
  const started=deferred();let count=0;
  const run=fixture(async()=>{
    if(++count===concurrency)started.resolve();
    await started.promise;throw unauthorized();
  },concurrency);
  await assert.rejects(run.jobs.run(run.prepared),error=>error.message==='unauthorized'&&error.status===401);
  assert.equal(run.calls.length,concurrency);
  const blocked=run.states.filter(value=>value.result?.dispatched===false);
  assert.equal(blocked.length,4-concurrency);
  assert.ok(blocked.every(value=>value.state==='error'&&value.result.error==='unauthorized'&&value.result.recoverable===false));
  assert.equal(run.controller.signal.aborted,false);
});

test('permanent sibling failure retains already-running success for later cached reuse',async()=>{
  const bothStarted=deferred(),releaseSuccess=deferred(),blocked=deferred();let count=0;
  const run=fixture(async index=>{
    if(++count===2)bothStarted.resolve();
    await bothStarted.promise;
    if(index===0)throw unauthorized();
    await releaseSuccess.promise;return{content:'valid',usage:{input:1,output:1}};
  });
  const previous=run.prepared[2].onState;
  run.prepared[2].onState=(state,result)=>{previous(state,result);if(result?.dispatched===false)blocked.resolve();};
  const pending=run.jobs.run(run.prepared);
  const rejection=assert.rejects(pending,/unauthorized/);
  await blocked.promise;
  assert.deepEqual(run.calls,[0,1]);releaseSuccess.resolve();await rejection;
  assert.ok(run.states.some(value=>value.index===1&&value.state==='done'));
  assert.equal(run.jobs.progress(),1);
  const reused=await run.jobs.run([run.prepared[1]]);
  assert.equal(reused.status,'analyzed');assert.equal(reused.results[0].cached,true);
  assert.deepEqual(run.calls,[0,1]);assert.equal(run.controller.signal.aborted,false);
});

test('user cancellation during permanent-failure settlement stays cancelled and fences late responses',async()=>{
  const bothStarted=deferred(),late=deferred(),blocked=deferred();let count=0;
  const run=fixture(async index=>{
    if(++count===2)bothStarted.resolve();
    await bothStarted.promise;
    if(index===0)throw unauthorized();
    return late.promise;
  });
  run.prepared[2].onState=(state,result)=>{if(result?.dispatched===false)blocked.resolve();};
  const pending=run.jobs.run(run.prepared);
  const rejection=assert.rejects(pending,/cancelled/);
  await blocked.promise;run.controller.abort();await rejection;
  late.resolve({content:'late'});await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(run.calls,[0,1]);assert.equal(run.jobs.progress(),0);
  assert.ok(!run.states.some(value=>value.state==='done'));
});

test('repairable output failures do not suppress unrelated queued analysis jobs',async()=>{
  const run=fixture(async index=>{
    if(index===0)throw new Error('analysis_invalid');
    return{content:'valid'};
  },1);
  const result=await run.jobs.run(run.prepared);
  assert.equal(result.status,'incomplete');assert.deepEqual(run.calls,[0,1,2,3]);
  assert.equal(result.results[0].recoverable,true);
  assert.equal(result.results.filter(value=>value.status==='analyzed').length,3);
});
