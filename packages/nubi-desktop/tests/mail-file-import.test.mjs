import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,realpath,truncate} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {PersonalMail} from '../runtime/mail.mjs';
import {scanMailFolder,readMailImportFile} from '../runtime/mail-file-import.mjs';
import {mailFileKind} from '../runtime/mail-file-kinds.mjs';
import {normalizePortalMail} from '../runtime/mail-portal-content.mjs';
const eml=body=>Buffer.from('Subject: Archive evidence\r\nFrom: Alice <alice@example.test>\r\nTo: owner@example.test\r\nCc: team@example.test\r\nDate: Tue, 13 Oct 2026 09:00:00 +0900\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n'+body);
const mhtml=Buffer.from('MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=b; type="text/html"\r\n\r\n--b\r\nContent-Type: text/html; charset=utf-8\r\nContent-Location: https://example.test/page\r\n\r\n<html><body><table><tr><td>기안 근거 MHTML</td></tr></table><img src="https://example.invalid/tracker"></body></html>\r\n--b--\r\n');
async function fixture(t,providers){const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-mail-import-'))),input=path.join(root,'source');await mkdir(input);let mail=new PersonalMail({storageRoot:path.join(root,'state'),providers},{personalRoot:path.join(root,'personal'),pull:()=>assert.fail('no network mail collection')});t.after(async()=>{mail.importController?.abort();await mail.importTask;mail.dispose();await rm(root,{recursive:true,force:true});});return {root,input,mail};}
async function put(root,name,bytes){const file=path.join(root,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,bytes);return file;}
async function waitFor(check){for(let n=0;n<500;n++){if(check())return;await new Promise(resolve=>setTimeout(resolve,20));}assert.fail('mail processing did not settle');}
test('recurses through nested and hidden folders; closest AUTO folder classifies each document',async t=>{
 const {input}=await fixture(t);
 for(const folder of ['AUTO_INBOX','AUTO_OUTBOX','AUTO_NOTICE','AUTO_PROCESSED','AUTO_SUBMITTED'])await put(input,folder+'/2026/.archive/nested/one.MYSINGLE',eml(folder));
 await put(input,'AUTO_INBOX/AUTO_OUTBOX/nested/two.eml',eml('nested override'));
 await put(input,'unknown/one.mht',mhtml);
 const result=await scanMailFolder(input);assert.equal(result.files.length,7);
 assert.deepEqual(result.files.map(row=>row.kind).sort(),['inbox','notice','other','processed','sent','sent','submitted']);
 assert.equal(mailFileKind('C:\\export\\AUTO_INBOX\\2026\\message.eml'),'inbox');
 const direct=await scanMailFolder(path.join(input,'AUTO_NOTICE'));assert.equal(direct.files[0].kind,'notice');
});
test('imports MIME, MHTML and mysingle, preserves source bytes, classifies searches, deduplicates and resumes after restart',async t=>{
 const {root,input,mail}=await fixture(t);await mail.call({action:'setAutoWiki',enabled:false});
 const single=Buffer.concat([Buffer.from('X-DESTTOP-MSG-UNIQUEID: desktop-fixture\r\nX-MsgFlags: 0-UNSEEN\r\n'),eml('결재 본문과 근거')]);
 await put(input,'AUTO_INBOX/nested/received.eml',eml('수신 본문'));
 await put(input,'AUTO_INBOX/copy.EML',eml('수신 본문'));
 await put(input,'AUTO_OUTBOX/sent.eml',eml('발신 본문'));
 await put(input,'AUTO_NOTICE/review.mysingle',single);
 await put(input,'AUTO_PROCESSED/approved.mysingle',single);
 await put(input,'AUTO_SUBMITTED/submission.mhtml',mhtml);
 await put(input,'AUTO_INBOX/protected.mysingle',Buffer.from('<## NASCA DRM FILE fixture'));
 await put(input,'AUTO_INBOX/invalid.eml',Buffer.from('invalid archive'));
 await put(input,'AUTO_INBOX/empty.eml',Buffer.from('Subject: Empty\r\n\r\n'));
 await mail.startFolderImport(input);await mail.importTask;
 const status=mail.status();assert.equal(status.connected,false);assert.equal(status.localImport.state,'completed');assert.equal(status.localImport.imported,5);assert.equal(status.localImport.duplicates,1);assert.equal(status.localImport.failures.length,3);
 assert.equal(mail.rows().length,5);assert(mail.rows().every(row=>row.state==='queued'));
 assert.deepEqual(new Set(status.localKinds),new Set(['inbox','sent','notice','processed','submitted']));
 for(const kind of status.localKinds)assert.equal((await mail.call({action:'search',query:'',filters:{mailbox:'local:'+kind}})).total,1);
 assert.equal((await mail.call({action:'search',query:'',filters:{mailbox:'mail'}})).total,2);
 const row=mail.rows().find(row=>row.mailbox==='notice'),source=await mail.read(row.id,{includePresentation:true});
 assert.equal(source.mail.desktopMessage.uniqueId,'desktop-fixture');assert.equal(source.mail.desktopMessage.flags,'0-UNSEEN');assert.equal(source.mail.sourceType,'approval');assert.equal(source.mail.documentKindLabel,'결재 문서');assert.equal(source.mail.cc,'team@example.test');assert.match(source.mail.text,/결재 본문/);
 assert.deepEqual(await readFile(path.join(mail.root,'raw',row.id,'message.eml')),single);
 const original=await mail.download({id:row.id,kind:'raw',expectedSourceHash:row.sourceHash});assert.equal(original.filename,'review.mysingle');assert.deepEqual(Buffer.from(original.bytes,'base64'),single);
 const web=await mail.read(mail.rows().find(row=>row.mailbox==='submitted').id,{includePresentation:true});assert.match(web.mail.text,/기안 근거 MHTML/);assert.deepEqual(web.mail.presentation.images,[]);assert.equal(web.mail.subject,'submission.mhtml');
 await mail.startFolderImport(input);await mail.importTask;assert.equal(mail.status().localImport.imported,0);assert.equal(mail.status().localImport.duplicates,6);
 mail.dispose();const restored=new PersonalMail({storageRoot:path.join(root,'state')},{personalRoot:path.join(root,'personal')});assert.equal(restored.rows().length,5);assert.equal(restored.status().localImport.duplicates,6);assert.equal((await restored.call({action:'search',query:'결재',filters:{mailbox:'local:processed'}})).total,1);restored.dispose();
});
test('uses the Personal OpenWiki synthesizer without a portal login and records folder classification, not approval execution',async t=>{
 const calls=[],providers={catalogs:()=>[{provider:'chatgpt',models:[{id:'fixture'}]}],status:()=>({connected:true,provider:'chatgpt',model:'fixture'}),complete:async messages=>{calls.push(messages);return {content:JSON.stringify({summary:'보관된 결재 문서입니다.',category:'approval',priority:'medium',facts:['문서에 검토 내용이 있다.'],actionItems:[]})};}};
 const {input,mail}=await fixture(t,providers);await put(input,'AUTO_PROCESSED/approved.mysingle',eml('검토 내용'));
 await mail.startFolderImport(input);await mail.importTask;await waitFor(()=>mail.rows()[0]?.state==='saved');
 assert.equal(calls.length,1);assert.match(calls[0][0].content,/folder_name/);assert.equal(JSON.parse(calls[0][1].content).documentKind,'processed');
 const row=mail.rows()[0],wiki=await readFile(row.path,'utf8');assert.match(wiki,/승인한 결재 \(폴더명 기준\)/);assert.match(wiki,new RegExp(row.sourceHash));
 assert.equal((await mail.read(row.id,{includeKnowledge:true})).knowledge.state,'current');assert.equal(mail.status().connected,false);
});
test('local folder ingestion preserves a connected portal account and dedupe receipts',async t=>{
 const {input,mail}=await fixture(t);await mail.call({action:'setAutoWiki',enabled:false});await mail.call({action:'portalConnect',identity:'fixture',folders:[]});const account=mail.account;
 await put(input,'AUTO_INBOX/one.eml',eml('local'));await mail.startFolderImport(input);await mail.importTask;
 assert.equal(mail.account,account);assert.equal(mail.status().connected,true);assert.deepEqual((await mail.call({action:'portalKnown'})).uids,[]);assert.equal(mail.rows()[0].protocol,'local');
});
test('raw CP949 display headers and MIME-encoded Korean retain readable text',async()=>{
 const raw=Buffer.concat([Buffer.from('Subject: '),Buffer.from([0xbe,0xc8,0xb3,0xe7]),Buffer.from('\r\nFrom: '),Buffer.from([0xbe,0xc8,0xb3,0xe7]),Buffer.from(' <alice@example.test>\r\nContent-Type: text/plain; charset=euc-kr\r\n\r\n'),Buffer.from([0xbe,0xc8,0xb3,0xe7])]);
 const parsed=await normalizePortalMail(raw,{filename:'one.mysingle'});assert.equal(parsed.normalized.subject,'안녕');assert.match(parsed.normalized.from,/안녕/);assert.equal(parsed.normalized.text,'안녕');assert.deepEqual(parsed.raw,raw);
});
test('never follows directory links, rejects oversized files, and cancellation stops collection',async t=>{
 const {root,input,mail}=await fixture(t);await put(input,'AUTO_INBOX/one.eml',eml('one'));await put(input,'large.eml',Buffer.alloc(1024));await truncate(path.join(input,'large.eml'),2*1024*1024*1024+1);/* sparse: only files above the 2 GiB hard limit are refused (2026-10-14); larger-than-50 MiB files are read up to their first 24 MiB */
 const outside=path.join(root,'outside');await mkdir(outside);await put(outside,'secret.eml',eml('outside'));
 await symlink(outside,path.join(input,'linked'),'junction');const scanned=await scanMailFolder(input);assert.equal(scanned.files.length,1);assert.deepEqual(new Set(scanned.failures.map(row=>row.error)),new Set(['mail_import_link','mail_size_limit']));
 const controller=new AbortController();controller.abort();await assert.rejects(readMailImportFile(scanned.root,scanned.files[0],controller.signal),/mail_cancelled/);
 await mail.startFolderImport(input);await mail.call({action:'cancelImport'});await mail.importTask;assert.equal(mail.status().localImport.state,'cancelled');assert.equal(mail.rows().length,0);
});
