import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,readFile,rm,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {PersonalMail} from '../runtime/mail.mjs';
import {decryptPage} from '../runtime/mail-wiki-vault.mjs';

// The mail runtime with an in-memory connection vault: pages must reach disk only as .md.enc under the store,
// readers see the session copy, and dispose wipes that copy (user decision 2026-10-14: mail data is encrypted).
const memorySecrets=()=>{const map=new Map();return {get:async key=>map.get(key)??null,set:async(key,value)=>{map.set(key,value);},delete:async key=>{map.delete(key);}};};
const summary={summary:'본문 예산 요청',category:'direct_request',priority:'high',facts:['메일 본문에 예산 요청이 있다.'],actionItems:[]};
function makeHost(root,secrets){return {storageRoot:path.join(root,'state'),connectionVault:secrets,agent:{running:false},providers:{
  status:()=>({connected:true,provider:'fixture',model:'fixture'}),
  catalogs:()=>[{provider:'fixture',models:[{id:'fixture'}]}],
  complete:async()=>({content:JSON.stringify(summary)})
}};}
async function runtime(root,secrets){
  const mail=new PersonalMail(makeHost(root,secrets),{personalRoot:path.join(root,'mail')});
  mail.autoWiki=true;mail.paused=false;mail.account='fixture-account';mail.credentials={};mail.destination={provider:'fixture',model:'fixture'};
  mail.store.set('account:'+mail.account,{seen:[]});await mail.prepare();return mail;
}
const settle=async(mail,predicate)=>{for(let i=0;i<200&&!predicate();i++)await new Promise(r=>setTimeout(r,25));};

test('mail wiki pages are stored encrypted, served from a session copy and wiped on dispose',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'nubi-mail-enc-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const secrets=memorySecrets();let mail=await runtime(root,secrets);
  const store=mail.wikiStoreRoot,session=mail.wikiRoot;
  assert.notEqual(store,session);assert.equal(mail.status().encryption.state,'on');assert.equal(mail.status().wikiRoot,session);
  await mail.intake({uidls:['one'],mails:[{uidl:'one',raw:Buffer.from('Original MIME'),attachments:[],normalized:{subject:'예산 확인',from:'sender@example.invalid',text:'본문 예산 요청',attachments:[]}}]},mail.generation);
  await mail.drain();await settle(mail,()=>mail.rows()[0]?.state==='saved');
  const row=mail.rows()[0];assert.equal(row.state,'saved',JSON.stringify(row));
  assert.deepEqual((await readdir(store)).filter(name=>!name.startsWith('.')).map(name=>name.replace(/^.*\./,'')),['enc'],'only encrypted pages in the store');
  const sessionFiles=(await readdir(session)).filter(name=>name.endsWith('.md'));assert.equal(sessionFiles.length,1);
  const plain=await readFile(path.join(session,sessionFiles[0]),'utf8');assert.match(plain,/예산 확인/);
  const encrypted=await readFile(path.join(store,sessionFiles[0]+'.enc'));assert.equal(decryptPage(mail.wikiVault.key,encrypted),plain);
  const source=await mail.read(row.id,{includeKnowledge:true});assert.equal(source.knowledge.state,'current');
  mail.dispose();await mail.wikiDisposed;await assert.rejects(stat(session));
  // A new runtime with the same vault rebuilds the session copy and can read the page again.
  mail=await runtime(root,secrets);t.after(()=>{mail.dispose();});
  assert.equal((await readdir(mail.wikiRoot)).filter(name=>name.endsWith('.md')).length,1);
  const again=await mail.read(row.id,{includeKnowledge:true});assert.equal(again.knowledge.state,'current');
});

test('without a usable vault the pages stay plain and the status says unavailable',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'nubi-mail-plain-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const mail=new PersonalMail(makeHost(root,{get:async()=>{throw Error('secret_unavailable');},set:async()=>{}}),{personalRoot:path.join(root,'mail')});t.after(()=>{mail.dispose();});await mail.ensureWiki();
  assert.equal(mail.status().encryption.wikiState,'unavailable');assert.equal(mail.wikiRoot,mail.wikiStoreRoot);
});
