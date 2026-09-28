import test from 'node:test';
import assert from 'node:assert/strict';
import {createResilience,retryDelay} from '../worker/resilience.mjs';
import {createActivityLog} from '../worker/activity.mjs';
import {defaultOfficeModel,createProviders} from '../worker/providers.mjs';
import {mergeDocumentChunk} from '../worker/document-chunks.mjs';
import {startDocumentAgent} from '../worker/document-agent.mjs';
import {documentProvider,request,rawSheets,documentTask,syntheticSnapshot,documentVerdict} from './document-fixtures.mjs';
import {call,text,drive} from './harness-fixtures.mjs';
const fast={wait:async()=>{},random:()=>0};
const saved={saved:true,path:'C:/Documents/test.xlsx',sha256:'hash',documentId:'draft-id'};
const file=async()=>({fileName:'test.xlsx',sha256:'hash'});
const doc=(providers,options={})=>startDocumentAgent({request,providers,writeFile:file,resilienceOptions:fast,...options});
const host=a=>a.name==='document_open'?syntheticSnapshot(a.payload):saved;

test('Qwen 3.8 27B preference uses an actual catalog ID and preserves all alternatives and explicit selections',async()=>{
 const models=[{id:'aipro-fast-model'},{id:'qwen3.8-27b',label:'qwen3.8-27b_CLI'},{id:'QWEN3.8-27B-FP8-256K'}];
 assert.equal(defaultOfficeModel(models),'qwen3.8-27b');assert.equal(defaultOfficeModel([{id:'unrelated'}]),'unrelated');
 const p=createProviders({startLogin:async()=>({result:Promise.resolve({token:'private',models}),cancel(){}})});await p.login('aipro');await new Promise(r=>setImmediate(r));
 assert.equal(p.status().model,'qwen3.8-27b');assert.equal(p.status().models.length,3);p.model('aipro-fast-model');assert.equal(p.status().model,'aipro-fast-model');p.dispose();
});

test('five transient failures require an explicit no-progress checkpoint before continuing inference',async()=>{
 const controller=new AbortController(),metrics={modelCalls:0},activity=createActivityLog(),delays=[];
 let paused=0;const h=createResilience({signal:controller.signal,metrics,activity,wait:async ms=>delays.push(ms),random:()=>1,onStall:async r=>{assert.equal(r.withoutProgress,3);paused++;}});let calls=0;
 const response=await h.complete({complete:async()=>{if(++calls<6)throw Object.assign(new Error('upstream'),{status:503});return text('ok');}},[]);
 assert.equal(response.content,'ok');assert.equal(calls,6);assert.equal(paused,1);assert.deepEqual(delays,[750,1500,6000,12000]);assert.equal(retryDelay(100,()=>1),30000);assert.equal(h.status(),null);assert.ok(activity.snapshot().every(e=>e.state!=='done'));
});

test('per-attempt timeout cancels a stuck model call and retries the same unfinished inference',async()=>{
 const controller=new AbortController(),metrics={modelCalls:0};let calls=0,aborted=false;
 const h=createResilience({signal:controller.signal,metrics,activity:createActivityLog(),attemptTimeoutMs:10,...fast});
 const r=await h.complete({complete:async(_m,_t,signal)=>{if(++calls===1){signal.addEventListener('abort',()=>aborted=true);return new Promise(()=>{});}return text('resumed');}},[]);
 assert.equal(r.content,'resumed');assert.equal(calls,2);assert.ok(aborted);
});

test('user cancellation interrupts backoff immediately and does not restart inference',async()=>{
 const controller=new AbortController(),metrics={modelCalls:0};let attempts=0;
 const h=createResilience({signal:controller.signal,metrics,activity:createActivityLog()});const p=h.complete({complete:async()=>{attempts++;throw new Error('rate_limited');}},[]);
 while(!h.status())await new Promise(r=>setImmediate(r));controller.abort();await assert.rejects(p);assert.equal(attempts,1);
});

test('authorization rejection is not converted into an endless model retry or false success',async()=>{
 const controller=new AbortController();let calls=0;const h=createResilience({signal:controller.signal,metrics:{modelCalls:0},activity:createActivityLog(),...fast});
 await assert.rejects(h.complete({complete:async()=>{calls++;throw Object.assign(new Error('unauthorized'),{status:401});}},[]),/unauthorized/);assert.equal(calls,1);
});

test('whole document review can require five revisions before saving exactly once',async()=>{
 let reviews=0;const calls=[];const run=doc(documentProvider({review:p=>++reviews<=5?{...documentVerdict(p),status:'revise',revisionSheets:['운영계획'],feedback:'교육 내용을 구체적으로 보완하세요.'}:documentVerdict(p)}));
 const r=await drive(run,a=>{calls.push(a.name);return host(a);});assert.equal(r.state,'done',r.error);assert.equal(reviews,6);assert.equal(r.metrics.revisionPasses,5);assert.equal(calls.filter(n=>n==='document_open').length,6);assert.equal(calls.filter(n=>n==='document_save').length,1);
});

test('long sheet output continues in small chunks across context checkpoints without losing cells',async()=>{
 const ordinary=documentProvider();let checkpoints=0,chunkCalls=0;
 const p={status:ordinary.status,complete:async(messages,tools)=>{
   if(!messages[0].content.startsWith('NUBI_DOCUMENT_WRITER'))return ordinary.complete(messages,tools);
   const initial=JSON.parse(messages.find(m=>m.role==='user').content);const source=rawSheets.find(s=>s.name===initial.currentSheet.name);
   if(initial.partialDraft)checkpoints++;
   const last=messages.findLast(m=>m.role==='tool'),receipt=last?JSON.parse(last.content):null;
   const count=receipt?.cellCount??initial.partialDraft?.cells.length??0;
   if(count<source.cells.length){chunkCalls++;const {cells,...layout}=source;return call('write_document_chunk',{chunk:JSON.stringify({...(!count?layout:{}),cells:cells.slice(count,count+2)})});}
   return call('commit_document_sheet');
 }};
 const r=await drive(doc(p),a=>{if(a.name==='document_open'){for(let i=0;i<2;i++)assert.equal(a.payload.specs[i].cells.length,rawSheets[i].cells.length);}return host(a);});
 assert.equal(r.state,'done',r.error);assert.ok(checkpoints>0);assert.ok(chunkCalls>16);assert.equal(r.writes,2);
});

test('chunk validation is atomic and repairs a prior fragment without discarding other cells',()=>{
 const first=mergeDocumentChunk(null,{address:'A1:B2',cells:[{address:'A1',value:'title'},{address:'B2',value:0}]},'Sheet1');
 assert.throws(()=>mergeDocumentChunk(first,{cells:Array.from({length:25},()=>({address:'A2',value:1}))},'Sheet1'),/document_schema_invalid/);
 assert.equal(first.cells.length,2);const second=mergeDocumentChunk(first,{removeCells:['B2'],cells:[{address:'a2',value:false}]},'Sheet1');assert.deepEqual(second.cells.map(c=>c.address),['A1','A2']);assert.equal(second.cells[1].value,false);
});

test('unresolved native uncertainty is repeatedly inspected without replay and cancellation ends it',async()=>{
 const run=doc(documentProvider());let saveCount=0,reads=0;
 for(let i=0;i<1000;i++){
  const s=run.status();if(s.action){const a=s.action;let r;if(a.name==='show_plan')r={displayed:true};else if(a.name==='request_approval')r={approved:true};else if(a.name==='document_save'){saveCount++;r={error:'office_timeout'};}else if(a.name==='document_reconcile'){reads++;r={outcome:'uncertain'};}else r=host(a);run.respond(a.callId,r);}
  if(reads===5){assert.equal(run.status().state,'running');assert.equal(run.status().artifact,undefined);run.cancel();break;}
  await new Promise(r=>setImmediate(r));
 }
 await run.promise;assert.equal(run.status().state,'cancelled');assert.equal(saveCount,1);assert.equal(reads,5);
});

test('a lost tool-result acknowledgement can be delivered twice without executing a second tool',async()=>{
 const run=doc(documentProvider());let deliveries=0;
 const r=await drive(run,a=>{const result=host(a);run.respond(a.callId,result);deliveries++;return result;});assert.equal(r.state,'done',r.error);assert.equal(deliveries,2);
});

test('long recovery logs remain bounded and event IDs are never reused',()=>{
 const log=createActivityLog();for(let i=0;i<1000;i++)log.note('retry');const events=log.snapshot();assert.equal(events.length,240);assert.equal(new Set(events.map(e=>e.id)).size,240);assert.equal(events.at(-1).id,1000);
});
