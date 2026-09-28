// Real worker/Pi control flow with scripted model/native ports, not live Office.
import test from 'node:test';
import assert from 'node:assert/strict';
import {startContentAgent} from '../worker/content-agent.mjs';
import {call,text} from './harness-fixtures.mjs';

const encoded=value=>text(JSON.stringify(value));
function setup(host,mode='complete'){
  const items=Array.from({length:200},(_,i)=>({id:`item-${i}`,kind:host==='word'?'paragraph':'shape',text:`실제 항목 ${i}: `+'확인한 보고 내용 '.repeat(110),editable:false}));
  let fingerprint='original',model='scripted-qwen-id',partitions=0,reductions=0,failedOnce=false;const actions=[],requests=[],seen=new Set();
  const page=offset=>({host,scopeId:'source',documentId:'source',fingerprint,created:false,total:items.length,offset,nextOffset:offset+40<items.length?offset+40:null,items:items.slice(offset,offset+40)});
  const providers={status:()=>({provider:'aipro',model}),complete:async(messages,tools)=>{
    requests.push({messages,tools});const system=messages[0].content;
    if(system.includes('_PLANNER.'))return encoded({intent:'analyze',title:'보고서 확인',summary:'문서의 내용을 확인합니다.',requirements:['보고서 본문을 확인한다'],save:false,steps:[{id:'inspect',title:'원본 확인',kind:'inspect'},{id:'analyze',title:'본문 분석',kind:'analyze'},{id:'verify',title:'전체 검토',kind:'verify'}]});
    if(system.includes('_PARTITION_REVIEWER.')){
      partitions++;assert.deepEqual(tools,[]);const packet=JSON.parse(messages[1].content);
      assert.equal(packet.context.request,'긴 보고서의 전체 내용을 확인해줘');
      assert.ok(JSON.stringify(packet.context.userRequirements).includes('정산 코드 0000417을 보존하세요.'));
      assert.ok(packet.context.resources);assert.ok(Array.isArray(packet.context.answers));
      if(packet.batch.id===2&&(mode==='repeat_timeout'||mode==='transient'&&!failedOnce)){failedOnce=true;throw new Error('model_timeout');}
      for(const entry of packet.batch.items)for(const item of entry.value.items)seen.add(item.id);
      if(mode==='cancel')return new Promise(()=>{});
      if(mode==='changed')fingerprint='user-edit';
      if(mode==='model_changed')model='different-model';
      const item=packet.batch.items[0].value.items[0];
      return encoded({checks:[{requirement:0,status:mode==='conflict'?'conflict':'support',finding:'본문을 확인했습니다.',sources:[{itemId:item.id,field:'text',quote:item.text.slice(0,100)}]}]});
    }
    if(system.includes('_PARTITION_REDUCER.')){reductions++;assert.deepEqual(tools,[]);return encoded({status:'complete',checks:[{requirement:0,status:'met',evidence:[1]}],feedback:''});}
    if(system.includes('_REVIEWER.'))return encoded({status:'complete',checks:[{criterion:'현재 단계 확인',status:'met',evidence:[1]}],feedback:''});
    return call('finish_step',{answer:'문서 내용을 확인했습니다.'});
  }};
  const run=startContentAgent({host,request:'긴 보고서의 전체 내용을 확인해줘',scope:page(0),history:[{role:'user',content:'정산 코드 0000417을 보존하세요.'}],providers,resilienceOptions:{wait:async()=>{}}});
  async function drive(){
    for(let i=0;i<4000;i++){
      const state=run.status();
      if(mode==='cancel'&&partitions){run.cancel();await run.promise;return run.status();}
      if(state.state!=='running'){await run.promise;return run.status();}
      if(state.action){
        if(state.action.name==='request_approval')return state;
        actions.push(state.action.name);
        if(state.action.name==='office_read'){
          if(mode==='model_changed_after_read'&&reductions)model='changed-during-native-read';
          run.respond(state.action.callId,page(state.action.payload.offset));
        }
        else if(state.action.name==='show_plan')run.respond(state.action.callId,{displayed:true});
        else throw new Error('Unexpected native action '+state.action.name);
      }
      await new Promise(resolve=>setImmediate(resolve));
    }
    throw new Error('test_boundary_timeout');
  }
  return {run,drive,actions,requests,seen,get partitions(){return partitions;},get reductions(){return reductions;}};
}
for(const host of ['word','powerpoint'])test(`${host} reviews more than 180k characters without dropping source items or issuing a write`,async()=>{
  const testCase=setup(host);
  try{
    const result=await testCase.drive();assert.equal(result.state,'done',result.error);
    assert.equal(result.review.mode,'partitioned');assert.equal(result.review.coverage.items,200);
    assert.equal(testCase.seen.size,200);assert.ok(testCase.partitions>1);assert.equal(testCase.reductions,1);
    assert.equal(result.writes,0);assert.equal(result.artifact,undefined);
    assert.ok(testCase.actions.every(name=>['office_read','show_plan'].includes(name)));
    assert.equal(result.metrics.requestContext.rejected,0);
  }finally{testCase.run.cancel();await testCase.run.promise;}
});
for(const mode of ['changed','model_changed','model_changed_after_read','cancel'])test(`long review ${mode} fences remaining calls and completion`,async()=>{
  const testCase=setup('word',mode);
  try{
    const result=await testCase.drive();assert.equal(result.state,mode==='cancel'?'cancelled':'failed');
    if(mode==='changed')assert.equal(result.error,'source_changed');
    if(mode.startsWith('model_changed'))assert.equal(result.error,'analysis_invalid');
    if(mode==='changed')assert.equal(testCase.partitions,4);
    if(mode==='cancel')assert.ok(testCase.partitions<=2);
    assert.equal(testCase.reductions,mode==='model_changed_after_read'?1:0);assert.equal(result.writes,0);
    assert.ok(result.reviewWorkers.nodes.every(node=>!['running','pending','waiting'].includes(node.state)));
  }finally{testCase.run.cancel();await testCase.run.promise;}
});
test('repeated partition conflict reaches existing recovery HITL instead of gaining endless fake progress',async()=>{
  const testCase=setup('word','conflict');
  try{
    const result=await testCase.drive();assert.equal(result.action?.name,'request_approval',result.error);
    assert.equal(result.action.payload.kind,'recovery');assert.notEqual(result.review.status,'complete');
    assert.ok(testCase.reductions<=5);assert.equal(result.writes,0);
    const calls=testCase.requests.length;testCase.run.respond(result.action.callId,{approved:false});await testCase.run.promise;
    assert.equal(testCase.run.status().state,'cancelled');assert.equal(testCase.requests.length,calls);
  }finally{testCase.run.cancel();await testCase.run.promise;}
});

test('the parent recovers only the failed worker and reuses successful sibling results',async()=>{
  const testCase=setup('word','transient');
  try{
    const result=await testCase.drive();assert.equal(result.state,'done',result.error);
    const calls=new Map();for(const request of testCase.requests.filter(r=>r.messages[0].content.includes('_PARTITION_REVIEWER.'))){
      const id=JSON.parse(request.messages[1].content).batch.id;calls.set(id,(calls.get(id)||0)+1);
    }
    for(const [id,count] of calls)assert.equal(count,id===2?2:1);
    assert.ok(result.metrics.partitionWorkers.analysisCacheHits>=3);assert.equal(result.metrics.retries,1);
    assert.ok(result.reviewWorkers.nodes.every(node=>node.state==='done'));assert.equal(result.writes,0);
  }finally{testCase.run.cancel();await testCase.run.promise;}
});
test('three failures in one worker pause the same run without replaying successful siblings',async()=>{
  const testCase=setup('word','repeat_timeout');
  try{
    const result=await testCase.drive();assert.equal(result.action?.payload.kind,'recovery',result.error);
    assert.equal(result.recovery.withoutProgress,3);assert.equal(testCase.reductions,0);
    const calls=testCase.requests.filter(r=>r.messages[0].content.includes('_PARTITION_REVIEWER.'));
    assert.equal(calls.filter(r=>JSON.parse(r.messages[1].content).batch.id===1).length,1);
    assert.equal(calls.filter(r=>JSON.parse(r.messages[1].content).batch.id===2).length,3);
    testCase.run.respond(result.action.callId,{approved:false});await testCase.run.promise;
    assert.equal(testCase.run.status().state,'cancelled');assert.equal(result.writes,0);
  }finally{testCase.run.cancel();await testCase.run.promise;}
});
