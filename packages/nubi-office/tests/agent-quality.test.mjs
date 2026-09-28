import test from 'node:test';
import assert from 'node:assert/strict';
import {startDocumentAgent} from '../worker/document-agent.mjs';
import {startAgent} from '../worker/agent.mjs';
import {jsonToolMessages} from '../worker/tool-response.mjs';
import {rawSheets,documentProvider,syntheticSnapshot} from './document-fixtures.mjs';
import {call,text,drive,workbook,scriptedProvider,contract,valueEdit} from './harness-fixtures.mjs';
const fast={wait:()=>new Promise(r=>setImmediate(r)),random:()=>0};
const saved={saved:true,path:'C:/Documents/report.xlsx',sha256:'fixture-hash',documentId:'draft-id'};

test('cyclic draft is patched from exact source cells before any XLSX or Excel action',async()=>{
 const ordinary=documentProvider();let repaired=false,reads=0,chunks=0,files=0,opens=0,firstSheetWrites=0;
 const p={status:ordinary.status,complete:async(m,t)=>{
  if(!m[0].content.startsWith('NUBI_DOCUMENT_WRITER'))return ordinary.complete(m,t);
  const initial=JSON.parse(m.find(r=>r.role==='user').content),last=m.findLast(r=>r.role==='tool'),receipt=last?JSON.parse(last.content):null;
  if(initial.currentSheet.name==='운영계획')firstSheetWrites++;
  if(initial.feedback){
   assert.equal(initial.currentSheet.name,'예산');assert.equal(files,0);assert.equal(opens,0);
   assert.equal(initial.partialDraft.cells.find(c=>c.address==='D9').formula,'=SUM(D6:D9)');
   assert.match(initial.feedback,/circular_formula/);assert.equal(initial.otherSheets[0].cells,undefined);
   if(!receipt)return call('read_document_draft',{sheet:'운영계획',address:'C5:D5'});
   if(receipt.source){assert.equal(receipt.cells.find(c=>c.address==='D5').value,20);reads++;chunks++;return call('write_document_chunk',{chunk:JSON.stringify({cells:[{address:'D9',formula:'=SUM(D6:D8)'}]})});}
   assert.equal(receipt.chunkAccepted,true);repaired=true;return call('commit_document_sheet');
  }
  const sheet=structuredClone(rawSheets.find(s=>s.name===initial.currentSheet.name));
  if(sheet.name==='예산')sheet.cells.find(c=>c.address==='D9').formula='=SUM(D6:D9)';
  return call('write_document_sheet',{sheet:JSON.stringify(sheet)});
 }};
 const r=await drive(startDocumentAgent({request:'교육 운영계획과 예산 작성',providers:p,resilienceOptions:fast,writeFile:async(task,specs)=>{
  files++;assert.equal(repaired,true);assert.equal(specs[1].cells.find(c=>c.address==='D6').formula,'=B6*C6');assert.equal(specs[1].cells.find(c=>c.address==='B8').value,300000);assert.deepEqual(specs[1].merges,rawSheets[1].merges);return{fileName:'report.xlsx',sha256:'fixture'};
 }}),a=>{if(a.name==='document_open'){opens++;return syntheticSnapshot(a.payload);}return saved;});
 assert.equal(r.state,'done',r.error);assert.equal(firstSheetWrites,1);assert.equal(reads,1);assert.equal(chunks,1);assert.equal(files,1);assert.equal(opens,1);assert.equal(r.metrics.formulaPreflight.passes,2);assert.equal(r.validation.verified,true);
});

test('cell actor with no native tool support uses one validated JSON call and verified readback',async()=>{
 const book=workbook();let native=0,json=0;
 const providers=scriptedProvider({actor:(m,t)=>{
  if(t.length){native++;return text('실행하겠습니다.');}json++;
  assert.match(m[0].content,/exactly ONE next tool/);assert.equal(m.some(r=>r.role==='tool'||r.tool_calls),false);
  const receipt=m.findLast(r=>r.role==='user'&&r.content.includes('toolReceipt'));
  if(!receipt)return text(JSON.stringify({tool:'apply_changes',arguments:{plan:{operations:[valueEdit(42)]}}}));
  assert.match(receipt.content,/snapshot|verified|applied/);return text(JSON.stringify({answer:'A1 값 42 확인'}));
 }});
 const r=await drive(startAgent({request:'A1을 42로 변경',mode:'edit',scope:book.snapshot(),providers,resilienceOptions:fast}),a=>book.action(a));
 assert.equal(r.state,'done',r.error);assert.equal(native,1);assert.equal(json,2);assert.equal(book.writes,1);assert.equal(r.validation.verified,true);assert.equal(r.metrics.toolProtocolFallbacks,1);
});

test('JSON final answer cannot waive unmet checks or repeat uncertain writes',async()=>{
 for(const uncertain of [false,true]){
  const book=workbook();let json=0;
  const providers=scriptedProvider({actor:(m,t)=>{
   if(t.length)return text('수정하겠습니다.');
   if(++json===1)return text(JSON.stringify(uncertain?{tool:'apply_changes',arguments:{plan:{operations:[valueEdit(42)]}}}:{answer:'완료'}));
   return text(JSON.stringify({tool:'ask_user',arguments:{question:'추가로 확인할 값이 있나요?'}}));
  }});
  const r=await drive(startAgent({request:'A1을 42로 변경',mode:'edit',scope:book.snapshot(),providers,resilienceOptions:fast}),a=>uncertain&&a.name==='apply_changes'?{error:'write_uncertain'}:book.action(a));
  assert.notEqual(r.state,'done');assert.equal(book.writes,0);assert.equal(r.error,uncertain?'write_uncertain':'');assert.ok(json<=2);
 }
});

test('template JSON fallback retains same-run HITL answers and merged input scope',async()=>{
 const book=workbook();book.state.values=[[null,null]];Object.assign(book.state,{readOnly:false,protected:false});book.state.properties.mergedAddress=[['A1:B1','A1:B1']];
 let i=0,questions=0;
 const actions=[{tool:'define_template_fields',arguments:{fields:[{address:'A1',label:'담당 부서',valueType:'text',required:true}]}},{tool:'ask_template_field',arguments:{fieldId:'field_A1'}},{tool:'fill_template_fields',arguments:{values:[]}},{answer:'담당 부서 입력 완료'}];
 const providers=scriptedProvider({task:contract([{address:'A1',field:'value',operator:'not_empty'}]),actor:(m,t)=>t.length?text('양식을 채우겠습니다.'):text(JSON.stringify(actions[i++]))});
 const r=await drive(startAgent({request:'담당 부서 입력',mode:'template',scope:book.snapshot(),providers,resilienceOptions:fast}),a=>{
  if(a.name==='request_input'){questions++;assert.equal(book.writes,0);return{text:'인사'};}return book.action(a);
 });
 assert.equal(r.state,'done',r.error);assert.equal(questions,1);assert.equal(book.writes,1);assert.equal(book.state.values[0][0],'인사');assert.equal(r.template.fields[0].applied,true);assert.equal(i,4);
});

test('malformed historical tool arguments remain rejected data when switching transport',()=>{
 const output=jsonToolMessages([{role:'system',content:'system'},{role:'assistant',tool_calls:[{function:{name:'apply_changes',arguments:'{"broken"'}}]}],[]);
 const history=JSON.parse(output[1].content);assert.equal(history.rejectedTool,'apply_changes');assert.equal(history.arguments,undefined);assert.equal(history.invalidArguments,'{"broken"');
});
