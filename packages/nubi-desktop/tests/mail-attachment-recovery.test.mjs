import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import {PersonalMail} from '../runtime/mail.mjs';
import {readMailAttachmentsForAgent} from '../runtime/mail-agent-attachments.mjs';
import {AnswerSources} from '../runtime/answer-sources.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');

test('the worker reads Word, Excel and PowerPoint attachment bytes',async()=>{
 const word=new JSZip();word.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');word.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>누비 문서 검증</w:t></w:r></w:p></w:body></w:document>');
 const book=new ExcelJS.Workbook();book.addWorksheet('예산').addRow(['누비 문서 검증',120000]);
 const slides=new JSZip();slides.file('ppt/slides/slide1.xml','<a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:r><a:t>누비 문서 검증</a:t></a:r></a:p>');
 const mail=Object.create(PersonalMail.prototype);
 for(const [filename,bytes] of [['budget.docx',await word.generateAsync({type:'nodebuffer'})],['budget.xlsx',Buffer.from(await book.xlsx.writeBuffer())],['budget.pptx',await slides.generateAsync({type:'nodebuffer'})]]){
  const result=await mail.extractAttachment(bytes,{filename},new AbortController().signal);
  assert.match(result.text,/누비 문서 검증/,filename);assert(result.coverage);
 }
});

test('Windows accepts a verified parser result and local folder attachments work without portal credentials',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mail-attachment-recovery-'));const mail=new PersonalMail({storageRoot:root},{personalRoot:path.join(root,'mail')});
 t.after(async()=>{mail.dispose();await rm(root,{recursive:true,force:true});});
 mail.autoWiki=true;mail.drain=async()=>{};const id='a'.repeat(64),bytes=Buffer.from('한글 첨부 본문'),attachment={id:'attachment',filename:'letter.txt',sha256:sha(bytes),contentState:'text_read',text:bytes.toString()};
 const row={id,protocol:'local',account:'local-folder',state:'queued',sourceHash:'original',attachmentState:'queued'};
 mail.store.set('mail:'+id,row);mail.source=async()=>({subject:'로컬 메일',text:'본문',attachments:[attachment]});await mkdir(path.join(mail.rawRoot,id),{recursive:true});await writeFile(path.join(mail.rawRoot,id,'attachment.bin'),bytes);
 assert.equal(mail.credentials,undefined);await mail.readAttachments();
 assert.equal(mail.store.get('mail:'+id).attachmentState,'complete');assert.equal((await mail.read(id)).mail.attachments[0].text,'한글 첨부 본문');
 // The Windows-only regression was in cache consumption, not in the parser.
 attachment.filename='letter.docx';const descriptor=Object.getOwnPropertyDescriptor(process,'platform');
 try{Object.defineProperty(process,'platform',{value:'win32'});const result=await mail.read(id);assert.equal(result.mail.attachments[0].contentState,'document_read');assert.equal(result.mail.attachments[0].text,'한글 첨부 본문');}
 finally{Object.defineProperty(process,'platform',descriptor);}
});

test('agent reads pending attachments once, retains failures and emits image receipt metadata without image bytes',async()=>{
 const source={id:'a'.repeat(64),sourceHash:'source',mail:{subject:'첨부',text:'본문',attachments:[{id:'image',filename:'receipt.png',sha256:'image-hash'},{id:'cached',text:'saved',contentState:'document_read',sha256:'cached-hash'},{id:'bad',filename:'locked.docx',sha256:'bad-hash'}]}},calls=[];
 const service={mailDocument:async args=>{calls.push(args);if(args.attachmentId==='bad')throw Error('document_password');return {text:'영수증 120,000원',image:'data:image/png;base64,PRIVATE',segments:[],coverage:'이미지 내용'};}};
 const result=await readMailAttachmentsForAgent(service,source,[],new AbortController().signal);
 assert.deepEqual(calls.map(item=>item.attachmentId),['image','bad']);assert.equal(result.mail.attachments[0].reader,'vision_model');assert.equal(result.mail.attachments[2].error,'document_password');assert(!JSON.stringify(result).includes('PRIVATE'));
 const sources=new AnswerSources().mail(result);assert.equal(sources.find(item=>item.attachmentId==='image').preview,'image');assert(!sources.some(item=>item.attachmentId==='bad'));
 calls.length=0;await readMailAttachmentsForAgent(service,source,[{attachmentId:'cached'}]);assert.equal(calls.length,0);
 await assert.rejects(readMailAttachmentsForAgent(service,source,[],AbortSignal.abort()),/cancelled/);
 service.mailDocument=async()=>{throw Error('mail_source_changed');};await assert.rejects(readMailAttachmentsForAgent(service,source),/mail_source_changed/);
});
