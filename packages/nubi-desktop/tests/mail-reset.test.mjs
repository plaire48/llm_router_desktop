import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,writeFile,readFile,readdir,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {PersonalMail} from '../runtime/mail.mjs';
const secrets=()=>{const values=new Map();return {get:async k=>values.get(k),set:async(k,v)=>values.set(k,v)};};
async function fixture(t){
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-reset-'))),host={storageRoot:path.join(root,'state'),connectionVault:secrets(),providers:{status:()=>({connected:false}),catalogs:()=>[]}},options={personalRoot:path.join(root,'mail')};
 let mail=new PersonalMail(host,options);await mail.prepare();await mail.rawMigration;mail.autoWiki=false;
 t.after(async()=>{mail.dispose();await mail.rawDisposed;await mail.wikiDisposed;await rm(root,{recursive:true,force:true});});
 return {root,get mail(){return mail;},async reopen(){mail.dispose();await mail.rawDisposed;await mail.wikiDisposed;mail=new PersonalMail(host,options);await mail.prepare();return mail;}};
}
async function seed(mail){
 mail.account='fixture';mail.credentials={source:'portal'};mail.store.set('account:fixture',{seen:[]});
 const incoming={uidl:'same',raw:Buffer.from('Subject: reset fixture\r\n\r\nbody'),normalized:{subject:'reset fixture',from:'fixture@example.invalid',text:'body',attachments:[]},attachments:[]};
 await mail.intake({mails:[incoming]},mail.generation,{collectOnly:true});
 await writeFile(path.join(mail.wikiRoot,'home.md'),'# Personal edits');await mail.wikiVault.persist('home.md','# Personal edits');
 mail.store.set('mailfact:old',{id:'old'});mail.store.set('setting:local-import',{state:'interrupted',directory:'/not-to-delete'});
 return incoming;
}
test('reset clears originals, encrypted wiki, facts and UIDLs; reopening stays empty and same mail imports again',async t=>{
 const f=await fixture(t),mail=f.mail,incoming=await seed(mail),id=mail.rows()[0].id;
 const original=path.join(f.root,'source.eml');await writeFile(original,'human source');await writeFile(path.join(mail.rawRoot,'keep.txt'),'unrelated');
 const chosen=path.join(f.root,'chosen','nubi-mail-raw');await mail.relocateRaw(path.dirname(chosen));assert.equal(mail.rawRoot,chosen);
 await assert.rejects(mail.call({action:'reset'}),/mail_reset_confirmation/);assert.equal(mail.rows().length,1);
 const result=await mail.call({action:'reset',confirmed:true});assert.equal(result.counts.received,0);assert.equal(result.connected,false);
 assert.deepEqual(mail.knownUids('fixture'),[]);assert.deepEqual(mail.store.list('mailfact:'),[]);assert.equal(mail.store.get('setting:local-import'),null);
 await assert.rejects(readFile(path.join(mail.rawRoot,id,'message.eml.enc')),/ENOENT/);
 assert.equal(await readFile(original,'utf8'),'human source');assert.equal(await readFile(path.join(mail.rawRoot,'keep.txt'),'utf8'),'unrelated');
 const reopened=await f.reopen();assert.equal(reopened.rows().length,0);assert.equal((await readdir(reopened.wikiRoot)).length,0);assert.equal(reopened.rawRoot,chosen);
 reopened.autoWiki=false;reopened.account='fixture';reopened.credentials={};reopened.store.set('account:fixture',{seen:[]});await reopened.intake({mails:[incoming]},reopened.generation,{collectOnly:true});assert.equal(reopened.rows().length,1);
});
test('reset waits for a writer to settle and refuses new imports before deleting',async t=>{
 const {mail}=await fixture(t);await seed(mail);mail.activeCalls=1;
 const reset=mail.call({action:'reset',confirmed:true});await new Promise(r=>setTimeout(r,30));assert.equal(mail.rows().length,1);assert.equal((await mail.call({action:'resetProgress'})).stage,'stopping');
 await assert.rejects(mail.call({action:'resumeImport'}),/mail_reset_pending/);
 mail.activeCalls=0;await reset;assert.equal(mail.rows().length,0);
});
test('unsafe storage stops reset, persists a paused marker, and permits retry after repair',async t=>{
 const f=await fixture(t),mail=f.mail;await seed(mail);const original=mail.rawRoot,external=path.join(f.root,'external');await mkdir(external);await writeFile(path.join(external,'keep'),'source');
 await rm(original,{recursive:true});await symlink(external,original,'dir');
 await assert.rejects(mail.call({action:'reset',confirmed:true}),/mail_reset_failed/);assert.equal(mail.store.get('setting:reset-pending'),true);assert.equal(mail.rows().length,1);assert.equal(await readFile(path.join(external,'keep'),'utf8'),'source');
 await rm(original);await mkdir(original);await f.reopen();assert.equal(f.mail.status().resetPending,true);await assert.rejects(f.mail.call({action:'resumeImport'}),/mail_reset_pending/);
 await f.mail.call({action:'reset',confirmed:true});assert.equal(f.mail.status().resetPending,false);assert.equal(f.mail.rows().length,0);
});

test('partial cleanup does not report success or resume collection; retry finishes the metadata transaction',async t=>{
 const f=await fixture(t),mail=f.mail;await seed(mail);
 const remove=mail.store.delete.bind(mail.store);let injected=false;
 mail.store.delete=key=>{if(!injected&&key.startsWith('mail:')){injected=true;throw Error('fixture_write_failed');}return remove(key);};
 await assert.rejects(mail.call({action:'reset',confirmed:true}),/mail_reset_failed/);
 assert.equal(mail.status().resetPending,true);assert.equal(mail.rows().length,1);assert.equal(mail.credentials,null);
 assert.equal((await readdir(mail.wikiStoreRoot)).filter(n=>n.endsWith('.enc')).length,0);
 mail.store.delete=remove;await f.reopen();assert.equal(f.mail.status().resetPending,true);
 await f.mail.call({action:'reset',confirmed:true});assert.equal(f.mail.rows().length,0);assert.equal(f.mail.status().resetPending,false);
});
