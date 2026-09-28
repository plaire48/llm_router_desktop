import test from 'node:test';import assert from 'node:assert/strict';
import {startDocumentAgent} from '../worker/document-agent.mjs';import {startAgent} from '../worker/agent.mjs';
import {officeQuestion} from '../worker/interaction.mjs';
import {documentProvider,request,documentTask,syntheticSnapshot} from './document-fixtures.mjs';
import {workbook,scriptedProvider,call,drive} from './harness-fixtures.mjs';
const fast={wait:async()=>{}};
async function advanceToApproval(run,host){for(let i=0;i<1000;i++){const s=run.status();if(s.action?.name==='request_approval')return s.action;if(s.action)run.respond(s.action.callId,s.action.name==='show_plan'?{displayed:true}:host(s.action));await new Promise(r=>setImmediate(r));}throw new Error('approval missing');}
test('complete document waits for explicit HITL before saving; declining is user cancellation',async()=>{
 let saves=0;const run=startDocumentAgent({request,providers:documentProvider(),resilienceOptions:fast,writeFile:async()=>({fileName:'fixture.xlsx',sha256:'fixture'})});
 const approval=await advanceToApproval(run,a=>{if(a.name==='document_save')saves++;return syntheticSnapshot(a.payload);});
 assert.equal(run.status().phase,'awaiting_approval');assert.equal(approval.payload.kind,'save');assert.equal(saves,0);assert.ok(approval.payload.verification);run.respond(approval.callId,{approved:false});await run.promise;assert.equal(run.status().state,'cancelled');assert.equal(saves,0);
});
test('cell edit presents exact operations and remains unexecuted until approval',async()=>{
 const book=workbook(),run=startAgent({request:'A1을 42로',scope:book.snapshot(),mode:'edit',providers:scriptedProvider(),resilienceOptions:fast});
 const approval=await advanceToApproval(run,a=>book.action(a));assert.equal(book.writes,0);assert.equal(approval.payload.operations[0].values[0][0],42);run.cancel();await run.promise;assert.equal(book.writes,0);assert.throws(()=>run.respond(approval.callId,{approved:true}),/stale_tool_result/);
});
test('document ambiguity uses a grounded choice form and retains a free text input mode',async()=>{
 const question={question:'집계 기준은 무엇인가요?',choices:[{label:'부서별',description:'부서를 기준으로 집계'},{label:'사업별',description:'사업을 기준으로 집계'}],input_mode:'long_text'};
 const task={...documentTask,intent:'clarify',sheets:[],questions:[question]};const run=startDocumentAgent({request,providers:documentProvider({task}),resilienceOptions:fast});for(let i=0;i<100&&!run.status().action;i++)await new Promise(r=>setImmediate(r));const s=run.status();assert.equal(s.state,'running');assert.equal(s.action.name,'request_input');assert.equal(s.questionForm.kind,'choice');assert.equal(s.questionForm.options.length,2);assert.equal(s.questionForm.inputMode,'long_text');assert.equal(s.writes,0);run.cancel();await run.promise;
});
test('cell actor can ask grounded choices through the shared Nubi question contract',async()=>{
 const book=workbook(),run=startAgent({request:'기준에 맞춰 변경',scope:book.snapshot(),mode:'edit',resilienceOptions:fast,providers:scriptedProvider({actor:[call('ask_user',{question:'어느 기준을 적용할까요?',choices:[{label:'당월'},{label:'누계'}]})]})});const r=await drive(run,a=>book.action(a));assert.equal(r.state,'awaiting_user');assert.equal(r.questionForm.options[1].label,'누계');assert.equal(book.writes,0);
});
test('question schema rejects fabricated image references and duplicate choices',()=>{assert.throws(()=>officeQuestion({question:'?',image_refs:['img-1','img-2']}));assert.throws(()=>officeQuestion({question:'?',choices:[{label:'same'},{label:'same'}]}));});
