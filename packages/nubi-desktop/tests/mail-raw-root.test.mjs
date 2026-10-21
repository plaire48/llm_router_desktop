import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {PersonalMail} from './helpers-personal-mail.mjs';
import {MailPortal} from '../electron-app/mail-portal.cjs';

// The person picks where mail and attachment originals live (user request 2026-10-14); what is stored moves along and
// reads keep working from the new place.
const summary={summary:'본문 예산 요청',category:'direct_request',priority:'high',facts:['예산 요청'],actionItems:[]};
function makeHost(root){return {storageRoot:path.join(root,'state'),agent:{running:true},providers:{
  status:()=>({connected:true,provider:'fixture',model:'fixture'}),
  catalogs:()=>[{provider:'fixture',models:[{id:'fixture'}]}],
  complete:async()=>({content:JSON.stringify(summary)})
}};}

test('originals move to a chosen folder and stay readable there',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'nubi-mail-raw-'));
  const mail=new PersonalMail(makeHost(root),{personalRoot:path.join(root,'mail')});t.after(async()=>{mail.dispose();await Promise.all([mail.rawDisposed,mail.wikiDisposed]);await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});});
  mail.autoWiki=true;mail.paused=false;mail.account='fixture-account';mail.credentials={};mail.destination={provider:'fixture',model:'fixture'};mail.store.set('account:'+mail.account,{seen:[]});
  await mail.prepare();
  await mail.intake({uidls:['one'],mails:[{uidl:'one',raw:Buffer.from('Subject: hi\r\n\r\nbody'),attachments:[],normalized:{subject:'예산 확인',from:'a@example.invalid',text:'본문',attachments:[]}}]},mail.generation);
  const row=mail.rows()[0],before=mail.rawRoot;
  assert.equal(before,path.join(root,'mail','raw'));
  const target=path.join(root,'elsewhere');
  const status=await mail.relocateRaw(target);
  assert.equal(mail.rawRoot,await realpath(path.join(target,'nubi-mail-raw')));assert.equal(status.rawRoot,mail.rawRoot);
  assert.deepEqual((await readdir(mail.rawRoot)).filter(name=>!name.startsWith('.')),[row.id]);assert.deepEqual(await readdir(before),[]);
  const downloaded=await mail.download({id:row.id,kind:'raw',expectedSourceHash:row.sourceHash});
  assert.match(Buffer.from(downloaded.bytes,'base64').toString(),/Subject: hi/);
  // A folder that already holds something, or one nested in the current place, is refused.
  const busy=path.join(root,'busy','nubi-mail-raw');await mkdir(busy,{recursive:true});await writeFile(path.join(busy,'x'),'x');
  await assert.rejects(mail.relocateRaw(path.join(root,'busy')),/mail_storage_not_empty/);
  await assert.rejects(mail.relocateRaw(path.join(mail.rawRoot,'inner')),/mail_storage_nested/);
  await assert.rejects(mail.relocateRaw('relative/path'),/mail_input_invalid/);
});

test('portal collection waits for storage confirmation, then reuses it after restart',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-mail-storage-guide-'));
 const host=makeHost(root),options={personalRoot:path.join(root,'mail')};let mail=new PersonalMail(host,options);t.after(async()=>{mail.dispose();await Promise.all([mail.rawDisposed,mail.wikiDisposed]);await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});});
 await mail.call({action:'portalConnect',identity:'fixture-user',folders:[]});assert.equal(mail.status().requiresStorageSetup,true);
 const portal=new MailPortal({invoke:(_method,args)=>mail.call(args)});t.after(()=>portal.dispose());portal.state.connected=true;portal.identity={setCd:''};let reads=0;
 portal.read=async operation=>{reads++;assert.equal(operation,'folders');return [];};
 await portal.sync();await portal.sync({manual:true});assert.equal(reads,0);assert.equal(portal.timer,undefined);assert.equal(portal.status().connected,true);
 await mail.call({action:'confirmStorage'});assert.equal(mail.status().requiresStorageSetup,false);await portal.sync();assert.equal(reads,1);
 mail.dispose();mail=new PersonalMail(host,options);assert.equal(mail.status().requiresStorageSetup,false,'same folder is remembered without another prompt');
});

test('failed relocation preserves the old path and every original',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-mail-storage-failure-'));
 const mail=new PersonalMail(makeHost(root),{personalRoot:path.join(root,'mail')});t.after(async()=>{mail.dispose();await Promise.all([mail.rawDisposed,mail.wikiDisposed]);await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});});await mail.prepare();
 const before=mail.rawRoot;await mkdir(path.join(before,'original'));await writeFile(path.join(before,'original/message.eml'),'original mail');
 const set=mail.store.set.bind(mail.store);mail.store.set=(key,value)=>{if(key==='setting:raw-root')throw Error('fixture_commit_failed');return set(key,value);};
 const target=path.join(root,'new-location');await assert.rejects(mail.relocateRaw(target),/fixture_commit_failed/);
 assert.equal(mail.rawRoot,before);assert.equal(await readFile(path.join(before,'original/message.eml'),'utf8'),'original mail');assert.deepEqual(await readdir(path.join(target,'nubi-mail-raw')),[]);assert.equal(mail.status().storageMoving,false);assert.equal(mail.status().requiresStorageSetup,true);
});

test('a previously chosen location does not ask again',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-mail-storage-existing-'));
 const mail=new PersonalMail(makeHost(root),{personalRoot:path.join(root,'mail')});t.after(async()=>{mail.dispose();await Promise.all([mail.rawDisposed,mail.wikiDisposed]);await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});});
 mail.store.set('setting:raw-root',{path:path.join(root,'chosen')});assert.equal(mail.status().requiresStorageSetup,false);
});

test('relocation exposes live verified progress while independent status requests stay responsive',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-mail-move-progress-'));
 const mail=new PersonalMail(makeHost(root),{personalRoot:path.join(root,'mail')});t.after(async()=>{mail.dispose();await Promise.all([mail.rawDisposed,mail.wikiDisposed]);await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});});await mail.prepare();
 const bytes=Buffer.alloc(32*1024,65);for(let group=0;group<8;group++){const directory=path.join(mail.rawRoot,'group-'+group);await mkdir(directory);for(let n=0;n<12;n++)await writeFile(path.join(directory,n+'.bin'),bytes);}
 let done=false;const samples=[];
 const moving=mail.relocateRaw(path.join(root,'new')).finally(()=>{done=true;});
 while(!done){const started=performance.now(),value=await mail.call({action:'storageProgress'});samples.push({latency:performance.now()-started,moving:value.moving,...structuredClone(value.progress)});await new Promise(resolve=>setTimeout(resolve,1));}
 await moving;
 const copies=samples.filter(value=>value.stage==='copying');assert(copies.length>1,'status remains observable between file I/O steps');assert(copies.some(value=>value.completed>0&&value.completed<96));
 assert(copies.every(value=>value.total===97&&value.totalBytes===96*bytes.length+39&&value.bytes<=value.totalBytes));
 for(let n=1;n<copies.length;n++)assert(copies[n].bytes>=copies[n-1].bytes);
 assert(samples.every(value=>value.latency<1000),'lightweight progress read never waits for full relocation');
 const result=await mail.call({action:'storageProgress'});assert.equal(result.moving,false);assert.equal(result.progress.state,'completed');assert.equal(result.progress.stage,'complete');
 const previousRows=mail.rows;mail.rows=()=>assert.fail('progress must not scan all mail');assert.equal((await mail.call({action:'storageProgress'})).moving,false);mail.rows=previousRows;
});

test('background relocation returns a job before completion and rejects overlapping moves',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-mail-move-job-'));const mail=new PersonalMail(makeHost(root),{personalRoot:path.join(root,'mail')});t.after(async()=>{mail.dispose();await Promise.all([mail.rawDisposed,mail.wikiDisposed]);await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});});await mail.prepare();
 await mkdir(path.join(mail.rawRoot,'original'));for(let n=0;n<12;n++)await writeFile(path.join(mail.rawRoot,'original',n+'.eml'),'original '+n);
 const job=await mail.call({action:'startRawMove',directory:path.join(root,'new'),includeAttachments:false});assert(job.id);assert.equal(job.moving,true);
 await assert.rejects(mail.call({action:'startRawMove',directory:path.join(root,'overlap')}),/mail_busy/);assert.equal((await mail.call({action:'storageProgress',id:job.id})).progress.id,job.id);
 await mail.storageMoveTask;const result=await mail.call({action:'storageProgress',id:job.id});assert.equal(result.moving,false);assert.equal(result.progress.state,'completed');assert.equal(result.progress.error,undefined);assert.equal(mail.includeAttachments,false);
 await assert.rejects(mail.call({action:'storageProgress',id:'old-job'}),/mail_storage_task_changed/);
 await assert.rejects(mail.call({action:'startRawMove',directory:'relative'}),/mail_input_invalid/);assert.equal(mail.storageProgress.id,job.id);assert.equal(mail.storageProgress.error,undefined);
});
