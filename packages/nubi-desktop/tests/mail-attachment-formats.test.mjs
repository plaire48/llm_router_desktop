import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {extractDocument} from '../runtime/document-extract.mjs';
import {normalizePortalMail} from '../runtime/mail-portal-content.mjs';
import {parseOfficeDocumentResponse,officeDocumentFormat} from '../runtime/office-document.mjs';
import {mailAttentionInfo} from '../ui/mail-attention-state.mjs';
import {PersonalMail} from './helpers-personal-mail.mjs';

const calendar='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:meeting-1\r\nSUMMARY:출시 검토\r\nDTSTART;TZID=Asia/Seoul:20261016T140000\r\nDESCRIPTION:예산 검토\\n확인할 내용\\,\r\n 추가 자료\r\nEND:VEVENT\r\nEND:VCALENDAR';
const html='<html><body><h1>검토 결과</h1><p>승인 금액 120,000원</p></body></html>';
function eml({plain='This message contains HTML. Please view in an HTML reader.',filename='body.html',type='text/html',disposition='attachment'}={}){
 return Buffer.from(`Subject: Exported message\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${plain}\r\n--b\r\nContent-Type: ${type}; charset=utf-8\r\nContent-Disposition: ${disposition}; filename="${filename}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(html).toString('base64')}\r\n--b--\r\n`);
}
test('ICS is readable evidence with folded lines, escaped text and the original time zone',async()=>{
 for(const [filename,mime] of [['invite.ics','application/octet-stream'],['첨부파일','text/calendar']]){
  const result=await extractDocument(Buffer.from(calendar),filename,mime);
  assert.match(result.text,/일정: 출시 검토/);assert.match(result.text,/시작 \(TZID=Asia\/Seoul\): 20261016T140000/);assert.match(result.text,/설명: 예산 검토\n확인할 내용,추가 자료/);
 }
 await assert.rejects(extractDocument(Buffer.from('not a calendar'),'broken.ics'),/document_format/);
 assert.equal(officeDocumentFormat('invite.ics','application/msword'),null);
});
test('TXT and MD decode UTF-8, BOM UTF-16 and Korean legacy bytes; declared charset wins',async()=>{
 const text='# 검토\n본문입니다';
 for(const filename of ['memo.txt','memo.md']){
  for(const bytes of [Buffer.from(text),Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(text,'utf16le')])])assert.equal((await extractDocument(bytes,filename)).text,text);
  assert.equal((await extractDocument(Buffer.from([0xc7,0xd1,0xb1,0xdb]),filename)).text,'한글');
 }
 assert.equal((await extractDocument(Buffer.from([0xc7,0xd1,0xb1,0xdb]),'memo.txt','text/plain; charset=cp949')).text,'한글');
 assert.equal((await extractDocument(Buffer.from('# Markdown'),'첨부파일','text/markdown')).text,'# Markdown');
 assert.equal((await extractDocument(Buffer.from([0x63,0x61,0x66,0xe9]),'memo.txt','text/plain; charset=windows-1252')).text,'café');
 await assert.rejects(extractDocument(Buffer.from([0,1,2,3]),'binary.txt'),/document_read_failed/);
});
test('exported body HTML replaces fallback text, while genuine HTML attachments remain files',async()=>{
 for(const [type,filename] of [['text/html','body.html'],['application/octet-stream','body.html'],['application/octet-stream','첨부파일']]){
  const result=await normalizePortalMail(eml({type,filename}),{includePresentation:true});
  assert.match(result.normalized.text,/120,000원/);assert.equal(result.attachments[0].presentation,'body');assert.match(result.presentation.html,/검토 결과/);
 }
 const genuine=await normalizePortalMail(eml({plain:'Please review the attached HTML file.',filename:'report.html'}),{includePresentation:true});
 assert.equal(genuine.attachments[0].presentation,'attachment');assert.equal(genuine.normalized.text.trim(),'Please review the attached HTML file.');assert(!genuine.presentation.html?.includes('120,000'));
});
function withHtmlAttachment(raw,filename='report.html'){
 return Buffer.from(raw.toString().replace('--b--',`--b\r\nContent-Type: text/html; charset=utf-8\r\nContent-Disposition: attachment; filename="${filename}"\r\n\r\n<h1>Separate report</h1>\r\n--b--`));
}
test('exported HTML body recovers even alongside a genuine HTML file, with stable part IDs',async()=>{
 const single=await normalizePortalMail(eml()),result=await normalizePortalMail(withHtmlAttachment(eml()),{includePresentation:true});
 assert.equal(result.attachments[0].id,single.attachments[0].id);assert.equal(result.attachments[0].presentation,'body');assert.equal(result.attachments[1].presentation,'attachment');
 assert.match(result.presentation.html,/120,000원/);assert.match(result.normalized.text,/120,000원/);assert(!result.presentation.html.includes('Separate report'));assert(!result.normalized.text.includes('Separate report'));
});
test('empty text does not turn a genuine HTML file or ambiguous body files into the message',async()=>{
 const genuine=await normalizePortalMail(eml({plain:'',filename:'report.html'}),{includePresentation:true});
 assert.equal(genuine.attachments[0].presentation,'attachment');assert.equal(genuine.presentation.html,'');assert.equal(genuine.normalized.text,'');
 const ambiguous=await normalizePortalMail(withHtmlAttachment(eml(),'message.html'),{includePresentation:true});
 assert(ambiguous.attachments.every(part=>part.presentation==='attachment'));assert.equal(ambiguous.presentation.html,'');
});
test('exported CP949 body is decoded as Korean before HTML presentation and text extraction',async()=>{
 const bytes=Buffer.concat([Buffer.from('<html><body><p>'),Buffer.from([0xc7,0xd1,0xb1,0xdb]),Buffer.from('</p></body></html>')]);
 const raw=Buffer.from(eml().toString().replace('text/html; charset=utf-8','text/html; charset=cp949').replace(Buffer.from(html).toString('base64'),bytes.toString('base64')));
 const result=await normalizePortalMail(raw,{includePresentation:true});assert.match(result.presentation.html,/한글/);assert.match(result.normalized.text,/한글/);assert(!result.normalized.text.includes('\uFFFD'));
});
test('stored version 4 mail reclassifies body without fetching or altering receipt hashes',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mail-html-body-'));let mail=new PersonalMail({storageRoot:root},{personalRoot:path.join(root,'mail')});
 t.after(async()=>{mail.dispose();await mail.rawDisposed;await mail.wikiDisposed;await rm(root,{recursive:true,force:true});});mail.autoWiki=false;
 const parsed=await normalizePortalMail(withHtmlAttachment(eml()));parsed.normalized.contentVersion=4;parsed.normalized.text='This message contains HTML.';parsed.normalized.attachments=parsed.normalized.attachments.map(part=>({...part,presentation:'attachment'}));
 await mail.intake({mails:[{...parsed,uidl:'html-legacy',protocol:'local'}]},mail.generation,{collectOnly:true});const row=mail.rows()[0];
 mail.store.set('setting:attachment-reader-version',5);mail.store.set('mail:'+row.id,{...row,attachmentState:'attention',attachmentFailures:[{id:parsed.attachments[0].id,filename:'body.html',error:'document_format'}]});
 mail.dispose();await mail.rawDisposed;await mail.wikiDisposed;mail=new PersonalMail({storageRoot:root},{personalRoot:path.join(root,'mail')});mail.autoWiki=false;assert.equal(mail.rows()[0].attachmentState,'queued');
 const result=await mail.read(row.id,{includePresentation:true});assert.deepEqual(result.mail.attachments.map(part=>part.filename),['report.html']);assert.match(result.mail.text,/120,000원/);assert.match(result.mail.presentation.html,/120,000원/);assert.equal(result.sourceHash,row.sourceHash);assert.equal(mail.rows()[0].manifestHash,row.manifestHash);
});
test('Office protocol failures are not mislabeled as corporate policy and valid COM receipts survive',()=>{
 for(const stdout of ['', 'CLIXML or host failure', 'null', '{}'])assert.throws(()=>parseOfficeDocumentResponse(stdout,1),/document_office_read_failed/);
 assert.throws(()=>parseOfficeDocumentResponse('{"error":"document_office_policy"}',0),/document_office_policy/);
 assert.doesNotMatch(mailAttentionInfo('document_office_policy').title,/회사|정책/);
 const document={reader:'office_com',officeVersion:'16.0',text:'원문',coverage:'Word 본문',segments:[]};
 assert.deepEqual(parseOfficeDocumentResponse(JSON.stringify({document}),0),document);
 assert.throws(()=>parseOfficeDocumentResponse(JSON.stringify({document}),1),/document_office_read_failed/);
});
test('legacy HTML body attention clears once without refetching or changing original receipts',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mail-body-upgrade-'));let mail;
 t.after(async()=>{if(mail){mail.dispose();await mail.rawDisposed;await mail.wikiDisposed;}await rm(root,{recursive:true,force:true});});
 const options={personalRoot:path.join(root,'mail')};mail=new PersonalMail({storageRoot:root},options);mail.autoWiki=false;mail.store.set('setting:auto-wiki',false);
 const parsed=await normalizePortalMail(eml());parsed.normalized.contentVersion=3;parsed.normalized.text='This message contains HTML. Please view in an HTML reader.';parsed.normalized.attachments=parsed.normalized.attachments.map(part=>({...part,presentation:'attachment'}));
 await mail.intake({mails:[{...parsed,uidl:'fixture-1',protocol:'local'}]},mail.generation,{collectOnly:true});
 const row=mail.rows()[0],attachment=parsed.attachments[0];mail.store.set('mail:'+row.id,{...row,attachmentState:'attention',attachmentFailures:[{id:attachment.id,filename:attachment.filename,error:'document_format'}]});mail.store.set('setting:attachment-reader-version',4);
 mail.dispose();await mail.rawDisposed;await mail.wikiDisposed;
 mail=new PersonalMail({storageRoot:root},options);mail.drain=async()=>{};assert.equal(mail.rows()[0].attachmentState,'queued');
 const source=await mail.read(row.id);assert.equal(source.mail.attachments.length,0);assert.match(source.mail.text,/120,000원/);assert.equal(source.sourceHash,row.sourceHash);assert.equal(mail.rows()[0].manifestHash,row.manifestHash);
 mail.autoWiki=true;await mail.readAttachments();assert.equal(mail.rows()[0].attachmentState,'complete');assert.deepEqual(mail.rows()[0].attachmentFailures,[]);
 // A new unsupported file failure at the current version is not requeued on restart.
 mail.store.set('mail:'+row.id,{...mail.rows()[0],attachmentState:'attention',attachmentFailures:[{error:'document_format'}]});
 mail.dispose();await mail.rawDisposed;await mail.wikiDisposed;mail=new PersonalMail({storageRoot:root},options);assert.equal(mail.rows()[0].attachmentState,'attention');
});
test('background worker reads calendar and Korean text without Office or a connected AI',async()=>{
 const mail=Object.create(PersonalMail.prototype),signal=new AbortController().signal;
 const schedule=await mail.extractAttachment(Buffer.from(calendar),{filename:'invite.ics'},signal);assert.match(schedule.text,/출시 검토/);
 const note=await mail.extractAttachment(Buffer.from([0xc7,0xd1,0xb1,0xdb]),{filename:'memo.md'},signal);assert.equal(note.text,'한글');
 const declared=await mail.extractAttachment(Buffer.from([0x63,0x61,0x66,0xe9]),{filename:'memo.txt',contentType:'text/plain',charset:'windows-1252'},signal);assert.equal(declared.text,'café');
});
