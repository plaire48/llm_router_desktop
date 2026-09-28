// Scripted state/receipt tests, not live model accuracy or Office COM evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {createToolProgressGuard} from '../worker/tool-progress.mjs';
import {createActivityLog} from '../worker/activity.mjs';
import {startAgent} from '../worker/agent.mjs';
import {startDocumentAgent} from '../worker/document-agent.mjs';
import {call,scriptedProvider,workbook,text,planCall,valueEdit} from './harness-fixtures.mjs';
import {documentProvider,request,rawSheets,syntheticSnapshot} from './document-fixtures.mjs';

function fixture(overrides={}) {
  const controller=new AbortController(),activity=createActivityLog(),metrics={};
  let revision=0,issued=0,pauses=0;
  const guard=createToolProgressGuard({signal:controller.signal,activity,metrics,getProgress:()=>({revision}),onStall:async()=>{pauses++;},...overrides});
  return {guard,controller,metrics,activity,change:()=>revision++,get issued(){return issued;},get pauses(){return pauses;},
    run:(name='read_document',args={offset:0})=>guard.run(name,args,async()=>{issued++;return{observed:true};})};
}
test('canonical inputs prevent a repeated call, permit one replan, then pause without dispatching it',async()=>{
  const f=fixture();
  for(let i=0;i<4;i++)await f.run('read_document',i%2?{itemIds:['x'],offset:0}:{offset:0,itemIds:['x']});
  assert.equal(f.issued,2);assert.equal(f.pauses,1);
  assert.deepEqual(f.metrics.toolProgress,{prevented:2,replans:1,pauses:1});
  assert.equal(f.guard.feedback().actionIssued,false);
  await f.run();assert.equal(f.issued,3); // New decision after explicit continuation.
});
test('alternating two- and three-call loops are bounded while new ranges remain readable',async()=>{
  for(const width of [2,3]){
    const f=fixture();for(let i=0;i<width*3+1;i++)await f.run('read_document',{offset:(i%width)*40});
    assert.equal(f.issued,width*3-1);assert.equal(f.pauses,1);
  }
  const f=fixture();for(let i=0;i<60;i++)await f.run('read_document',{offset:i*40});
  assert.equal(f.issued,60);assert.equal(f.pauses,0);
});
test('changed state resets loop evidence and native mutations keep their own execution guards',async()=>{
  const f=fixture();
  for(let i=0;i<20;i++){await f.run();await f.run();f.change();}
  for(let i=0;i<10;i++)await f.run('apply_operation',{plan:'same'});
  assert.equal(f.issued,50);assert.equal(f.pauses,0);
});
test('JSON chunk key order does not disguise unchanged draft patches, but array order is significant',async()=>{
  const f=fixture();
  for(let i=0;i<3;i++)await f.run('write_document_chunk',{chunk:i%2?' {"cells":[{"value":42,"address":"A1"}]}':'{"cells":[{"address":"A1","value":42}]}'});
  assert.equal(f.issued,2);assert.equal(f.metrics.toolProgress.prevented,1);
  const g=fixture();await g.run('read_document',{itemIds:['a','b']});await g.run('read_document',{itemIds:['a','b']});await g.run('read_document',{itemIds:['b','a']});
  assert.equal(g.issued,3);
});
test('errors stay with the error supervisor and cancellation fences operations after a pending pause',async()=>{
  const f=fixture();await f.run();await f.run();
  await assert.rejects(f.guard.run('search_document',{query:'x'},async()=>{throw new Error('network_timeout');}),/network_timeout/);
  await f.run();assert.equal(f.issued,3);
  let resume;const g=fixture({onStall:()=>new Promise(resolve=>{resume=resolve;})});
  for(let i=0;i<3;i++)await g.run();
  const pending=g.run();g.controller.abort();resume();await assert.rejects(pending,/cancelled/);
  await assert.rejects(g.run(),/cancelled/);assert.equal(g.issued,2);
});
test('generated progress sequences agree with an independent no-progress state machine',async()=>{
  await fc.assert(fc.asyncProperty(fc.array(fc.boolean(),{minLength:1,maxLength:100}),async changes=>{
    const f=fixture();let count=0,issued=0,pauses=0;
    for(const change of changes){
      if(change){f.change();count=0;}
      count++;if(count<3)issued++;if(count===4){pauses++;count=0;}
      await f.run();assert.equal(f.issued,issued);assert.equal(f.pauses,pauses);
    }
  }),{numRuns:150,seed:2392026});
});

async function untilAction(run,handle){
  for(let i=0;i<2000;i++){
    const s=run.status();if(s.state!=='running'){await run.promise;return run.status();}
    if(s.action){if(['request_approval','request_input'].includes(s.action.name))return s;run.respond(s.action.callId,await handle(s.action));}
    await new Promise(resolve=>setImmediate(resolve));
  }
  run.cancel();await run.promise;throw new Error('Scripted test timed out');
}
const fast={wait:async()=>{},random:()=>0};
test('Excel loop evidence survives a normal context checkpoint',async()=>{
  const native=workbook();let actors=0;
  const tools=['read_selection','excel_capabilities','recall_context'];
  const providers=scriptedProvider({actor:()=>{const name=tools[actors++%3];return call(name,name==='recall_context'?{query:'원본 조건'}:{});}});
  const run=startAgent({request:'A1을 42로 변경해줘',mode:'edit',scope:native.snapshot(),providers,resilienceOptions:fast});
  try{
    const paused=await untilAction(run,native.action);
    assert.equal(paused.recovery.code,'tool_loop_detected');assert.ok(actors>8&&actors<=12);
    assert.equal(paused.metrics.toolProgress.prevented,2);assert.equal(native.writes,0);
  }finally{run.cancel();await run.promise;}
});
test('Excel repeated reads pause before the context checkpoint; explicit continuation keeps the run and writes once',async()=>{
  const native=workbook();let repeated=true,actors=0,edited=false;
  const providers=scriptedProvider({actor:()=>{actors++;if(repeated)return call('read_selection');if(!edited){edited=true;return planCall([valueEdit(42)]);}return text('셀 확인 완료');}});
  const run=startAgent({request:'A1을 42로 변경해줘',mode:'edit',scope:native.snapshot(),providers,resilienceOptions:fast});
  try{
    const paused=await untilAction(run,native.action);
    assert.equal(paused.action.payload.kind,'recovery');assert.equal(paused.recovery.code,'tool_loop_detected');
    assert.equal(actors,4);assert.equal(native.writes,0);assert.equal(paused.metrics.toolProgress.prevented,2);
    await new Promise(resolve=>setImmediate(resolve));assert.equal(actors,4);
    repeated=false;run.respond(paused.action.callId,{approved:true});
    const edit=await untilAction(run,native.action);assert.equal(edit.id,paused.id);assert.equal(edit.action.payload.kind,'edit');
    run.respond(edit.action.callId,{approved:true});const done=await untilAction(run,native.action);
    assert.equal(done.state,'done',done.error);assert.equal(native.writes,1);assert.equal(native.snapshot().values[0][0],42);
  }finally{run.cancel();await run.promise;}
});
test('document writer retains the partial sheet through loop HITL and needs a separate save approval',async()=>{
  let repeat=true,actors=0,seenDraft=false;
  const base=documentProvider(),chunk={address:rawSheets[0].address,cells:[rawSheets[0].cells[0]]};
  const providers={...base,complete:async(messages,...args)=>{
    if(messages[0].content.startsWith('NUBI_DOCUMENT_WRITER')){
      actors++;if(repeat)return call('write_document_chunk',{chunk:JSON.stringify(chunk)});
      if(messages.some(m=>m.role==='tool'&&m.content.includes('tool_loop_detected')))seenDraft=true;
    }
    return base.complete(messages,...args);
  }};
  const run=startDocumentAgent({request,providers,resilienceOptions:fast,writeFile:async()=>({fileName:'test.xlsx',sha256:'hash'})});
  const handle=a=>a.name==='show_plan'?{displayed:true}:a.name==='document_open'?{...syntheticSnapshot(a.payload),opened:true}:{saved:true,path:'test.xlsx',sha256:'hash',documentId:'draft-id'};
  try{
    const paused=await untilAction(run,handle);assert.equal(paused.recovery.code,'tool_loop_detected');assert.equal(actors,5);assert.equal(paused.writes,0);
    repeat=false;run.respond(paused.action.callId,{approved:true});
    const save=await untilAction(run,handle);assert.equal(save.id,paused.id);assert.equal(save.action.payload.kind,'save');assert.equal(save.writes,2);assert.equal(seenDraft,true);
    run.respond(save.action.callId,{approved:false});await run.promise;assert.equal(run.status().state,'cancelled');
  }finally{run.cancel();await run.promise;}
});

test('repeated screenshots and view reviews cannot masquerade as document progress',async()=>{
  for(const name of ['inspect_office_view','show_document_target','review_office_view']){
    const f=fixture();for(let i=0;i<4;i++)await f.run(name,{address:'A1'});
    assert.equal(f.issued,2);assert.equal(f.pauses,1);
  }
});
test('long text and specialist tools share no-progress loop protection',async()=>{
  for(const name of ['inspect_document_structure','read_document_text','read_delegation_results','delegate_document_tasks','delegate_range_tasks','delegate_draft_tasks']){
    const f=fixture();for(let i=0;i<4;i++)await f.run(name,{same:'unchanged'});assert.equal(f.issued,2,name);assert.equal(f.pauses,1,name);
  }
});
