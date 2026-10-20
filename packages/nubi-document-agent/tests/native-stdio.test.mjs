import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../dist/index.js';

function setup(){
  assert.equal(typeof api.createOfficeXNativeReadCaller,'function','Existing Office X stdio caller is not connected');
  const sent=[];let receive;
  const caller=api.createOfficeXNativeReadCaller({runId:'read-run-1',send:m=>sent.push(m),subscribe:fn=>{receive=fn;return()=>{receive=null;};}});
  return {caller,sent,deliver:message=>receive?.(message)};
}
test('the caller uses the existing tool/result envelopes and requires run and call identity',async()=>{
  const h=setup(),controller=new AbortController();const pending=h.caller.call('inspect_office',{steps:[]},controller.signal);
  const request=h.sent[0];assert.equal(request.type,'tool');assert.equal(request.runId,'read-run-1');
  assert.equal(request.name,'inspect_office');assert.ok(request.id);
  h.deliver({type:'tool_result',runId:'other-run',id:request.id,result:{wrong:true}});
  h.deliver({type:'tool_result',runId:request.runId,id:'wrong-call',result:{wrong:true}});
  h.deliver({type:'tool_result',runId:request.runId,id:request.id,result:{snapshotId:'observed-1',results:['actual result']}});
  assert.deepEqual(await pending,{snapshotId:'observed-1',results:['actual result']});h.caller.close();
});
test('runtime mutation tool names are rejected before transport dispatch',async()=>{
  const h=setup();await assert.rejects(h.caller.call('execute_office_operations',{},new AbortController().signal),{code:'native_read_tool_required'});
  assert.equal(h.sent.length,0);h.caller.close();
});
test('cancelled calls discard late native results and leave the caller usable',async()=>{
  const h=setup(),controller=new AbortController();const pending=h.caller.call('inspect_office_members',{target:'document'},controller.signal);
  const failed=assert.rejects(pending,{code:'operation_cancelled'});controller.abort();await failed;
  h.deliver({...h.sent[0],type:'tool_result',result:{late:true}});
  const next=h.caller.call('inspect_office',{},new AbortController().signal);
  h.deliver({...h.sent[1],type:'tool_result',result:{fresh:true}});assert.deepEqual(await next,{fresh:true});h.caller.close();
});
test('connection loss rejects pending calls instead of leaving a read waiting forever',async()=>{
  const h=setup(),pending=h.caller.call('inspect_office',{},new AbortController().signal);
  const failed=assert.rejects(pending,{code:'native_connection_closed'});h.caller.close();await failed;
  await assert.rejects(h.caller.call('inspect_office',{},new AbortController().signal),{code:'native_connection_closed'});
});
test('malformed correlated responses fail without exposing private native errors',async()=>{
  const h=setup(),pending=h.caller.call('inspect_office',{},new AbortController().signal);
  h.deliver({...h.sent[0],type:'tool_result',error:'private failure body'});
  await assert.rejects(pending,{code:'native_response_invalid'});h.caller.close();
});
