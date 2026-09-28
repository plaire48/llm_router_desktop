import test from 'node:test';
import assert from 'node:assert/strict';
import {startAgent} from '../worker/agent.mjs';
import {startDocumentAgent} from '../worker/document-agent.mjs';
import {call,scriptedProvider,workbook,planCall,valueEdit,text} from './harness-fixtures.mjs';
import {documentProvider,request,rawSheets,syntheticSnapshot} from './document-fixtures.mjs';
import {singleToolResponse,jsonToolResponse} from '../worker/tool-response.mjs';
const fast={wait:async()=>{},random:()=>0};
async function boundary(run,handle){
  for(let i=0;i<4000;i++){
    const status=run.status();if(status.state!=='running'){await run.promise;return run.status();}
    if(status.action){if(['request_approval','request_input'].includes(status.action.name))return status;run.respond(status.action.callId,await handle(status.action));}
    await new Promise(resolve=>setImmediate(resolve));
  }
  run.cancel();await run.promise;throw new Error('fixture_timeout');
}
for(const kind of ['excel-cell','excel-document'])for(const rejection of ['schema','unknown'])test(`${kind} ${rejection} rejection pauses at three with the original cause even when call IDs repeat`,async()=>{
  const native=workbook(),base=documentProvider();let calls=0;
  const rejected=()=>{calls++;const r=call(rejection==='unknown'?'not_a_connected_tool':kind==='excel-cell'?'apply_changes':'write_document_chunk',kind==='excel-cell'?{plan:42}:{chunk:42});r.calls[0].id='same-provider-call-id';return r;};
  const providers=kind==='excel-cell'?scriptedProvider({actor:rejected}):{...base,complete:(messages,...args)=>messages[0].content.startsWith('NUBI_DOCUMENT_WRITER')?rejected():base.complete(messages,...args)};
  const run=kind==='excel-cell'?startAgent({request:'A1을 42로 바꿔줘',mode:'edit',scope:native.snapshot(),providers,resilienceOptions:fast}):startDocumentAgent({request,providers,resilienceOptions:fast,writeFile:async()=>assert.fail('Rejected calls cannot create a file')});
  try{
    const paused=await boundary(run,a=>kind==='excel-cell'?native.action(a):{displayed:true});
    assert.equal(paused.action?.payload.kind,'recovery',paused.error);assert.equal(calls,3);
    assert.equal(paused.recovery.code,rejection==='schema'?'tool_arguments_invalid':'tool_unavailable');assert.equal(paused.recovery.withoutProgress,3);
    assert.equal(native.writes,0);assert.equal(paused.metrics.retries,3);
  }finally{run.cancel();await run.promise;}
});

test('schema repair after HITL retains the same Excel run, supplies exact field feedback, and requires a separate edit approval',async()=>{
  const native=workbook();let calls=0,resumed=false,sawField=false,proposed=false;
  const providers=scriptedProvider({actor:messages=>{
    calls++;
    if(!resumed){const value=call('apply_changes',{plan:42});value.calls[0].id='repeat';return value;}
    if(!proposed){
      sawField=messages.some(m=>m.role==='user'&&m.content?.includes('tool_arguments_invalid')&&m.content.includes('"path":"/plan"')&&m.content.includes('"rule":"type"'));
      proposed=true;return planCall([valueEdit(42)]);
    }
    return text('셀 결과를 확인했습니다.');
  }});
  const run=startAgent({request:'A1을 42로 바꿔줘',mode:'edit',scope:native.snapshot(),providers,resilienceOptions:fast});
  try{
    const paused=await boundary(run,native.action);assert.equal(calls,3);assert.equal(native.writes,0);
    resumed=true;run.respond(paused.action.callId,{approved:true});
    const edit=await boundary(run,native.action);assert.equal(edit.id,paused.id);assert.equal(edit.action.payload.kind,'edit');assert.ok(sawField);assert.equal(native.writes,0);
    run.respond(edit.action.callId,{approved:true});const done=await boundary(run,native.action);
    assert.equal(done.state,'done',done.error);assert.equal(native.writes,1);assert.equal(native.snapshot().values[0][0],42);assert.equal(done.metrics.toolProtocolFailures,3);
  }finally{run.cancel();await run.promise;}
});

test('native and JSON tool protocols reject invalid fields without echoing values or unknown property names',()=>{
  const tools=[{type:'function',function:{name:'read',parameters:{type:'object',properties:{path:{type:'string',maxLength:20},offset:{type:'integer',minimum:0,maximum:100},options:{type:'object',properties:{limit:{type:'integer',maximum:5}},required:['limit'],additionalProperties:false}},required:['path'],additionalProperties:false}}}];
  const cases=[{offset:1},{path:42},{path:'x',offset:-1},{path:'x',offset:101},{path:'x'.repeat(21)},{path:'x',options:{limit:6}},{path:'x',secret_customer_token:'must_not_be_logged'},{path:'x',options:{limit:1,secret_customer_token:'must_not_be_logged'}}];
  for(const args of cases){
    let nativeError,jsonError;
    try{singleToolResponse(call('read',args),tools);}catch(error){nativeError=error;}
    try{jsonToolResponse(text(JSON.stringify({tool:'read',arguments:args})),tools);}catch(error){jsonError=error;}
    assert.equal(nativeError?.message,'tool_arguments_invalid');assert.deepEqual(nativeError.toolFailure,jsonError.toolFailure);
    assert.equal(nativeError.toolFailure.actionIssued,false);assert.ok(nativeError.toolFailure.issues.length<=4);
    assert.doesNotMatch(JSON.stringify(nativeError.toolFailure),/secret_customer_token|must_not_be_logged/);
    for(const issue of nativeError.toolFailure.issues){
      assert.equal(typeof issue.path,'string');assert.equal(typeof issue.rule,'string');
      assert.deepEqual(Object.keys(issue).filter(key=>!['path','rule','objectSchemaPath','objectSchemas','schemaHintsTruncated'].includes(key)),[]);
      // Repair hints may name only properties that the host declared for this tool.
      for(const hint of issue.objectSchemas||[]){
        assert.deepEqual(Object.keys(hint).filter(key=>!['allowedProperties','requiredProperties','additionalProperties'].includes(key)),[]);
        for(const name of [...hint.allowedProperties,...hint.requiredProperties])assert.ok(['path','offset','options','limit'].includes(name),name);
      }
    }
  }
});
test('rejection guidance explains schema hints only when the rejection carries them',()=>{
  const tools=[{type:'function',function:{name:'read',parameters:{type:'object',properties:{path:{type:'string'},offset:{type:'integer',minimum:0}},required:['path'],additionalProperties:false}}}];
  const rejected=args=>{try{singleToolResponse(call('read',args),tools);}catch(error){return error.toolFailure;}};
  const missing=rejected({offset:1});
  assert.deepEqual(missing.issues[0].objectSchemas,[{allowedProperties:['path','offset'],requiredProperties:['path'],additionalProperties:false}]);
  assert.match(missing.instruction,/objectSchemas/);assert.match(missing.instruction,/NOT executed/);
  const range=rejected({path:'x',offset:-1});
  assert.deepEqual(range.issues,[{path:'/offset',rule:'minimum'}]);
  assert.doesNotMatch(range.instruction,/objectSchemas/);
});

test('single-tool admission preserves valid arguments, ignores the speculative batch tail, and rejects undeclared tools and malformed JSON',()=>{
  const tools=[{type:'function',function:{name:'read',parameters:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}}}];
  const valid=call('read',{path:'draft/data.json'}),original=structuredClone(valid);
  assert.equal(singleToolResponse(valid,tools),valid);assert.deepEqual(valid,original);
  const batch={...valid,calls:[...valid.calls,...call('secret_unknown_tool',{token:'raw_token'}).calls]};
  assert.equal(singleToolResponse(batch,tools).calls.length,1);assert.equal(batch.calls.length,2);
  assert.throws(()=>singleToolResponse(call('secret_unknown_tool',{token:'raw_token'}),tools),error=>error.message==='tool_unavailable'&&!JSON.stringify(error.toolFailure).includes('secret_unknown_tool')&&!JSON.stringify(error.toolFailure).includes('raw_token'));
  const bad=call('read',{});bad.calls[0].function.arguments='{broken private value';
  assert.throws(()=>singleToolResponse(bad,tools),error=>error.message==='tool_arguments_invalid'&&JSON.stringify(error.toolFailure.issues)==='[{"path":"","rule":"json"}]'&&!JSON.stringify(error).includes('private value'));
});

test('document schema repair retains an accepted chunk across HITL and still stops at final save approval',async()=>{
  const base=documentProvider();let calls=0,resumed=false,sawDraft=false,sawField=false,files=0,opens=0;
  const providers={...base,complete:(messages,...args)=>{
    if(!messages[0].content.startsWith('NUBI_DOCUMENT_WRITER'))return base.complete(messages,...args);
    calls++;
    if(calls===1)return call('write_document_chunk',{chunk:JSON.stringify({cells:[rawSheets[0].cells[0]]})});
    if(!resumed)return call('write_document_chunk',{chunk:42});
    const packet=JSON.parse(messages.findLast(m=>m.role==='user').content);
    if(packet.currentSheet.name===rawSheets[0].name){
      sawDraft=packet.partialDraft.cells.some(c=>c.address==='A1'&&c.value===rawSheets[0].cells[0].value);
      sawField=packet.lastError.error==='tool_arguments_invalid'&&packet.lastError.issues.some(i=>i.path==='/chunk'&&i.rule==='type');
    }
    return base.complete(messages,...args);
  }};
  const run=startDocumentAgent({request,providers,resilienceOptions:fast,writeFile:async()=>{files++;return{fileName:'control.xlsx',sha256:'control',path:'/synthetic/draft.xlsx'};}});
  const handle=a=>a.name==='document_open'?(opens++,syntheticSnapshot(a.payload)):{displayed:true};
  try{
    const paused=await boundary(run,handle);assert.equal(paused.action.payload.kind,'recovery');assert.equal(calls,4);assert.equal(files,0);
    resumed=true;run.respond(paused.action.callId,{approved:true});
    const save=await boundary(run,handle);assert.equal(save.id,paused.id);assert.equal(save.action.payload.kind,'save');assert.ok(sawDraft&&sawField);
    assert.equal(save.metrics.retries,3);assert.equal(files,1);assert.equal(opens,1);assert.equal(save.artifact,undefined);
  }finally{run.cancel();await run.promise;}
});
