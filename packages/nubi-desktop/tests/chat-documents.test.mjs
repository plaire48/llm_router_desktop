import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir,symlink} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {PersonalMail} from './helpers-personal-mail.mjs';
async function documentsFixture(t){const value=await fixture(t);value.service.personalMail=new PersonalMail(value.service,{personalRoot:path.join(value.directory,'mail')});return value;}
import {samplePdf} from './helpers-document-pdf.mjs';
import {readChatDocument,validateDocuments} from '../runtime/chat-documents.mjs';

test('picked PDF and text become immutable scoped document snapshots',async t=>{
 const {service,root,directory}=await documentsFixture(t);
 const text=path.join(directory,'보고서.md'),pdf=path.join(directory,'report.pdf');
 await writeFile(text,'# Budget\nApproved budget: 1200.');await writeFile(pdf,samplePdf());
 const result=await service.importDocumentSelection({projectId:service.projectId,paths:[text,pdf]});
 assert.deepEqual(result.errors,[]);assert.equal(result.documents.length,2);
 const [ref,pdfRef]=result.documents;const task=await service.createTask({request:'Compare these documents',documentReferences:result.documents});
 assert.match(readChatDocument(service,ref,task).text,/1200/);assert.match(readChatDocument(service,pdfRef,task).text,/Revenue/);
 await writeFile(text,'Changed after upload');assert.match(readChatDocument(service,ref,task).text,/1200/);
 assert.throws(()=>readChatDocument(service,ref,{documentReferences:[]}),/document_scope/);
 assert.throws(()=>validateDocuments(service,[{...ref,sourceHash:'forged'}]),/chat_document_missing/);
 const record=service.store.get('chat-document:'+ref.id);assert(!JSON.stringify(record).includes(directory));assert.equal(record.path,undefined);
 const other=path.join(directory,'other');await mkdir(other);await service.open(other);assert.throws(()=>readChatDocument(service,ref),/chat_document_missing/);
});
test('partial import reports failures and long documents expose subsequent windows',async t=>{
 const {service,directory}=await documentsFixture(t);const file=path.join(directory,'long.txt'),link=path.join(directory,'link.txt'),bad=path.join(directory,'bad.exe');
 await writeFile(file,'Verified section.\n'.repeat(2000));await writeFile(bad,'not a document');const targets=[file,bad];if(process.platform!=='win32'){await symlink(file,link);targets.splice(1,0,link);}
 const result=await service.importDocumentSelection({projectId:service.projectId,paths:targets});
 assert.equal(result.documents.length,1);assert.deepEqual(result.errors.map(e=>e.error),process.platform==='win32'?['document_format']:['document_scope','document_format']);
 const first=readChatDocument(service,result.documents[0]);assert.equal(first.partial,true);assert(first.nextOffset>0);
 const next=readChatDocument(service,{...result.documents[0],offset:first.nextOffset});assert.equal(next.offset,first.nextOffset);assert(next.text.length>0);
 await assert.rejects(service.importDocumentSelection({projectId:service.projectId,paths:Array(11).fill(file)}),/chat_document_limit/);
 await assert.rejects(service.importDocumentSelection({projectId:'other',paths:[file]}),/project_changed/);
});

test('agent reads only selected snapshots and returns their source identity',async t=>{
 const {installAgent}=await import('../runtime/agent.mjs');const {ProjectService}=await import('../runtime/project-service.mjs');installAgent(ProjectService);
 const {service,directory}=await documentsFixture(t);const file=path.join(directory,'budget.txt');await writeFile(file,'Approved budget: 1200.');
 const {documents}=await service.importDocumentSelection({projectId:service.projectId,paths:[file]});let calls=0,observed;
 service.providers={status:()=>({connected:true,provider:'aipro',model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async(messages,tools)=>{
  if(calls++===0){assert(tools.some(tool=>tool.function?.name==='read_attached_document'||tool.name==='read_attached_document'));return {content:'',calls:[{id:'document-read',type:'function',function:{name:'read_attached_document',arguments:JSON.stringify({id:documents[0].id,sourceHash:documents[0].sourceHash})}}]};}
  const result=messages.findLast(item=>item.role==='tool');observed=JSON.parse(result.content);return {content:`Approved budget: 1200. [1](${observed.citations[0].href})`,calls:[]};
 }};
 const task=await service.createTask({request:'What budget is in the selected document?',documentReferences:documents});await service.startAgent({taskId:task.id});await service.agent.promise;
 assert.match(observed.text,/1200/);assert.equal(observed.citations[0].kind,'document');assert.equal(observed.citations[0].sourceHash,documents[0].sourceHash);
 assert(service.task(task.id).messages.some(m=>m.role==='assistant'&&m.content.includes('1200')));
});
