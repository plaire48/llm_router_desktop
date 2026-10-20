import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createWordDocument} from '../dist/word.js';
import {createHostModelTransport} from '../dist/host-model.js';
const modulePath=new URL('../dist/file-operations.js',import.meta.url),api=existsSync(modulePath)?await import(modulePath):{};
const signal=()=>new AbortController().signal;
const input=async()=>({domain:'word',origin:'new_unencrypted_draft',bytes:(await createWordDocument({title:'원본 보존 검사',sections:[{heading:'검토',paragraphs:[[{text:'변경하지 않는 문단',bold:false}]],table:null}]},signal())).bytes});
test('file operations accept only new drafts and reject unsupported work before invoking an engine',async()=>{
  assert.equal(typeof api.createGeneratedFileSession,'function');let calls=0;
  const engine={async invoke(){calls++;throw Error('unexpected');}};
  await assert.rejects(api.createGeneratedFileSession({...await input(),origin:'existing_office_document'},engine),{code:'file_origin_unsupported'});
  const session=await api.createGeneratedFileSession(await input(),engine);
  assert.ok(session.catalog().some(x=>x.op==='define_style'));
  await assert.rejects(session.apply([{op:'insert_image',path:'/private/data.png'}],'bad',signal()),{code:'file_operation_unsupported'});
  assert.equal(calls,0);
});
test('the existing agent loop discovers operations, reads revision, edits the draft and explicitly finishes',async()=>{
  assert.equal(typeof api.prepareFileDocument,'function');const tools=[];
  const engine={async invoke(r){return r.action==='read'?{observation:{blocks:[{index:2,text:'검토'}]}}:{bytes:r.bytes};}};
  const host={id:'test-model',async complete(messages,offered){
    tools.push(offered.map(t=>t.function.name));const outputs=messages.filter(m=>m.role==='tool');
    const call=(id,name,args)=>({content:'',calls:[{id,function:{name,arguments:JSON.stringify(args)}}]});
    if(!outputs.length)return call('catalog','list_file_operations',{op:'define_style'});
    if(outputs.length===1)return call('read','read_file_draft',{});
    const revision=JSON.parse(outputs.find(m=>m.tool_call_id==='read').content).revision;
    if(outputs.length===2)return call('edit','apply_file_operations',{revision,ops:[{op:'define_style',styleId:'Review'}]});
    if(outputs.length===3)return call('finish','finish_file_draft',{revision:JSON.parse(outputs.at(-1).content).revision});
    return {content:'검토용 초안 준비',calls:[]};
  }};
  const result=await api.prepareFileDocument({...await input(),request:'검토 스타일을 정의하세요.'},engine,createHostModelTransport(host),signal());
  assert.ok(result.bytes.length>1000);assert.equal(result.savedToOffice,false);assert.equal(result.semanticVerificationRequired,true);assert.deepEqual(tools.at(-1),[]);
});
test('stale revisions and concurrent edits never dispatch writes or accept late candidates',async()=>{
  assert.equal(typeof api.createGeneratedFileSession,'function');let resolveGate,writes=0;
  const gate=new Promise(r=>resolveGate=r),source=await input();
  const engine={async invoke(request){if(request.action==='read')return {observation:{text:'original'}};writes++;await gate;return {bytes:request.bytes};}};
  const session=await api.createGeneratedFileSession(source,engine),read=await session.read(signal());
  await assert.rejects(session.apply([{op:'setFont',target:{blockIndexes:[0]},bold:true}],'stale',signal()),{code:'file_revision_conflict'});
  assert.equal(writes,0);
  const controller=new AbortController(),pending=session.apply([{op:'setFont',target:{blockIndexes:[0]},bold:true}],read.revision,controller.signal);
  await new Promise(r=>setImmediate(r));controller.abort();resolveGate();
  await assert.rejects(pending,{code:'operation_cancelled'});
  assert.deepEqual(session.snapshot().bytes,source.bytes);
});
test('disposing a session cancels its injected engine without cancelling the host signal',async()=>{
  let received,entered;const ready=new Promise(r=>entered=r),hostController=new AbortController();
  const session=await api.createGeneratedFileSession(await input(),{async invoke(_r,signal){received=signal;entered();return new Promise(()=>{});}});
  const pending=session.read(hostController.signal);await ready;session.dispose();
  assert.equal(received.aborted,true);assert.equal(hostController.signal.aborted,false);
  await assert.rejects(pending,{code:'operation_cancelled'});
});
test('Word readback exposes actual direct run color so a style definition cannot hide overriding formatting',async()=>{
 const session=await api.createGeneratedFileSession(await input(),{async invoke(){return {observation:{blocks:[]}};}});
 const result=await session.read(signal());
 assert.ok(result.observation.directFormatting.some(p=>p.runs.some(r=>r.text==='변경하지 않는 문단'&&r.color==='000000')));
 session.dispose();
});
test('a declared app mismatch is rejected before an engine receives the draft',async()=>{
 let invoked=0;
 await assert.rejects(api.createGeneratedFileSession({...await input(),domain:'excel'},{async invoke(){invoked++;return {};}}),{code:'file_domain_mismatch'});
 assert.equal(invoked,0);
});
