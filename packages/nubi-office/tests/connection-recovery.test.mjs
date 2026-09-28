import test from 'node:test';
import assert from 'node:assert/strict';
import {safeError,createProviders} from '../worker/providers.mjs';
import {transient,createResilience} from '../worker/resilience.mjs';
import {createActivityLog} from '../worker/activity.mjs';
import {modelJson} from '../worker/model-json.mjs';
import {startDocumentAgent} from '../worker/document-agent.mjs';
import {documentProvider,documentTask,documentVerdict,syntheticSnapshot,rawSheets} from './document-fixtures.mjs';
import {call,text,drive} from './harness-fixtures.mjs';
import {errorText} from '../src/errors.js';
import {startLogin} from '../worker/aipro-auth.mjs';
const fast={wait:()=>new Promise(r=>setImmediate(r)),random:()=>0};
const file=async()=>({fileName:'scorecard.xlsx',sha256:'fixture-hash'});
const saved={saved:true,path:'C:/Documents/scorecard.xlsx',sha256:'fixture-hash',documentId:'draft-id'};
const request='수식한번 만들어볼래? 내가 원하는 건 수능 성적표이고 그거에 대한 표 양식이야';
async function until(run,predicate){for(let i=0;i<1000;i++){const s=run.status();if(predicate(s))return s;if(s.state!=='running')assert.fail('Unexpected termination: '+s.error);await new Promise(r=>setImmediate(r));}run.cancel();assert.fail('Run did not reach checkpoint');}

test('AI Pro callback preserves safe authentication and connection causes without replaying exchange',async()=>{
 for(const [response,expected] of [[()=>{throw new TypeError('fetch failed',{cause:{code:'UNABLE_TO_VERIFY_LEAF_SIGNATURE'}});},'tls_untrusted'],[()=>new Response('private body',{status:401}),'unauthorized'],[()=>new Response('<html>private login</html>'),'response_json_invalid']]){
  let exchanges=0;const flow=await startLogin({fetchImpl:async()=>{exchanges++;return response();},openBrowser:async url=>{const port=new URL(url).searchParams.get('port');await fetch(`http://127.0.0.1:${port}/auth?status=00&code=private-test-code`);},timeoutMs:2000});
  await assert.rejects(flow.result,e=>e.message===expected);assert.equal(exchanges,1);flow.cancel();
 }
});

test('fetch causes survive safe redaction and permanent connection faults never retry',async()=>{
 for(const [cause,expected] of Object.entries({UNABLE_TO_VERIFY_LEAF_SIGNATURE:'tls_untrusted',SELF_SIGNED_CERT_IN_CHAIN:'tls_untrusted',CERT_HAS_EXPIRED:'tls_expired',ERR_TLS_CERT_ALTNAME_INVALID:'tls_hostname',ENOTFOUND:'network_dns',ECONNREFUSED:'network_refused'})){
  const error=new TypeError('fetch failed',{cause:Object.assign(new Error('https://private.example/?token=do-not-leak'),{code:cause})});
  assert.equal(safeError(error),expected);assert.equal(transient(error),false);assert.ok(errorText(expected).includes(expected));assert.ok(!errorText(expected).includes('do-not-leak'));
  let calls=0;const h=createResilience({signal:new AbortController().signal,activity:createActivityLog(),metrics:{modelCalls:0},...fast});
  await assert.rejects(h.complete({complete:async()=>{calls++;throw error;}},[]));assert.equal(calls,1);
 }
 assert.equal(safeError(new TypeError('fetch failed',{cause:new AggregateError([{code:'ECONNREFUSED'}])})),'network_refused');
 assert.equal(safeError(new TypeError('fetch failed',{cause:{code:'ETIMEDOUT'}})),'network_timeout');
 assert.equal(transient(new TypeError('fetch failed',{cause:{code:'ECONNRESET'}})),true);
});

test('an HTML proxy/login response is a distinct response error, not a hidden request_failed',async()=>{
 const p=createProviders({fetchImpl:async()=>new Response('<html>internal login with private token</html>',{headers:{'Content-Type':'application/json'}})});
 await p.connect({provider:'compatible',baseUrl:'https://test.invalid/v1',token:'never-public',model:'exact-id'});
 try{await p.complete([],[],new AbortController().signal,()=>{},()=>{});assert.fail('Expected rejection');}catch(e){assert.equal(safeError(e),'response_json_invalid');assert.equal(transient(e),false);assert.ok(!errorText(safeError(e)).includes('never-public'));}finally{p.dispose();}
});

test('one complete JSON object tolerates Markdown but ambiguous and truncated payloads fail',()=>{
 assert.deepEqual(modelJson('설명\n```json\n{"id":"R1","text":"brace } in text"}\n```'),{id:'R1',text:'brace } in text'});
 assert.deepEqual(modelJson('<think>private reasoning</think>{"ok":true}'),{ok:true});
 for(const s of ['{"a":1} {"b":2}','```json\n{"a":1}\n```\n{"b":2}','{"a":"partial','<think>not closed {"a":1}'])assert.throws(()=>modelJson(s));
});

test('the reported scorecard request with uppercase IDs reaches sequential tools and native readback',async()=>{
 const task={intent:'create',title:'수능 성적표 입력 양식',summary:'성적을 입력하는 표와 입력 항목 수 계산식을 만듭니다.',requirements:[{id:'R1',text:'성적표 표 양식'},{id:'R2',text:'빈 입력칸과 입력 항목 수 수식'},{id:'R3',text:'제목, 테두리, 열 너비'}],questions:[],sheets:[{name:'성적표',purpose:'성적 입력과 확인',requirementIds:['R1','R2','R3']}]};
 const sheet={name:'성적표',address:'A1:D10',cells:[{address:'A1',value:'수능 성적표 입력 양식'},{address:'A3',value:'성명'},{address:'B3',value:''},{address:'A5',value:'영역'},{address:'B5',value:'표준점수'},{address:'C5',value:'백분위'},{address:'D5',value:'등급'},{address:'A6',value:'국어'},{address:'B6',value:''},{address:'C6',value:''},{address:'D6',value:''},{address:'A7',value:'수학'},{address:'B7',value:''},{address:'C7',value:''},{address:'D7',value:''},{address:'A9',value:'입력된 등급 수'},{address:'D9',formula:'=COUNT(D6:D7)'},{address:'A10',value:'발급 성적표의 값을 입력하세요.'}],formats:[{address:'A1:D1',style:{bold:true,fontSize:18}},{address:'A5:D5',style:{bold:true,fillColor:'#E7EEF7'}}],merges:['A1:D1','A10:D10'],columnWidths:[1,2,3,4].map(index=>({index,size:20})),rowHeights:[{index:1,size:32}],borders:[{address:'A5:D7',color:'#AAB8CA'}],page:{orientation:'portrait'}};
 let writerCalls=0,hostWrites=0;
 const p={status:()=>({model:'scripted-qwen-contract-only'}),complete:async(m,t)=>{
  if(m[0].content.startsWith('NUBI_DOCUMENT_PLANNER')){assert.equal(m.at(-1).content,request);return text('```json\n'+JSON.stringify(task)+'\n```');}
  if(m[0].content.startsWith('NUBI_DOCUMENT_REVIEWER'))return text(JSON.stringify({status:'complete',checks:task.requirements.map(r=>({requirementId:r.id,requirement:r.text,status:'met',evidence:[{sheet:'성적표',address:r.id==='R2'?'D9':'A1'}]})),revisionSheets:[],feedback:''}));
  writerCalls++;const last=m.findLast(r=>r.role==='tool');const count=last?JSON.parse(last.content).cellCount:0;
  if(!count){const {cells,...layout}=sheet;const first=call('write_document_chunk',{chunk:JSON.stringify({...layout,cells:cells.slice(0,12)})});first.calls.push(...call('commit_document_sheet').calls);return first;}
  if(count===12){assert.equal(writerCalls,2);return call('write_document_chunk',{chunk:JSON.stringify({cells:sheet.cells.slice(12)})});}
  assert.equal(count,sheet.cells.length);return call('commit_document_sheet');
 }};
 const run=startDocumentAgent({request,providers:p,writeFile:file,resilienceOptions:fast});
 const r=await drive(run,a=>{if(a.name==='document_open'){hostWrites++;assert.equal(writerCalls,3);assert.equal(a.payload.specs[0].cells.length,sheet.cells.length);return syntheticSnapshot(a.payload);}return saved;});
 assert.equal(r.state,'done',r.error);assert.equal(hostWrites,1);assert.equal(r.metrics.retries,0);assert.equal(r.metrics.recoveryPauses,undefined);assert.ok(r.activity.some(e=>e.detail.includes('초안 12개')));
});

test('three unchanged planner failures pause with zero Excel actions and do not continue without approval',async()=>{
 let calls=0;const run=startDocumentAgent({request,providers:{status:()=>({model:'scripted'}),complete:async()=>{calls++;return text('{"wrong":true}');}},writeFile:()=>assert.fail('No file before plan'),resilienceOptions:fast});
 const s=await until(run,s=>s.action?.payload?.kind==='recovery');assert.equal(calls,3);assert.equal(s.phase,'awaiting_recovery');assert.equal(s.plan,null);assert.equal(s.writes,0);assert.equal(s.recovery.code,'document_schema_invalid');assert.ok(s.activity.filter(e=>e.kind==='recovery').every(e=>e.state!=='done'));
 for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r));assert.equal(calls,3);
 run.respond(s.action.callId,{approved:false});await run.promise;assert.equal(run.status().state,'cancelled');assert.equal(calls,3);
});

test('resuming a stalled second sheet keeps the same run and never rewrites the accepted first sheet',async()=>{
 let fail=true,firstSheetCalls=0;const ordinary=documentProvider();
 const p={status:ordinary.status,complete:async(m,t)=>{if(m[0].content.startsWith('NUBI_DOCUMENT_WRITER')){const v=JSON.parse(m.find(r=>r.role==='user').content);if(v.currentSheet.name==='운영계획')firstSheetCalls++;else if(fail)throw new Error('network_error');}return ordinary.complete(m,t);}};
 const run=startDocumentAgent({request:'교육 문서',providers:p,writeFile:file,resilienceOptions:fast});
 let s=await until(run,s=>!!s.action);run.respond(s.action.callId,{displayed:true});s=await until(run,s=>s.action?.payload?.kind==='recovery');const id=s.id;
 assert.equal(s.writes,1);assert.equal(firstSheetCalls,1);assert.equal(s.plan.completed,2);assert.match(s.action.payload.target,/1개 시트 초안 보존/);
 fail=false;run.respond(s.action.callId,{approved:true});const r=await drive(run,a=>a.name==='document_open'?syntheticSnapshot(a.payload):saved);assert.equal(r.state,'done',r.error);assert.equal(r.id,id);assert.equal(firstSheetCalls,1);assert.equal(r.writes,2);assert.equal(r.metrics.recoveryPauses,1);
});

test('a writer without native tool calls switches to one validated JSON tool per model turn',async()=>{
 const ordinary=documentProvider();let native=0,fallback=0;
 const p={status:ordinary.status,complete:async(m,t)=>{
  if(!m[0].content.startsWith('NUBI_DOCUMENT_WRITER'))return ordinary.complete(m,t);
  if(t.length){native++;return text('문서를 만들겠습니다.');}
  fallback++;assert.match(m[0].content,/exactly ONE next tool/);assert.equal(m.some(r=>r.role==='tool'||r.tool_calls),false);
  const initial=JSON.parse(m.find(r=>r.role==='user').content);const sheet=rawSheets.find(s=>s.name===initial.currentSheet.name);
  return text(JSON.stringify({tool:'write_document_sheet',arguments:{sheet}}));
 }};
 const r=await drive(startDocumentAgent({request:'교육 문서',providers:p,writeFile:file,resilienceOptions:fast}),a=>a.name==='document_open'?syntheticSnapshot(a.payload):saved);
 assert.equal(r.state,'done',r.error);assert.equal(native,2);assert.equal(fallback,2);assert.equal(r.writes,2);
});
