import test from 'node:test';import assert from 'node:assert/strict';
import {readAttachmentDocument,officeCacheUsable} from '../runtime/mail-document-routing.mjs';
import {prepareMailWikiAttachments} from '../runtime/mail-wiki-attachments.mjs';
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
test('Windows Office reads use COM directly, failures do not become parser success, other documents stay built in',async()=>{
 const calls=[],office=async()=>{calls.push('com');return {text:'Office 원문',reader:'office_com'};},parse=async()=>{calls.push('parser');return {text:'내장 원문'};};
 assert.equal((await readAttachmentDocument({platform:'win32',attachment:{filename:'report.docx'},office,parse})).reader,'office_com');assert.deepEqual(calls,['com']);
 await assert.rejects(readAttachmentDocument({platform:'win32',attachment:{filename:'budget.xlsx'},office:async()=>{throw Error('document_office_missing');},parse}),/document_office_missing/);assert.deepEqual(calls,['com']);
 await readAttachmentDocument({platform:'win32',attachment:{filename:'guide.pdf'},office,parse});assert.deepEqual(calls,['com','parser']);
 assert.equal(officeCacheUsable({filename:'a.pptx',reader:'document_parser'},'win32'),false);assert.equal(officeCacheUsable({filename:'a.pptx',reader:'office_com'},'win32'),true);
});
test('topic evidence reads unresolved attachments, preserves file receipts and explicitly records unread files',async()=>{
 const bytes=Buffer.from('첨부의 확정 예산은 7천만원입니다.'),hash=sha(bytes),part={id:'budget',filename:'budget.docx',sha256:hash},source={id:'mail1',sourceHash:'original',attachmentDirectory:'/fixture',mail:{text:'검토 부탁합니다.',attachments:[part,{id:'bad',filename:'broken.pdf',sha256:sha(Buffer.from('broken'))}]}};let remembered=0;
 const mail={read:async()=>source,readAttachmentBytes:async(s,a)=>a.id==='bad'?Buffer.from('broken'):bytes,extractAttachment:async(bytes,part)=>{if(part.id==='bad')throw Error('document_password');return {text:bytes.toString(),coverage:'Word 본문',reader:'office_com',officeVersion:'16.0'};},rememberAttachmentDocument:async()=>remembered++};
 const result=await prepareMailWikiAttachments(mail,source,new AbortController().signal);assert.equal(remembered,1);assert.match(result.mail.attachments[0].text,/7천만원/);assert.equal(result.mail.attachments[0].reader,'office_com');assert.equal(result.mail.attachments[1].contentState,'document_attention');assert.equal(result.mail.attachments[1].error,'document_password');
 mail.read=async()=>({...source,sourceHash:'changed'});await assert.rejects(prepareMailWikiAttachments(mail,source,new AbortController().signal),/mail_source_changed/);
});
test('topic creation uses built-in attachment text as cited generation evidence and saves file hash receipts',async t=>{
 const {Store}=await import('../runtime/store.mjs'),{generateMailTopic}=await import('../runtime/mail-topic-wiki.mjs'),{PersonalMail}=await import('../runtime/mail.mjs'),{mkdtemp,rm,readFile}=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const root=await mkdtemp(path.join(os.tmpdir(),'mail-topic-attachment-')),store=new Store(root,{mailList:true});t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
 const bytes=Buffer.from('확정 예산은 7천만원입니다.'),part={id:'budget',filename:'budget.txt',sha256:sha(bytes)},source={id:'a',sourceHash:'ha',attachmentDirectory:root,mail:{subject:'예산 자료',from:'owner@example.test',date:'2026-10-01',text:'첨부 예산을 확인해 주세요.',attachments:[part]}};
 store.set('mail:a',{id:'a',account:'fixture',sourceHash:'ha',state:'indexed',listMetadata:{sourceHash:'ha',subject:'예산 자료',from:'owner@example.test',attachments:[part]}});
 const providers={status:()=>({provider:'fixture',model:'fixture'}),complete:async messages=>{assert.match(JSON.stringify(messages),/7천만원/);return {content:JSON.stringify(messages[0].content.startsWith('REVIEW_PERSONAL_MAIL')?{status:'ready',supports:[{target:'summary',source:'attachment:a:budget:1',quote:'확정 예산은 7천만원입니다.'}]}:{summary:'첨부 예산 자료에는 확정 예산이 7천만원으로 명시돼 있습니다.',category:'information',priority:'medium',facts:[],actionItems:[]})};}};
 const mail={store,wikiRoot:root,host:{providers},destination:{provider:'fixture',model:'fixture'},modelAvailable:()=>true,ensureWiki:async()=>{},read:async()=>source,readAttachmentBytes:async()=>bytes,extractAttachment:PersonalMail.prototype.extractAttachment,rememberAttachmentDocument:async(s,id,document)=>{source.mail.attachments=[{...part,...document,contentState:'document_read'}];}};
 const result=await generateMailTopic(mail,{id:'a',sourceHash:'ha'}),text=await readFile(result.path,'utf8');assert.match(text,/7천만원/);assert.match(text,/budget.txt/);assert(text.includes(part.sha256));assert.equal(result.coverage.complete,true);
});
