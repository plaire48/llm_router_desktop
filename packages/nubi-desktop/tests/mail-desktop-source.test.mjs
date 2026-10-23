import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath,symlink,access,readdir,rename} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {desktopStoragePaths,discoverDesktopMail} from '../runtime/mail-desktop-source.mjs';
import {readDesktopMailReference} from '../runtime/mail-desktop-reference.mjs';
import MailComposer from 'nodemailer/lib/mail-composer';
import {PersonalMail} from './helpers-personal-mail.mjs';
const {mailSourceStatus}=createRequire(import.meta.url)('../electron-app/mail-source-status.cjs');
const eml=body=>Buffer.from('X-DESTTOP-MSG-UNIQUEID: desktop-id\r\nSubject: Knox archive\r\nFrom: sender@example.test\r\nTo: owner@example.test\r\nDate: Thu, 22 Oct 2026 09:00:00 +0900\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n'+body);
const sha=value=>createHash('sha256').update(value).digest('hex');
async function fixture(t){
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-desktop-mail-'))),storage=path.join(root,'DesktopMessage'),configFile=path.join(root,'DesktopMessageEnv.xml');await mkdir(storage);
 await writeFile(configFile,'<config><storage>'+storage+'</storage></config>');
 const discover=options=>discoverDesktopMail({platform:'win32',configFile,fallback:storage,...options});
 const host={storageRoot:path.join(root,'state')},options={personalRoot:path.join(root,'personal'),desktopSource:{discover},pull:()=>assert.fail('network collection must not run')};
 let mail=new PersonalMail(host,options);clearInterval(mail.processingTimer);await mail.call({action:'setAutoWiki',enabled:false});
 t.after(async()=>{mail.dispose();await mail.importTask;await Promise.all([mail.rawDisposed,mail.wikiDisposed]);await rm(root,{recursive:true,force:true});});
 return {root,storage,configFile,discover,get mail(){return mail;},async profile(name){const target=path.join(storage,name);await mkdir(target);await writeFile(path.join(target,'UserSavedBoxInfo.xml'),'<folders/>');return target;},async restart(){mail.dispose();await mail.importTask;await Promise.all([mail.rawDisposed,mail.wikiDisposed]);mail=new PersonalMail(host,options);clearInterval(mail.processingTimer);return mail;}};
}
async function put(root,name,body){const target=path.join(root,name);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,eml(body));return target;}
async function settle(mail){for(let n=0;n<500;n++){if(!mail.desktopSource.running&&!mail.importController)return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('desktop import did not finish');}
test('configuration parses entities, CDATA and multiple roots but refuses DTD and malformed XML',()=>{
 assert.deepEqual(desktopStoragePaths('<config><storage>C:\\mail &amp; docs</storage><storage><![CDATA[D:\\mail]]></storage></config>'),['C:\\mail & docs','D:\\mail']);
 assert.throws(()=>desktopStoragePaths('<!DOCTYPE a [<!ENTITY x "folder">]><a><storage>&x;</storage></a>'),/mail_desktop_config/);
 assert.throws(()=>desktopStoragePaths('<a><storage>x</a>'),/mail_desktop_config/);
});
test('discovers real profile markers, not other folders or links; supports UTF16 and Windows-only default',async t=>{
 const f=await fixture(t),one=await f.profile('P100_owner');await mkdir(path.join(f.storage,'not-mail'));await mkdir(path.join(f.storage,'INDEX'));
 await symlink(one,path.join(f.storage,'linked'),'junction');
 await writeFile(f.configFile,Buffer.from('\uFEFF<config><storage>'+f.storage+'</storage></config>','utf16le'));
 const found=await f.discover();assert.equal(found.profiles.length,1);assert.equal(found.profiles[0].root,one);assert.equal(found.profiles[0].id,sha(one));
 assert.deepEqual(await discoverDesktopMail({platform:'darwin',configFile:'/never/read/this'}),{supported:false,profiles:[],error:'mail_desktop_windows'});
 await rm(f.configFile);assert.equal((await f.discover()).profiles.length,1);
 await writeFile(f.configFile,'<a><storage>relative</storage></a>');await assert.rejects(f.discover(),/mail_desktop_config/);
});
test('incremental collection reuses receipts, excludes INDEX and never serves obsolete versions as current originals',async t=>{
 const f=await fixture(t),profile=await f.profile('P100_owner');
 const source=await put(profile,'AUTO_INBOX/one.mysingle','first original');await put(profile,'INDEX/skip.mysingle','index copy');await put(profile,'AUTO_INBOX/export.eml','not a desktop archive');
 await put(profile,'ML_T_TRASH/old.mysingle','trash');
 let reads=0;const parse=f.mail.parsePortal.bind(f.mail);f.mail.parsePortal=(...args)=>{reads++;return parse(...args);};
 await f.mail.call({action:'desktopConnect'});await settle(f.mail);
 assert.equal(f.mail.status().protocol,'desktop');assert.equal(f.mail.rows().length,2);assert.equal(reads,2);
 assert.equal(f.mail.rows().find(row=>row.mailbox==='trash').state,'collected');
 const row=f.mail.rows().find(row=>row.mailbox==='inbox'),first=await f.mail.read(row.id);assert.equal(first.mail.sourceApp,'knox_desktop');assert.equal(first.mail.desktopMessage.uniqueId,'desktop-id');assert.deepEqual(await readFile(source),eml('first original'));
 const beforeSync=reads;await f.mail.desktopSource.sync({manual:true});assert.equal(reads,beforeSync);assert.equal(f.mail.status().localImport.resumed,2);
 await writeFile(source,eml('changed original'));await put(profile,'AUTO_OUTBOX/two.mysingle','new sent message');
 await f.mail.desktopSource.sync({manual:true});assert.equal(reads,beforeSync+2);assert.equal(f.mail.rows().length,4);await assert.rejects(f.mail.read(row.id),/mail_source_changed/);
 await rm(source);await f.mail.desktopSource.sync({manual:true});assert.equal(f.mail.rows().length,4,'source deletion must not delete collected mail');
 await assert.rejects(f.mail.read(row.id),/mail_source_missing/);
 await f.restart();assert.equal(f.mail.status().desktop.connected,true);await f.mail.desktopSource.sync({manual:true});assert.equal(f.mail.rows().length,4);
 await f.mail.call({action:'disconnect'});assert.equal(f.mail.status().desktop.connected,false);assert.equal(f.mail.rows().length,4);
});
test('multiple accounts require exact selection, and a missing selected account never switches to another',async t=>{
 const f=await fixture(t),one=await f.profile('P100_owner'),two=await f.profile('P200_other');await put(one,'AUTO_INBOX/one.mysingle','selected');await put(two,'AUTO_INBOX/two.mysingle','not selected');
 await f.mail.call({action:'desktopConnect'});assert.equal(f.mail.status().desktop.requiresSelection,true);assert.equal(f.mail.rows().length,0);
 await assert.rejects(f.mail.call({action:'desktopConnect',profileId:'arbitrary-path'}),/mail_desktop_source_changed/);
 await f.mail.call({action:'desktopConnect',profileId:sha(one)});await settle(f.mail);assert.equal(f.mail.rows().length,1);
 await rm(one,{recursive:true});await f.mail.desktopSource.sync({manual:true});assert.equal(f.mail.rows().length,1);assert.equal(f.mail.status().desktop.error,'mail_desktop_source_changed');assert.equal(f.mail.status().desktop.profileId,sha(one));
});
test('stopping an active desktop import persists pause and resumes without rereading completed messages',async t=>{
 const f=await fixture(t),profile=await f.profile('P100_owner');for(let n=0;n<3;n++)await put(profile,'AUTO_INBOX/'+n+'.mysingle','message '+n);
 const parse=f.mail.parsePortal.bind(f.mail);let calls=0;
 f.mail.parsePortal=async(...args)=>{if(++calls===2){await f.mail.call({action:'cancelImport'});throw Error('mail_cancelled');}return parse(...args);};
 await f.mail.call({action:'desktopConnect'});await settle(f.mail);assert.equal(f.mail.rows().length,1);assert.equal(f.mail.watchPaused,true);assert.equal(f.mail.desktopSource.timer,null);
 await f.restart();assert.equal(f.mail.watchPaused,true);f.mail.desktopSource.wake();await settle(f.mail);assert.equal(f.mail.rows().length,1);
 await f.mail.call({action:'resumeImport'});await settle(f.mail);assert.equal(f.mail.rows().length,3);assert.equal(f.mail.status().localImport.resumed,1);
});
test('status of the local source never restores a portal or inherits its expired-session error',async()=>{
 let restores=0;const portal={restore:()=>{restores++;},status:()=>({connected:false,error:'mail_portal_login',folders:[]})};
 const snapshot={desktop:{mode:'desktop',connected:true,connecting:false,checking:false,error:null},localCount:3,progress:{stage:'ready'},encryption:{state:'on'},error:null};
 const local=await mailSourceStatus({snapshot,portal});assert.equal(local.protocol,'desktop');assert.equal(local.connected,true);assert.equal(local.error,null);assert.equal(restores,0);
 assert.equal((await mailSourceStatus({snapshot:{...snapshot,error:'mail_portal_login'},portal})).error,null);
 await mailSourceStatus({snapshot:{...snapshot,desktop:{mode:'portal'}},portal});assert.equal(restores,1);
});
test('automatic collection respects OFF and pause, then discovers new files when resumed',async t=>{
 const f=await fixture(t),profile=await f.profile('P100_owner');await put(profile,'AUTO_INBOX/one.mysingle','initial');
 await f.mail.call({action:'desktopConnect'});await settle(f.mail);assert.equal(f.mail.rows().length,1);assert.equal(f.mail.desktopSource.timer,null);
 await put(profile,'AUTO_INBOX/two.mysingle','later');await f.mail.desktopSource.sync();assert.equal(f.mail.rows().length,1);
 await f.mail.call({action:'setAutoWiki',enabled:true});await settle(f.mail);assert.equal(f.mail.rows().length,2);assert(f.mail.desktopSource.timer);
 await f.mail.call({action:'pauseWatch'});assert.equal(f.mail.desktopSource.timer,null);await put(profile,'AUTO_INBOX/three.mysingle','paused');await f.mail.desktopSource.sync();assert.equal(f.mail.rows().length,2);
 await f.mail.call({action:'resumeWatch'});await settle(f.mail);assert.equal(f.mail.rows().length,3);
});
test('source and copy directories cannot overlap or move into the Knox archive',async t=>{
 const f=await fixture(t),profile=await f.profile('P100_owner');await put(profile,'AUTO_INBOX/one.mysingle','readonly');
 await f.mail.call({action:'desktopConnect'});await settle(f.mail);
 const target=path.join(profile,'new-copy');await assert.rejects(f.mail.relocateRaw(target),/mail_storage_nested/);await assert.rejects(access(target));
 assert.equal(await readFile(path.join(profile,'AUTO_INBOX/one.mysingle'),'utf8'),eml('readonly').toString());
});
test('cancelling discovery prevents a late account selection from becoming connected',async t=>{
 const f=await fixture(t),profile=await f.profile('P100_owner');let finish;
 f.mail.desktopSource.discover=()=>new Promise(resolve=>{finish=resolve;});
 const pending=f.mail.call({action:'desktopConnect'});
 while(!finish)await new Promise(resolve=>setTimeout(resolve,5));
 await f.mail.call({action:'cancelConnect'});assert.equal(f.mail.desktopSource.snapshot().connecting,false);
 await assert.rejects(pending,/mail_cancelled/);
 finish({supported:true,profiles:[{id:sha(profile),root:profile,label:'P100_owner'}],error:null});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(f.mail.desktopSource.enabled,false);assert.equal(f.mail.rows().length,0);
});
test('SQLite disk full pauses background collection until explicit resume and retains successful receipts',async t=>{
 const f=await fixture(t),profile=await f.profile('P100_owner');for(let n=0;n<3;n++)await put(profile,'AUTO_INBOX/'+n+'.mysingle','message '+n);
 const intake=f.mail.intake.bind(f.mail);let calls=0;
 f.mail.intake=(...args)=>{if(++calls===2)throw Object.assign(Error('database or disk is full'),{code:'ERR_SQLITE_ERROR',errcode:13});return intake(...args);};
 await f.mail.call({action:'desktopConnect'});await settle(f.mail);assert.equal(f.mail.rows().length,1);assert.equal(f.mail.watchPaused,true);assert.equal(f.mail.desktopSource.error,'mail_storage_full');assert.equal(f.mail.desktopSource.timer,null);
 await f.restart();assert.equal(f.mail.watchPaused,true);await f.mail.call({action:'resumeImport'});await settle(f.mail);assert.equal(f.mail.rows().length,3);assert.equal(f.mail.status().localImport.resumed,1);
});
test('an unresponsive storage discovery times out and a fresh attempt can connect',async t=>{
 const f=await fixture(t),profile=await f.profile('P100_owner');await put(profile,'AUTO_INBOX/one.mysingle','available again');
 f.mail.desktopSource.discoveryTimeoutMs=20;f.mail.desktopSource.discover=()=>new Promise(()=>{});
 await assert.rejects(f.mail.call({action:'desktopConnect'}),/mail_desktop_timeout/);assert.equal(f.mail.desktopSource.snapshot().connecting,false);
 f.mail.desktopSource.discover=f.discover;f.mail.desktopSource.discoveryTimeoutMs=15000;
 await f.mail.call({action:'desktopConnect'});await settle(f.mail);assert.equal(f.mail.rows().length,1);
});

test('desktop intake stores pointers and metadata only; body, inline image and attachment exports read the Knox original',async t=>{
 const f=await fixture(t),profile=await f.profile('P100_owner'),source=path.join(profile,'AUTO_INBOX/parts.mysingle');await mkdir(path.dirname(source));
 const attachment=Buffer.from('ATTACHMENT-ONLY-UNIQUE-REFERENCE-987 '.repeat(100)),image=Buffer.from('inline image fixture');
 const raw=await new MailComposer({from:'sender@example.test',to:'owner@example.test',subject:'Reference parts',text:'BODY-ONLY-UNIQUE-REFERENCE-321',html:'<b>BODY-ONLY-UNIQUE-REFERENCE-321</b><img src="cid:one">',attachments:[{filename:'notes.txt',content:attachment},{filename:'one.png',cid:'one',content:image}]}).compile().build();await writeFile(source,raw);
 await f.mail.call({action:'confirmStorage',includeAttachments:false});await f.mail.call({action:'desktopConnect'});await settle(f.mail);
 const row=f.mail.rows()[0];assert.equal(row.sourceStorage,'desktop_reference');assert.equal(row.sourceHash,sha(raw));assert.equal(f.mail.status().desktop.storageMode,'desktop_reference');
 assert.deepEqual(await readdir(f.mail.rawRoot),['.encryption.json'],'no message, attachment or body manifest is written');
 assert(!JSON.stringify(f.mail.store.entries('')).includes('BODY-ONLY-UNIQUE-REFERENCE-321'));assert(!JSON.stringify(f.mail.store.entries('')).includes('ATTACHMENT-ONLY-UNIQUE-REFERENCE-987'));
 const value=await f.mail.read(row.id,{includePresentation:true});assert.match(value.mail.text,/BODY-ONLY-UNIQUE/);assert.match(value.mail.presentation.html,/BODY-ONLY-UNIQUE/);assert.equal(value.mail.storage.mode,'desktop_reference');
 const args={id:row.id,expectedSourceHash:row.sourceHash};assert.deepEqual(Buffer.from((await f.mail.download({...args,kind:'raw'})).bytes,'base64'),raw);
 assert.deepEqual(Buffer.from((await f.mail.download({...args,kind:'attachment',attachmentId:value.mail.attachments[0].id})).bytes,'base64'),attachment);
 assert.deepEqual(Buffer.from((await f.mail.download({...args,kind:'attachment',attachmentId:value.mail.inlineImages[0].id})).bytes,'base64'),image);
 assert.deepEqual(await readFile(source),raw);assert.deepEqual(await readdir(f.mail.rawRoot),['.encryption.json']);
 await f.restart();assert.equal((await f.mail.read(row.id)).sourceHash,row.sourceHash);
 await f.mail.call({action:'reset',confirmed:true});assert.deepEqual(await readFile(source),raw,'reset removes only Nubi data');
});
test('a cached body search, citations, raw download and knowledge never fall back after a Knox source disappears or changes',async t=>{
 const f=await fixture(t),profile=await f.profile('P100_owner'),source=await put(profile,'AUTO_INBOX/one.mysingle','ReferenceSearchUnique284');
 await f.mail.call({action:'desktopConnect'});await settle(f.mail);const row=f.mail.rows()[0];
 assert.equal((await f.mail.searchMail({query:'ReferenceSearchUnique284'})).results.length,1);
 await rm(source);assert.equal((await f.mail.searchMail({query:'ReferenceSearchUnique284'})).results.length,0);
 for(const action of ['read','knowledge','evidence','download'])await assert.rejects(f.mail.call({action,id:row.id,sourceHash:row.sourceHash,expectedSourceHash:row.sourceHash,kind:'raw'}),/mail_source_missing/);
 await writeFile(source,eml('new contents'));await assert.rejects(f.mail.read(row.id),/mail_source_changed/);
 await f.mail.desktopSource.sync({manual:true});assert.equal(f.mail.rows().length,2);const next=f.mail.rows().find(item=>item.id!==row.id);assert.match((await f.mail.read(next.id)).mail.text,/new contents/);
});
test('rediscovered identical content can move without breaking its ID or creating a second original copy',async t=>{
 const f=await fixture(t),profile=await f.profile('P100_owner'),source=await put(profile,'AUTO_INBOX/one.mysingle','same content');
 await f.mail.call({action:'desktopConnect'});await settle(f.mail);const row=f.mail.rows()[0],moved=path.join(profile,'AUTO_INBOX/moved.mysingle');
 await rename(source,moved);await assert.rejects(f.mail.read(row.id),/mail_source_missing/);
 await f.mail.desktopSource.sync({manual:true});assert.equal(f.mail.rows().length,1);assert.equal(f.mail.rows()[0].desktopReference.relative,'AUTO_INBOX/moved.mysingle');assert.match((await f.mail.read(row.id)).mail.text,/same content/);
});
test('reference reads reject linked files, linked profiles and traversal instead of opening another source',async t=>{
 const f=await fixture(t),profile=await f.profile('P100_owner'),source=await put(profile,'AUTO_INBOX/one.mysingle','bound original'),other=path.join(f.root,'other.mysingle');await writeFile(other,eml('bound original'));
 await f.mail.call({action:'desktopConnect'});await settle(f.mail);const row=f.mail.rows()[0];await rm(source);await symlink(other,source);
 await assert.rejects(f.mail.read(row.id),/mail_source_changed/);await assert.rejects(readDesktopMailReference({...row.desktopReference,relative:'../other.mysingle'}),/mail_source_changed/);
 await assert.rejects(readDesktopMailReference({...row.desktopReference,relative:other}),/mail_source_changed/);
 await rm(source);await writeFile(source,eml('bound original'));const moved=profile+'-moved';await rename(profile,moved);await symlink(moved,profile,'junction');await assert.rejects(f.mail.read(row.id),/mail_source_changed/);
});
test('existing byte-identical collected copies migrate to references and remove only verified owned duplicates',async t=>{
 const f=await fixture(t),profile=await f.profile('P100_owner'),source=await put(profile,'AUTO_INBOX/one.mysingle','MigrateUnique932');
 await f.mail.startFolderImport(profile);await f.mail.importTask;const row=f.mail.rows()[0],directory=path.join(f.mail.rawRoot,row.id);assert((await readdir(directory)).includes('message.eml.enc'));
 f.mail.store.set('mail-user:'+row.id,{pinned:true,tags:['keep']});await f.mail.call({action:'desktopConnect'});await settle(f.mail);
 assert.equal(f.mail.rows().length,1);assert.equal(f.mail.rows()[0].id,row.id);assert.equal(f.mail.rows()[0].sourceHash,row.sourceHash);assert.equal(f.mail.rows()[0].sourceStorage,'desktop_reference');assert.deepEqual(await readdir(directory),[]);
 assert.equal((await f.mail.read(row.id)).local.pinned,true);assert.match((await f.mail.read(row.id)).mail.text,/MigrateUnique932/);assert.deepEqual(await readFile(source),eml('MigrateUnique932'));
 await f.restart();assert.match((await f.mail.read(row.id)).mail.text,/MigrateUnique932/);
});
test('interrupted duplicate cleanup resumes after restart without reverting to the old copy',async t=>{
 const f=await fixture(t),profile=await f.profile('P100_owner');await put(profile,'AUTO_INBOX/one.mysingle','cleanup checkpoint');await f.mail.startFolderImport(profile);await f.mail.importTask;
 const row=f.mail.rows()[0],directory=path.join(f.mail.rawRoot,row.id);f.mail.removeDesktopCopies=async()=>{throw Error('mail_cancelled');};
 await f.mail.call({action:'desktopConnect'});await settle(f.mail);assert(f.mail.rows()[0].desktopCopyCleanup);assert((await readdir(directory)).includes('message.eml.enc'));assert.match((await f.mail.read(row.id)).mail.text,/cleanup checkpoint/);
 await f.restart();await f.mail.desktopSource.sync({manual:true});assert.equal(f.mail.rows()[0].desktopCopyCleanup,undefined);assert.deepEqual(await readdir(directory),[]);assert.match((await f.mail.read(row.id)).mail.text,/cleanup checkpoint/);
});
test('a changed local backup is never deleted or silently replaced during reference migration',async t=>{
 const f=await fixture(t),profile=await f.profile('P100_owner');await put(profile,'AUTO_INBOX/one.mysingle','source verified');await f.mail.startFolderImport(profile);await f.mail.importTask;
 const row=f.mail.rows()[0],stored=path.join(f.mail.rawRoot,row.id,'message.eml.enc'),bytes=await readFile(stored);bytes[bytes.length-1]^=1;await writeFile(stored,bytes);
 await f.mail.call({action:'desktopConnect'});await settle(f.mail);assert.equal(f.mail.rows()[0].sourceStorage,undefined);assert.deepEqual(await readFile(stored),bytes);assert.equal(f.mail.desktopSource.error,'mail_encryption_integrity');
});

test('verified migration removes copied attachment payloads while keeping on-demand downloads byte identical',async t=>{
 const f=await fixture(t),profile=await f.profile('P100_owner'),source=path.join(profile,'AUTO_INBOX/attached.mysingle');await mkdir(path.dirname(source));
 const attachment=Buffer.from('exact attachment payload'),raw=await new MailComposer({from:'sender@example.test',to:'owner@example.test',subject:'Migration attachments',text:'migration body',attachments:[{filename:'notes.txt',content:attachment}]}).compile().build();await writeFile(source,raw);
 await f.mail.startFolderImport(profile);await f.mail.importTask;const row=f.mail.rows()[0],directory=path.join(f.mail.rawRoot,row.id);assert.equal((await readdir(directory)).filter(file=>file.endsWith('.bin.enc')).length,1);
 await f.mail.call({action:'desktopConnect'});await settle(f.mail);assert.deepEqual(await readdir(directory),[]);const value=await f.mail.read(row.id),download=await f.mail.download({id:row.id,kind:'attachment',attachmentId:value.mail.attachments[0].id,expectedSourceHash:row.sourceHash});assert.deepEqual(Buffer.from(download.bytes,'base64'),attachment);assert.deepEqual(await readFile(source),raw);
});
test('a legacy body-only snapshot retains its original citation hash and is not deleted or rebound to the full Knox file',async t=>{
 const f=await fixture(t),profile=await f.profile('P100_owner'),source=path.join(profile,'AUTO_INBOX/body-only.mysingle');await mkdir(path.dirname(source));
 const raw=await new MailComposer({from:'sender@example.test',to:'owner@example.test',subject:'Legacy body only',text:'legacy body',attachments:[{filename:'notes.txt',content:'legacy attachment'}]}).compile().build();await writeFile(source,raw);
 await f.mail.startFolderImport(profile,{includeAttachments:false});await f.mail.importTask;const row=f.mail.rows()[0],directory=path.join(f.mail.rawRoot,row.id);assert.notEqual(row.sourceHash,sha(raw));const stored=await readFile(path.join(directory,'message.eml.enc'));
 await f.mail.call({action:'desktopConnect'});await settle(f.mail);assert.equal(f.mail.rows()[0].sourceStorage,undefined);assert.equal(f.mail.rows()[0].sourceHash,row.sourceHash);assert.deepEqual(await readFile(path.join(directory,'message.eml.enc')),stored);assert.equal((await f.mail.read(row.id)).mail.storage.mode,'body_only');assert.deepEqual(await readFile(source),raw);
});
