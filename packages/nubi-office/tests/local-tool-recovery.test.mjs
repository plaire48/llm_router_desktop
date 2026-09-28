import test from 'node:test';
import assert from 'node:assert/strict';
import {startAgent} from '../worker/agent.mjs';
import {startDocumentAgent} from '../worker/document-agent.mjs';
import {call,scriptedProvider,workbook,planCall,valueEdit,text} from './harness-fixtures.mjs';
import {documentProvider,request} from './document-fixtures.mjs';
import {createResilience} from '../worker/resilience.mjs';
import {createActivityLog} from '../worker/activity.mjs';
import fc from 'fast-check';

const fast={wait:async()=>{},random:()=>0};
async function boundary(run,handle){
  for(let i=0;i<4000;i++){
    const s=run.status();if(s.state!=='running'){await run.promise;return run.status();}
    if(s.action){if(['request_approval','request_input'].includes(s.action.name))return s;run.respond(s.action.callId,await handle(s.action));}
    await new Promise(resolve=>setImmediate(resolve));
  }
  run.cancel();await run.promise;throw new Error('fixture_timeout');
}
test('Excel cell actor pauses after three unchanged memory-tool failures without waiting for context exhaustion',async()=>{
  const native=workbook();let calls=0;
  const providers=scriptedProvider({actor:()=>{calls++;return call('read',{path:'draft/missing.txt'});}});
  const run=startAgent({request:'성적표 값을 확인해줘',mode:'edit',scope:native.snapshot(),providers,resilienceOptions:fast});
  try{
    const paused=await boundary(run,native.action);
    assert.equal(paused.action?.payload.kind,'recovery',paused.error);
    assert.equal(calls,3);assert.equal(paused.recovery.code,'workspace_file_missing');
    assert.equal(paused.recovery.withoutProgress,3);assert.equal(native.writes,0);
    await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,3);
  }finally{run.cancel();await run.promise;}
});
test('Excel document writer pauses after three rejected chunks with the original error preserved',async()=>{
  const base=documentProvider();let calls=0;
  const providers={...base,complete:async(messages,...rest)=>{
    if(messages[0].content.startsWith('NUBI_DOCUMENT_WRITER')){calls++;return call('write_document_chunk',{chunk:'{"cells":[{"address":"INVALID","value":42}]}'});}
    return base.complete(messages,...rest);
  }};
  const run=startDocumentAgent({request,providers,resilienceOptions:fast,writeFile:async()=>assert.fail('No file before accepted sheets')});
  try{
    const paused=await boundary(run,action=>{assert.equal(action.name,'show_plan');return{displayed:true};});
    assert.equal(paused.action?.payload.kind,'recovery',paused.error);
    assert.equal(calls,3);assert.equal(paused.recovery.withoutProgress,3);
    assert.notEqual(paused.recovery.code,'agent_stalled');assert.equal(paused.writes,0);
  }finally{run.cancel();await run.promise;}
});
test('the supervisor preserves failure details, pauses without replay, and resets only for changed work',async()=>{
  const controller=new AbortController(),metrics={},delays=[];let revision=0,pauses=0,calls=0;
  const resilience=createResilience({signal:controller.signal,activity:createActivityLog(),metrics,getProgress:()=>revision,random:()=>1,wait:async ms=>delays.push(ms),onStall:async()=>{pauses++;}});
  const error={error:'script_failed',errorName:'TypeError',detail:'Missing score',instruction:'Read and correct the input'};
  const execute=()=>resilience.localTool('run_script',async()=>{calls++;return error;});
  for(let i=0;i<3;i++)assert.deepEqual(await execute(),{...error,recoveryHandled:true});
  assert.equal(calls,3);assert.equal(pauses,1);assert.equal(metrics.retries,3);
  revision++;await execute();assert.equal(pauses,1);assert.equal(resilience.status().withoutProgress,1);
  assert.deepEqual(delays,[750,1500,750]);
});
test('native mutations, transport exceptions and successful local results never acquire a retry wrapper',async()=>{
  const controller=new AbortController(),metrics={};let calls=0;
  const resilience=createResilience({signal:controller.signal,activity:createActivityLog(),metrics,...fast});
  for(const name of ['apply_changes','apply_operation','document_save','office_copy','office_create','register_template','unknown_tool']){
    const result={error:'office_timeout'};assert.equal(await resilience.localTool(name,async()=>{calls++;return result;}),result);
  }
  const success={output:42};assert.equal(await resilience.localTool('run_script',async()=>{calls++;return success;}),success);
  await assert.rejects(resilience.localTool('read',async()=>{calls++;throw new Error('cancelled');}),/cancelled/);
  assert.equal(calls,9);assert.equal(metrics.retries,undefined);
});
test('HITL continuation keeps the same Excel run and sends the original failed receipt before a single approved edit',async()=>{
  const native=workbook();let resume=false,actors=0,proposed=false,sawError=false;
  const providers=scriptedProvider({actor:messages=>{
    actors++;if(!resume)return call('read',{path:'draft/missing.txt'});
    if(!proposed){sawError=messages.some(m=>m.content?.includes('workspace_file_missing'));proposed=true;return planCall([valueEdit(42)]);}
    return text('실제 셀 값을 확인했습니다.');
  }});
  const run=startAgent({request:'A1을 42로 변경해줘',mode:'edit',scope:native.snapshot(),providers,resilienceOptions:fast});
  try{
    const paused=await boundary(run,native.action);assert.equal(actors,3);assert.equal(native.writes,0);
    resume=true;run.respond(paused.action.callId,{approved:true});
    const edit=await boundary(run,native.action);assert.equal(edit.id,paused.id);assert.equal(edit.action.payload.kind,'edit');assert.ok(sawError);assert.equal(edit.metrics.retries,3);
    run.respond(edit.action.callId,{approved:true});const done=await boundary(run,native.action);
    assert.equal(done.state,'done',done.error);assert.equal(native.writes,1);assert.equal(native.snapshot().values[0][0],42);
  }finally{run.cancel();await run.promise;}
});
test('generated local failures follow one three-failure policy and never dispatch a hidden retry',async()=>{
  await fc.assert(fc.asyncProperty(fc.array(fc.boolean(),{minLength:1,maxLength:70}),async changes=>{
    const controller=new AbortController(),metrics={};let revision=0,failures=0,expectedPauses=0,pauses=0,calls=0;
    const resilience=createResilience({signal:controller.signal,activity:createActivityLog(),metrics,getProgress:()=>revision,...fast,onStall:async()=>{pauses++;}});
    for(const change of changes){if(change){revision++;failures=0;}if(++failures===3){expectedPauses++;failures=0;}
      await resilience.localTool('edit',async()=>{calls++;return{error:'workspace_edit_rejected'};});assert.equal(pauses,expectedPauses);}
    assert.equal(calls,changes.length);assert.equal(metrics.retries,changes.length);
  }),{seed:2392303,numRuns:100});
});

test('checkpoint diagnostics remain bounded, survive unrelated success, and clear on a repaired tool result',async()=>{
  const controller=new AbortController(),metrics={};
  const resilience=createResilience({signal:controller.signal,activity:createActivityLog(),metrics,...fast});
  const error={error:'script_failed',detail:'x'.repeat(1000),instruction:'y'.repeat(1000),unexpected:'not part of a checkpoint'};
  const result=await resilience.localTool('run_script',async()=>error);
  assert.equal(result.detail.length,1000);assert.equal(resilience.localFailure().detail.length,240);
  assert.equal(resilience.localFailure().instruction.length,600);assert.equal(resilience.localFailure().unexpected,undefined);
  const diagnostic=resilience.localFailure();diagnostic.error='changed';assert.equal(resilience.localFailure().error,'script_failed');
  await resilience.localTool('read',async()=>({text:'input'}));assert.equal(resilience.localFailure().error,'script_failed');
  await resilience.localTool('run_script',async()=>({resultPath:'draft/result.json'}));assert.equal(resilience.localFailure(),null);
});
test('cancellation during recovery delay fences the next model decision and never replays the failed operation',async()=>{
  const controller=new AbortController(),metrics={};let calls=0;
  const resilience=createResilience({signal:controller.signal,activity:createActivityLog(),metrics,random:()=>0,wait:async()=>controller.abort()});
  await assert.rejects(resilience.localTool('edit',async()=>{calls++;return{error:'workspace_edit_rejected'};}),/cancelled/);
  assert.equal(calls,1);assert.equal(metrics.localToolFailures,1);
  await assert.rejects(resilience.localTool('edit',async()=>{calls++;return{ok:true};}),/cancelled/);assert.equal(calls,1);
});

test('screen-review rate limits retain Retry-After through the single recovery supervisor',async()=>{
  const controller=new AbortController(),metrics={},delays=[];let calls=0;
  const resilience=createResilience({signal:controller.signal,activity:createActivityLog(),metrics,random:()=>0,wait:async ms=>delays.push(ms)});
  const failed={error:'view_review_failed',reason:'rate_limited',status:429,retryAfterMs:4500};
  const result=await resilience.localTool('review_office_view',async()=>{calls++;return failed;});
  assert.deepEqual(delays,[4500]);assert.equal(calls,1);assert.equal(result.recoveryHandled,true);
  assert.equal(resilience.localFailure().status,429);assert.equal(resilience.localFailure().retryAfterMs,4500);
  assert.equal(resilience.status().status,429);assert.equal(resilience.localFailure().reason,'rate_limited');
});

test('permanent model errors inside view review stop without recovery delays or retries',async()=>{
  const controller=new AbortController(),metrics={};let calls=0;
  const resilience=createResilience({signal:controller.signal,activity:createActivityLog(),metrics,wait:async()=>assert.fail('Do not wait for a permanent model failure')});
  for(const reason of ['unauthorized','invalid_model','tls_untrusted','context_overflow']){
    await assert.rejects(resilience.localTool('review_office_view',async()=>{calls++;return{error:'view_review_failed',reason};}),new RegExp(reason));
  }
  assert.equal(calls,4);assert.equal(metrics.retries,undefined);
});
