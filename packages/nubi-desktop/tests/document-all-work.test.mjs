import test from 'node:test';import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';import path from 'node:path';
import {fixture} from './fixtures.mjs';import {hash} from '../runtime/files.mjs';
import {compareDocumentValues} from '../runtime/document-consistency.mjs';
import {documentWorkStatuses} from '../ui/document-work-status.mjs';
import {createPdfEditorPort} from '../ui/pdf-editor-port.mjs';
import {createPdfFormSession} from '../ui/pdf-form-session.mjs';
import {formPdf} from './helpers-form-pdf.mjs';
import * as pdfjs from '../../../extensions/aipro-chat/node_modules/pdfjs-dist/legacy/build/pdf.mjs';
const signal=()=>new AbortController().signal;
const reopen=bytes=>pdfjs.getDocument({data:bytes,isEvalSupported:false,useSystemFonts:true}).promise;
test('PDF agent port preserves field identity, detects stale edits and serializes a verified copy',async()=>{
 const doc=await reopen(formPdf());try{const session=await createPdfFormSession(doc,{reopen});let changes=0,connected=true;
 const binding={app:'pdf',mode:'internal',connectionId:'c',documentId:'form.pdf'},endpoint={session,isBusy:()=>false,changed:()=>changes++},port=createPdfEditorPort({binding,endpoint:()=>endpoint,isCurrent:()=>connected,dirty:()=>session.dirty()});
 const before=await port.inspect(signal()),start=before.text.indexOf('Before'),patch={start,end:start+6,oldText:'Before',newText:'After'};
 assert.equal((await port.replaceIfCurrent(before,patch,signal())).status,'confirmed');assert.equal(changes,1);
 await assert.rejects(port.replaceIfCurrent(before,patch,signal()),/changed/);
 const output=await session.export(),copy=await reopen(output.bytes.slice());assert.equal((await copy.getFieldObjects()).get('Name')[0].value,'After');assert.equal((await copy.getFieldObjects()).get('Reference')[0].value,'Keep');await copy.loadingTask.destroy();
 const current=await port.inspect(signal()),offset=current.text.indexOf('Name');await assert.rejects(port.replaceIfCurrent(current,{start:offset,end:offset+4,oldText:'Name',newText:'Renamed'},signal()),/fields_invalid/);
 session.undo();assert.equal(session.value(session.fields[0].id),'Before');connected=false;await assert.rejects(port.inspect(signal()),/disconnected/);
 }finally{await doc.loadingTask.destroy();}
});
test('cross document comparison uses exact numeric ranges and keeps mismatch evidence',async t=>{
 const f=await fixture(t),s=f.service,task=await s.createTask({request:'문서 수치 비교'}),text='Total: 1,200.00원';
 s.store.set('chat-document:a',{id:'a',projectId:s.projectId,hash:hash(text),text,filename:'source.pdf'});task.documentReferences=[{id:'a',sourceHash:hash(text)}];
 const file='Total: 1200원';await writeFile(path.join(await s.target(task.id),'result.md'),file);
 const refs=[{kind:'attachment',id:'a',sourceHash:hash(text),start:7,end:15},{kind:'workspace',path:'result.md',sourceHash:hash(file),start:7,end:11}],args={label:'합계',unit:'원',references:refs};
 assert.equal((await compareDocumentValues(s,task,args,signal())).status,'matched');
 await writeFile(path.join(await s.target(task.id),'result.md'),'Total: 1300원');await assert.rejects(compareDocumentValues(s,task,args,signal()),/source_stale/);
 refs[1].sourceHash=hash('Total: 1300원');assert.equal((await compareDocumentValues(s,task,args,signal())).status,'mismatch');
 await assert.rejects(compareDocumentValues(s,task,{...args,references:[refs[0],{...refs[1],start:8}]},signal()),/boundary/);
 await assert.rejects(compareDocumentValues(s,task,{...args,references:[refs[0],refs[0]]},signal()),/duplicate/);
 task.documentReferences=[];await assert.rejects(compareDocumentValues(s,task,args,signal()),/scope/);
});
test('document statuses do not turn a buffer receipt into a saved file',()=>{
 assert.equal(documentWorkStatuses({liveEditor:{result:{status:'verified'}}})[0].save,'저장 여부 미확인');
 assert.equal(documentWorkStatuses({liveEditor:{bufferState:{dirty:true}}})[0].save,'저장 전');
 assert.equal(documentWorkStatuses({nativeOffice:{outcome:{finished:true}}})[0].save,'Office에서 저장 필요');
 assert.equal(documentWorkStatuses({nativeOffice:{saveReceipt:{saved:true},saveUncertain:true}})[0].save,'저장 결과 확인 필요');
});
