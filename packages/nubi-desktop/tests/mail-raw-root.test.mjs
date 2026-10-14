import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {PersonalMail} from '../runtime/mail.mjs';

// The person picks where mail and attachment originals live (user request 2026-10-14); what is stored moves along and
// reads keep working from the new place.
const summary={summary:'본문 예산 요청',category:'direct_request',priority:'high',facts:['예산 요청'],actionItems:[]};
function makeHost(root){return {storageRoot:path.join(root,'state'),agent:{running:true},providers:{
  status:()=>({connected:true,provider:'fixture',model:'fixture'}),
  catalogs:()=>[{provider:'fixture',models:[{id:'fixture'}]}],
  complete:async()=>({content:JSON.stringify(summary)})
}};}

test('originals move to a chosen folder and stay readable there',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'nubi-mail-raw-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const mail=new PersonalMail(makeHost(root),{personalRoot:path.join(root,'mail')});t.after(()=>mail.dispose());
  mail.autoWiki=true;mail.paused=false;mail.account='fixture-account';mail.credentials={};mail.destination={provider:'fixture',model:'fixture'};mail.store.set('account:'+mail.account,{seen:[]});
  await mail.prepare();
  await mail.intake({uidls:['one'],mails:[{uidl:'one',raw:Buffer.from('Subject: hi\r\n\r\nbody'),attachments:[],normalized:{subject:'예산 확인',from:'a@example.invalid',text:'본문',attachments:[]}}]},mail.generation);
  const row=mail.rows()[0],before=mail.rawRoot;
  assert.equal(before,path.join(root,'mail','raw'));
  const target=path.join(root,'elsewhere');
  const status=await mail.relocateRaw(target);
  assert.equal(mail.rawRoot,path.join(target,'nubi-mail-raw'));assert.equal(status.rawRoot,mail.rawRoot);
  assert.deepEqual(await readdir(mail.rawRoot),[row.id]);assert.deepEqual(await readdir(before),[]);
  const downloaded=await mail.download({id:row.id,kind:'raw',expectedSourceHash:row.sourceHash});
  assert.match(Buffer.from(downloaded.bytes,'base64').toString(),/Subject: hi/);
  // A folder that already holds something, or one nested in the current place, is refused.
  const busy=path.join(root,'busy','nubi-mail-raw');await mkdir(busy,{recursive:true});await writeFile(path.join(busy,'x'),'x');
  await assert.rejects(mail.relocateRaw(path.join(root,'busy')),/mail_storage_not_empty/);
  await assert.rejects(mail.relocateRaw(path.join(mail.rawRoot,'inner')),/mail_storage_nested/);
  await assert.rejects(mail.relocateRaw('relative/path'),/mail_input_invalid/);
});
