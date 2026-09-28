import test from 'node:test';
import assert from 'node:assert/strict';
import {contentReviewBatches} from '../worker/content-context.mjs';
import {partitionedContentReview} from '../worker/content-review.mjs';
import {createAnalysisJobs} from '../worker/analysis-jobs.mjs';

function fixture(){
  const items=Array.from({length:200},(_,i)=>({id:`p${i}`,kind:'paragraph',text:`항목 ${i}: `+'보고 내용 '.repeat(180),editable:false}));
  const pages=new Map(Array.from({length:5},(_,i)=>[i*40,{host:'word',scopeId:'s',documentId:'d',fingerprint:'f',total:200,offset:i*40,nextOffset:i<4?(i+1)*40:null,items:items.slice(i*40,(i+1)*40)}]));
  return contentReviewBatches(pages,true);
}
function answer(payload){
  if(payload.batch){
    const item=payload.batch.items[0].value.items[0];
    return {checks:payload.requirements.map((_,requirement)=>({requirement,status:'support',finding:'원문 확인',sources:[{itemId:item.id,field:'text',quote:item.text.slice(0,80)}]}))};
  }
  return {status:'complete',checks:[{requirement:0,status:'met',evidence:payload.evidence.map(e=>e.id)}],feedback:''};
}
const activity={start:()=>({}),end:()=>{}};
function harness({complete,requirements=['본문 확인'],checkSource=async()=>{},runWrapper}={}){
  const controller=new AbortController(),metrics={modelCalls:0},stats={},snapshots=[],batches=fixture(),calls=[];
  const jobs=createAnalysisJobs({providers:{status:()=>({provider:'aipro',model:'qwen-test'}),complete},signal:controller.signal,activity,metrics,stats});
  return {controller,metrics,stats,snapshots,batches,calls,run:()=>partitionedContentReview({host:'word',batches,task:{requirements},whole:true,context:{request:'원래 요청을 유지합니다.'},metrics,activity,checkSource,
    structured:()=>{throw new Error('sequential fallback must not be used');},onWorkers:snapshot=>snapshots.push(snapshot),
    runJobs:async(prepared,options)=>{calls.push({prepared,options});return runWrapper?runWrapper(jobs,prepared,options):jobs.run(prepared);}})};
}

test('read-only partition and requirement workers run bounded parallel batches before sequential native acceptance',async()=>{
  let active=0,peak=0,nativeChecks=0;
  const h=harness({requirements:['본문','구조','사실','양식','조건'],complete:async(messages,tools)=>{
    assert.deepEqual(tools,[]);active++;peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,2));
    const payload=JSON.parse(messages[1].content);assert.equal(payload.context.request,'원래 요청을 유지합니다.');
    active--;return {content:JSON.stringify(answer(payload))};
  },checkSource:async()=>{assert.equal(active,0);nativeChecks++;}});
  const result=await h.run();
  assert.equal(result.status,'complete');assert.equal(peak,2);
  assert.ok(h.calls.every(call=>call.prepared.length<=4));
  assert.deepEqual(h.calls.map(call=>call.options.phase),['read','read','reduce','reduce']);
  assert.equal(nativeChecks,h.calls.length);assert.equal(h.metrics.subagentCalls,h.batches.length+5);
  assert.equal(h.snapshots[0].nodes.length,h.batches.length+5);
  assert.ok(h.snapshots[0].nodes.every(node=>node.state==='pending'));
  assert.equal(h.snapshots.at(-1).completed,h.batches.length+5);
  for(const {prepared} of h.calls)for(const job of prepared){
    assert.equal(job.brief.role,'review');assert.ok(['partition','reduction'].includes(job.worker.role));
    assert.equal(typeof job.onState,'function');assert.ok(job.key.length===64);
  }
});

test('an unfinished batch reuses successful siblings and never repeats completed earlier batches',async()=>{
  const readCalls=new Map();let failed=false,recoveries=0;
  const h=harness({complete:async messages=>{
    const payload=JSON.parse(messages[1].content);
    if(payload.batch){
      readCalls.set(payload.batch.id,(readCalls.get(payload.batch.id)||0)+1);
      if(payload.batch.id===5&&!failed){failed=true;throw new Error('model_timeout');}
    }
    return {content:JSON.stringify(answer(payload))};
  },runWrapper:async(jobs,prepared)=>{
    let outcome=await jobs.run(prepared);
    if(outcome.status==='incomplete'){recoveries++;outcome=await jobs.run(prepared);}
    return outcome;
  }});
  assert.equal((await h.run()).status,'complete');assert.equal(recoveries,1);
  for(const [id,count] of readCalls)assert.equal(count,id===5?2:1);
  assert.ok(h.stats.analysisCacheHits>=1);
});

test('changed native evidence rejects a completed worker batch before any reducer or accepted progress',async()=>{
  const h=harness({complete:async messages=>({content:JSON.stringify(answer(JSON.parse(messages[1].content)))}),checkSource:async()=>{throw new Error('source_changed');}});
  await assert.rejects(h.run(),/source_changed/);
  assert.equal(h.calls.length,1);assert.equal(h.metrics.subagentCalls,4);
  assert.equal(h.snapshots.at(-1).completed,0);
  assert.ok(h.snapshots.at(-1).nodes.filter(node=>node.phase==='reduction').every(node=>node.state==='pending'));
  assert.equal(h.snapshots.at(-1).nodes.filter(node=>node.state==='error').length,4);
});

test('cancellation stops queued workers and never starts requirement integration',async()=>{
  let h;
  h=harness({complete:async(messages,tools,signal)=>{
    h.controller.abort();
    if(signal.aborted)throw new Error('cancelled');
    return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));
  }});
  await assert.rejects(h.run(),/cancelled/);
  assert.equal(h.calls.length,1);assert.ok(h.metrics.subagentCalls<=2);
  assert.equal(h.snapshots.at(-1).completed,0);
});

test('incomplete scheduler results cannot reach reduction or mark native evidence accepted',async()=>{
  let nativeChecks=0;
  const h=harness({complete:async()=>{throw new Error('model_timeout');},checkSource:async()=>{nativeChecks++;}});
  await assert.rejects(h.run(),/analysis_incomplete/);
  assert.equal(nativeChecks,0);assert.equal(h.calls.length,1);
  assert.equal(h.snapshots.at(-1).completed,0);
});
