import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,chmod,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as office from '../runtime/office-document.mjs';
import {mailAttention} from '../runtime/mail-attention.mjs';
import {mailAttentionRowInfo} from '../ui/mail-attention-state.mjs';
const diagnostic={stage:'open',app:'word',officeVersion:'16.0',hresult:'0x8001010A',cleanupFailed:true};
test('Office rejection retains safe failure stage and HRESULT instead of losing them in a generic message',()=>{
 assert.throws(()=>office.parseOfficeDocumentResponse(JSON.stringify({error:'document_office_read_failed',diagnostic:{...diagnostic,path:'PRIVATE_PATH',message:'PRIVATE_BODY'}}),0),error=>{
  assert.equal(error.message,'document_office_busy');assert.deepEqual(error.officeDiagnostic,diagnostic);assert.doesNotMatch(JSON.stringify(error),/PRIVATE/);return true;
 });
 assert.throws(()=>office.parseOfficeDocumentResponse('{"error":"document_office_read_failed","diagnostic":{"stage":"open","hresult":"0x800A1436"}}',0),error=>error.message==='document_office_read_failed'&&error.officeDiagnostic.hresult==='0x800A1436');
});
test('malformed native output and invented diagnostic fields never become a diagnosis',()=>{
 assert.throws(()=>office.parseOfficeDocumentResponse('bad',1),error=>error.message==='document_office_read_failed'&&!error.officeDiagnostic);
 assert.throws(()=>office.parseOfficeDocumentResponse(JSON.stringify({error:'arbitrary PRIVATE',diagnostic:{stage:'PRIVATE',app:'PRIVATE',officeVersion:'PRIVATE',hresult:'PRIVATE'}}),1),error=>error.message==='document_office_read_failed'&&!error.officeDiagnostic);
});
test('attention projection preserves safe Office facts and explains manual recovery without automatic replay',()=>{
 const page=mailAttention([{id:'one',account:'owner',state:'saved',attachmentState:'attention',attachmentFailures:[{filename:'계약.docx',error:'document_office_busy',officeDiagnostic:{...diagnostic,message:'PRIVATE'}}]}],{account:'owner'});
 assert.deepEqual(page.items[0].attachmentFailures[0].officeDiagnostic,diagnostic);
 const info=mailAttentionRowInfo(page.items[0]);assert.match(info.detail,/파일 열기/);assert.match(info.detail,/0x8001010A/);assert.match(info.detail,/Office.*확인/);assert.match(info.detail,/사본/);assert.doesNotMatch(info.detail,/PRIVATE/);
 assert.equal(info.action,'retry');
});
test('Office timeout details retain the observed sheet, quantity and phase without inventing a policy diagnosis',()=>{
 const info=mailAttentionRowInfo({summary:false,error:'document_office_timeout',attachmentFailures:[{filename:'예산.xlsx',error:'document_office_timeout',officeDiagnostic:{app:'excel',stage:'read',unit:'cells',completed:1200,total:2400,sheetIndex:2,sheetCount:3,elapsedMs:90000,timeoutKind:'idle',message:'PRIVATE'}}]});
 assert.match(info.detail,/현재 시트 2\/3.*1,200\/2,400셀/);assert.match(info.detail,/90초/);assert.match(info.detail,/진행을 확인하지 못해/);assert.doesNotMatch(info.detail,/PRIVATE|정책/);
});
test('copy cleanup failure preserves the original Office error',{skip:process.platform==='win32'?'POSIX permission fixture; Windows ACL needs native verification':false},async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-office-cleanup-'));t.after(async()=>{await chmod(path.join(root,'parent'),0o700).catch(()=>{});await rm(root,{recursive:true,force:true});});
 const parent=path.join(root,'parent'),copy=path.join(parent,'copy');await mkdir(copy,{recursive:true});await writeFile(path.join(copy,'source.docx'),'source');await chmod(parent,0o500);
 const error=Object.assign(Error('document_office_read_failed'),{officeDiagnostic:{stage:'open',app:'word',hresult:'0x800A1436'}});
 assert.equal(typeof office.cleanupOfficeCopy,'function');await office.cleanupOfficeCopy(copy,error);
 assert.equal(error.message,'document_office_read_failed');assert.equal(error.officeDiagnostic.hresult,'0x800A1436');assert.equal(error.officeDiagnostic.cleanupFailed,true);
 await assert.rejects(office.cleanupOfficeCopy(copy),error=>error.message==='document_office_cleanup'&&error.officeDiagnostic.cleanupFailed===true);
});
test('background Office diagnostics survive storage and retry rereads only the failed attachment',async t=>{
 const {PersonalMail}=await import('./helpers-personal-mail.mjs');const {createHash}=await import('node:crypto');
 const sha=bytes=>createHash('sha256').update(bytes).digest('hex');const root=await mkdtemp(path.join(os.tmpdir(),'nubi-office-mail-'));
 const host={storageRoot:path.join(root,'state')},options={personalRoot:path.join(root,'mail')};let mail=new PersonalMail(host,options);
 t.after(async()=>{mail.dispose();await Promise.all([mail.rawDisposed,mail.wikiDisposed]);await rm(root,{recursive:true,force:true});});
 const id='a'.repeat(64),bytes=Buffer.from('protected fixture'),part={id:'000-'+sha(bytes).slice(0,16),filename:'계약.docx',sha256:sha(bytes)},cached={id:'cached',filename:'읽은 문서.txt',sha256:'cached-hash'};
 const row={id,protocol:'local',account:'local-folder',state:'saved',path:'wiki/preserved.md',sourceHash:'source',attachmentState:'queued'};
 mail.store.set('mail:'+id,row);mail.store.set('attachment:'+id+':cached',{state:'complete',sourceHash:'source',sha256:cached.sha256,text:'already read'});
 await mkdir(path.join(mail.rawRoot,id),{recursive:true});await writeFile(path.join(mail.rawRoot,id,part.id+'.bin'),bytes);
 const source=async()=>({text:'본문',attachments:[cached,part]});mail.source=source;mail.autoWiki=true;mail.drain=async()=>{};
 let attempts=0;mail.extractAttachment=async()=>{attempts++;throw Object.assign(Error('document_office_busy'),{officeDiagnostic:{...diagnostic,message:'PRIVATE'}});};
 await mail.readAttachments();assert.equal(attempts,1);assert.equal(mail.rows()[0].attachmentState,'attention');assert.equal(mail.rows()[0].path,'wiki/preserved.md');
 assert.deepEqual(mail.attention().items[0].attachmentFailures[0].officeDiagnostic,diagnostic);
 mail.dispose();mail=new PersonalMail(host,options);mail.source=source;mail.autoWiki=true;mail.drain=async()=>{};
 assert.deepEqual((await mail.read(id)).mail.attachments.find(item=>item.id===part.id).officeDiagnostic,diagnostic);
 let observedProgress=false;
 mail.extractAttachment=async(_bytes,_part,_signal,_directory,{onOfficeProgress})=>{attempts++;onOfficeProgress({stage:'read',app:'word',unit:'characters',completed:20,total:100,elapsedMs:80000,message:'PRIVATE'});const state=mail.status({includeMessages:false});assert.equal(state.progress.attachment.current.office.completed,20);assert.equal(state.progress.attachment.current.filename,part.filename);assert.doesNotMatch(JSON.stringify(state.progress.attachment),/PRIVATE/);observedProgress=true;return {text:'이번에 읽은 본문',segments:[],coverage:'fixture read'};};
 await mail.call({action:'retry',id});await mail.readAttachments();const until=Date.now()+2000;while(mail.attachmentRead&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(attempts,2,JSON.stringify(mail.rows()[0]));assert.equal(mail.rows()[0].attachmentState,'complete');assert.deepEqual(mail.rows()[0].attachmentFailures,[]);
 assert.equal(mail.store.get('attachment:'+id+':cached').text,'already read');assert.equal(mail.rows()[0].path,'wiki/preserved.md');
 assert.equal(observedProgress,true);assert.equal(mail.status({includeMessages:false}).progress.attachment,null);
});
