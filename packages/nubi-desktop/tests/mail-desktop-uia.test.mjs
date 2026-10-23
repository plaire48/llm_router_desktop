import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir,mkdir} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {PersonalMail} from './helpers-personal-mail.mjs';
import {uiaMailCapture,readKnoxMailUia} from '../runtime/mail-desktop-uia.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const binding={processId:10,hwnd:20,started:'123456',processName:'mySingleDesktopMessage'};
const profile={id:sha(JSON.stringify(binding)),label:'Knox Desktop Message',binding};
const snapshot=(extra={})=>({version:1,binding,capturedAt:'2026-10-23T03:00:00.000Z',nodes:[
 {key:'root',parent:null,type:'Window',name:'Knox Desktop Message'},
 {key:'subject',parent:'root',type:'Text',name:'제목: UIA 메일 검증'},
 {key:'from',parent:'root',type:'Text',name:'보낸 사람: Sender <sender@example.test>'},
 {key:'to',parent:'root',type:'Text',name:'받는 사람: owner@example.test'},
 {key:'date',parent:'root',type:'Text',name:'날짜: 2026-10-23 12:00'},
 {key:'body',parent:'root',type:'Document',name:'본문',automationId:'observed-body',text:'UIA-ORIGINAL-ONLY-998877\n공유 UIA 구조로 읽은 본문',readOnly:true},
 {key:'secret',parent:'root',type:'Edit',name:'password',value:'MUST-NOT-BE-READ',isPassword:true}
 ],...extra});
async function fixture(t,{read,timeoutMs}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-mail-uia-'));let calls=0;
 const options={personalRoot:path.join(root,'personal'),desktopSource:{read:read|| (async request=>{calls++;return request.action==='discover'?{supported:true,profiles:[profile]}:snapshot();}),timeoutMs}};
 const host={storageRoot:path.join(root,'state')};let mail=new PersonalMail(host,options);clearInterval(mail.processingTimer);mail.autoWiki=false;
 mail.startFolderImport=()=>assert.fail('Desktop UIA must never scan or parse Knox files');
 t.after(async()=>{mail.dispose();await Promise.all([mail.rawDisposed,mail.wikiDisposed]);await rm(root,{recursive:true,force:true});});
 return {root,get calls(){return calls;},get mail(){return mail;},async restart(){mail.dispose();await Promise.all([mail.rawDisposed,mail.wikiDisposed]);mail=new PersonalMail(host,options);clearInterval(mail.processingTimer);return mail;}};
}
async function settled(mail){for(let i=0;i<200;i++){if(!mail.desktopSource.running&&!mail.desktopSource.connecting)return;await new Promise(r=>setTimeout(r,5));}assert.fail('UIA source did not settle');}
test('UIA normalizer reads observed headers and body, refuses ambiguity and excludes editable/password nodes',()=>{
 const capture=uiaMailCapture(snapshot());assert.equal(capture.normalized.subject,'UIA 메일 검증');assert.match(capture.normalized.text,/UIA-ORIGINAL/);assert.equal(capture.normalized.storage.mode,'desktop_uia');assert.equal(capture.normalized.coverage.completeMailbox,false);assert(!capture.raw.toString().includes('MUST-NOT-BE-READ'));
 assert.throws(()=>uiaMailCapture(snapshot({nodes:[...snapshot().nodes,{key:'body2',parent:'root',type:'Document',name:'다른 본문',text:'다른 내용',readOnly:true}]})),/mail_desktop_uia_ambiguous/);
 assert.throws(()=>uiaMailCapture(snapshot({nodes:snapshot().nodes.map(n=>n.key==='body'?{...n,readOnly:false}:n)})),/mail_desktop_uia_body/);
 assert.throws(()=>uiaMailCapture(snapshot({truncated:true})),/mail_desktop_uia_limit/);
 const nested=snapshot({nodes:snapshot().nodes.map(n=>n.key==='root'?{...n,type:'Document',automationId:'RootWebArea',text:'전체 문서'}:n)});assert.match(uiaMailCapture(nested).normalized.text,/UIA-ORIGINAL/);
 const quoted=snapshot({nodes:[...snapshot().nodes,{key:'quoted-subject',parent:'body',type:'Text',name:'Subject: another subject'},{key:'quoted-from',parent:'body',type:'Text',name:'From: quoted@example.test'}]});assert.equal(uiaMailCapture(quoted).normalized.subject,'UIA 메일 검증');assert.equal(uiaMailCapture(quoted).mailbox,'other');
 const privateTree=snapshot({nodes:[...nested.nodes,{key:'sidebar',parent:'root',type:'Text',name:'UNRELATED-SIDEBAR-DATA'}]});const original=uiaMailCapture(privateTree).raw.toString();assert(!original.includes('UNRELATED-SIDEBAR-DATA'));assert(!original.includes('전체 문서'));assert.match(uiaMailCapture(JSON.parse(original)).normalized.text,/UIA-ORIGINAL/);
 assert.throws(()=>uiaMailCapture(snapshot({nodes:snapshot().nodes.map(node=>node.key==='subject'?{...node,name:'Subject:'}:node)})),/mail_desktop_uia_body/);
 const separateTo=snapshot({nodes:snapshot().nodes.flatMap(node=>node.key==='to'?[{...node,name:'To:'},{key:'to-value',parent:'root',type:'Text',name:'Tommy <tom@example.test>'}]:[node])});assert.equal(uiaMailCapture(separateTo).normalized.to,'Tommy <tom@example.test>');
 assert.throws(()=>uiaMailCapture(snapshot({nodes:[...snapshot().nodes,{key:'orphan',parent:'missing',type:'Text',name:'Subject: invalid'}]})),/mail_desktop_uia_body/);
});
test('default Desktop connection uses UIA, stores encrypted original JSON, reads and exports it after restart',async t=>{
 const f=await fixture(t);await f.mail.call({action:'desktopConnect'});await settled(f.mail);assert.equal(f.mail.desktopSource.error,null);assert.equal(f.mail.desktopSource.snapshot().transport,'uia');assert.equal(f.mail.rows().length,1);
 const row=f.mail.rows()[0];assert.equal(row.sourceStorage,'desktop_uia');const files=await readdir(path.join(f.mail.rawRoot,row.id));assert(files.includes('uia.json.enc'));assert(!files.some(file=>file.startsWith('message.eml')));
 const bytes=await readFile(path.join(f.mail.rawRoot,row.id,'uia.json.enc'));assert(!bytes.includes(Buffer.from('UIA-ORIGINAL')));assert(!JSON.stringify(f.mail.store.entries('')).includes('UIA-ORIGINAL'));
 const value=await f.mail.read(row.id,{includePresentation:true});assert.match(value.mail.text,/UIA-ORIGINAL/);assert.equal(value.mail.coverage.completeMailbox,false);
 const download=await f.mail.download({id:row.id,expectedSourceHash:row.sourceHash,kind:'raw'});assert.match(download.filename,/-uia\.json$/);const raw=Buffer.from(download.bytes,'base64');assert.equal(sha(raw),row.sourceHash);assert.equal(JSON.parse(raw).nodes.find(n=>n.key==='body').text,value.mail.text);
 const body=await f.mail.download({id:row.id,expectedSourceHash:row.sourceHash,kind:'body'});assert.match(Buffer.from(body.bytes,'base64').toString(),/UIA-ORIGINAL/);
 await f.restart();assert.match((await f.mail.read(row.id)).mail.text,/UIA-ORIGINAL/);assert.equal(f.mail.desktopSource.intervalMs,300000);
});
test('repeat observations do not duplicate an unchanged body; changed bodies keep separate original versions',async t=>{
 let version=0;const f=await fixture(t,{read:async request=>request.action==='discover'?{supported:true,profiles:[profile]}:snapshot({capturedAt:new Date().toISOString(),nodes:snapshot().nodes.map(n=>n.key==='body'?{...n,text:n.text+(version?' changed':'')}:n)})});
 await f.mail.call({action:'desktopConnect'});await settled(f.mail);const first=f.mail.rows()[0];await f.mail.desktopSource.sync({manual:true});assert.equal(f.mail.rows().length,1);version++;await f.mail.desktopSource.sync({manual:true});assert.equal(f.mail.rows().length,2);assert.equal(f.mail.store.get('mail:'+first.id).sourceHash,first.sourceHash);
});
test('a former file connection never resumes filesystem scanning as the UIA source',async t=>{
 const f=await fixture(t);f.mail.desktopSource.persist({mode:'desktop',enabled:true,transport:'files',root:'C:\\mySingle'});assert.equal(f.mail.desktopSource.enabled,false);f.mail.desktopSource.wake();assert.equal(f.calls,0);
});
test('a changed process binding is rejected without importing or switching windows',async t=>{
 const f=await fixture(t,{read:async request=>request.action==='discover'?{supported:true,profiles:[profile]}:snapshot({binding:{...binding,processId:11}})});
 await f.mail.call({action:'desktopConnect'});await settled(f.mail);assert.equal(f.mail.rows().length,0);assert.equal(f.mail.desktopSource.error,'mail_desktop_source_changed');assert.equal(f.mail.desktopSource.snapshot().lastCheckedAt,null);
});
test('cancellation ignores a late UIA result and preserves existing records',async t=>{
 let release;const f=await fixture(t,{read:async request=>request.action==='discover'?{supported:true,profiles:[profile]}:new Promise(r=>{release=r;})});
 await f.mail.call({action:'desktopConnect'});while(!release)await new Promise(r=>setTimeout(r,2));await f.mail.call({action:'disconnect'});release(snapshot());await settled(f.mail);assert.equal(f.mail.rows().length,0);assert.equal(f.mail.desktopSource.enabled,false);
});
test('UIA original follows managed storage relocation and remains hash verifiable',async t=>{
 const f=await fixture(t);await f.mail.call({action:'desktopConnect'});await settled(f.mail);const row=f.mail.rows()[0],old=f.mail.rawRoot,target=path.join(f.root,'new-location');await mkdir(target);await f.mail.relocateRaw(target,{includeAttachments:false});assert.notEqual(f.mail.rawRoot,old);assert.match((await f.mail.read(row.id)).mail.text,/UIA-ORIGINAL/);assert.equal(sha(await f.mail.sourceBytes(row)),row.sourceHash);
});
test('non-Windows UIA fails explicitly without loading a mail file',async()=>{
 await assert.rejects(readKnoxMailUia({action:'discover'},{platform:'darwin'}),/mail_desktop_windows/);
});
test('multiple Desktop windows require an explicit exact selection',async t=>{
 const secondBinding={...binding,hwnd:21},second={id:sha(JSON.stringify(secondBinding)),label:'Second mail window',binding:secondBinding};let snapshots=0;
 const f=await fixture(t,{read:async request=>{if(request.action==='discover')return {supported:true,profiles:[profile,second]};snapshots++;assert.deepEqual(request.binding,secondBinding);return snapshot({binding:secondBinding});}});
 await f.mail.call({action:'desktopConnect'});assert.equal(f.mail.desktopSource.snapshot().requiresSelection,true);assert.equal(snapshots,0);assert.equal(f.mail.rows().length,0);
 await assert.rejects(f.mail.call({action:'desktopConnect',profileId:'forged-window'}),/mail_desktop_source_changed/);assert.equal(snapshots,0);
 await f.mail.call({action:'desktopConnect',profileId:second.id});await settled(f.mail);assert.equal(f.mail.rows().length,1);assert.equal(snapshots,1);
});
test('a stalled UIA provider times out without a checkpoint and late data is ignored',async t=>{
 let release;const f=await fixture(t,{timeoutMs:30,read:async request=>request.action==='discover'?{supported:true,profiles:[profile]}:new Promise(resolve=>{release=resolve;})});
 await f.mail.call({action:'desktopConnect'});await settled(f.mail);assert.equal(f.mail.desktopSource.error,'mail_desktop_timeout');assert.equal(f.mail.desktopSource.snapshot().lastCheckedAt,null);release(snapshot());await new Promise(resolve=>setTimeout(resolve,10));assert.equal(f.mail.rows().length,0);
});
test('auto OFF schedules no UIA scan while a manual read remains available',async t=>{
 const f=await fixture(t);await f.mail.call({action:'desktopConnect'});await settled(f.mail);const before=f.calls;
 f.mail.desktopSource.schedule();assert.equal(f.mail.desktopSource.snapshot().nextCheckAt,null);await f.mail.desktopSource.sync();assert.equal(f.calls,before);
 await f.mail.desktopSource.sync({manual:true});assert.equal(f.calls,before+1);assert.equal(f.mail.rows().length,1);
});
test('encrypted-original persistence failure never advances the successful-read checkpoint',async t=>{
 const f=await fixture(t);f.mail.intake=async()=>{throw Error('mail_encryption_unavailable');};await f.mail.call({action:'desktopConnect'});await settled(f.mail);
 assert.equal(f.mail.rows().length,0);assert.equal(f.mail.desktopSource.error,'mail_encryption_unavailable');assert.equal(f.mail.desktopSource.snapshot().lastCheckedAt,null);assert.equal(f.mail.watchPaused,true);
});
test('encrypted UIA originals reject ciphertext changes before read or raw export',async t=>{
 const f=await fixture(t);await f.mail.call({action:'desktopConnect'});await settled(f.mail);const row=f.mail.rows()[0],file=path.join(f.mail.rawRoot,row.id,'uia.json.enc');const bytes=await readFile(file);bytes[bytes.length-1]^=1;await (await import('node:fs/promises')).writeFile(file,bytes);
 await assert.rejects(f.mail.sourceBytes(row),/mail_encryption_integrity/);await assert.rejects(f.mail.download({id:row.id,expectedSourceHash:row.sourceHash,kind:'raw'}),/mail_encryption_integrity/);
});
test('storage relocation is refused while the selected UIA window is being read',async t=>{
 let release;const f=await fixture(t,{read:async request=>request.action==='discover'?{supported:true,profiles:[profile]}:new Promise(resolve=>{release=resolve;})});await f.mail.call({action:'desktopConnect'});while(!release)await new Promise(resolve=>setTimeout(resolve,2));
 const target=path.join(f.root,'concurrent-move');await mkdir(target);try{await assert.rejects(f.mail.relocateRaw(target),/mail_busy/);}finally{release(snapshot());await settled(f.mail);}
});
test('pause during encrypted original writing prevents commit and allows a later manual retry',async t=>{
 const f=await fixture(t),write=f.mail.rawVault.write.bind(f.mail.rawVault);let release,intercepted=false;
 f.mail.rawVault.write=async(file,...args)=>{if(path.basename(file)==='manifest.json'&&!intercepted){intercepted=true;await new Promise(resolve=>{release=resolve;});}return write(file,...args);};
 await f.mail.call({action:'desktopConnect'});while(!release)await new Promise(resolve=>setTimeout(resolve,2));await f.mail.call({action:'pauseWatch'});release();await settled(f.mail);
 assert.equal(f.mail.rows().length,0);assert.equal(f.mail.desktopSource.snapshot().lastCheckedAt,null);assert.equal((await readdir(f.mail.rawRoot)).filter(file=>/^[a-f0-9]{64}$|\.pending$/.test(file)).length,0);
 await f.mail.desktopSource.sync({manual:true});assert.equal(f.mail.rows().length,1);
});
