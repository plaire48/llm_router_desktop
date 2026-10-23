import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import MailComposer from 'nodemailer/lib/mail-composer';
import {PersonalMail} from './helpers-personal-mail.mjs';
import {normalizePortalMail} from '../runtime/mail-portal-content.mjs';
import {DEFAULT_MAIL_INTAKE} from '../runtime/mail-intake-policy.mjs';
async function fixture(t,extra={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-intake-')),keys=new Map(),host={storageRoot:path.join(root,'state'),connectionVault:{get:async key=>keys.get(key),set:async(key,value)=>{keys.set(key,value);}}},options={personalRoot:path.join(root,'mail'),intakeConfigured:false,...extra};let mail=new PersonalMail(host,options);await mail.call({action:'setAutoWiki',enabled:false});
 t.after(async()=>{mail.dispose();await Promise.all([mail.rawDisposed,mail.wikiDisposed]);await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});});return {root,get mail(){return mail;},reopen:async()=>{mail.dispose();await Promise.all([mail.rawDisposed,mail.wikiDisposed]);mail=new PersonalMail(host,options);return mail;}};
}
const incoming=async(subject='검토 요청')=>normalizePortalMail(await new MailComposer({from:'owner@example.test',to:'recipient@example.test',subject,text:'Original body evidence',date:new Date('2026-10-24T01:00:00Z')}).compile().build());
test('first collection is gated for folders and POP3 without losing authenticated connection',async t=>{
 let input;const parsed=await incoming(),f=await fixture(t,{pull:async value=>{input=value;value.onAuthenticated?.();return {uidls:['one'],mails:[{...parsed,uidl:'one'}],failed:[],delaySeconds:60};}});
 assert.equal(f.mail.status().intakeConfigured,false);assert.equal(f.mail.status().requiresStorageSetup,true);await assert.rejects(f.mail.startFolderImport(f.root),/mail_intake_setup_required/);
 await f.mail.call({action:'connect',serverProfile:'company',user:'owner@example.test',password:'fixture-password',requestId:'probe'});assert.equal(input.known,null);assert.equal(f.mail.rows().length,0);assert.equal(f.mail.status().connected,true);
 await f.mail.call({action:'configureIntake',policy:DEFAULT_MAIL_INTAKE});assert.equal(f.mail.status().requiresStorageSetup,false);await f.reopen();assert.equal(f.mail.status().intakeConfigured,true);
});
test('excluded mail has no original, processing row or Wiki; changing policy makes excluded UIDs eligible again',async t=>{
 const f=await fixture(t);await f.mail.call({action:'configureIntake',policy:{excludeSubjects:['홍보']}});f.mail.store.set('account:fixture',{seen:[]});
 for(const protocol of ['pop3','portal','local']){const parsed=await incoming('홍보 안내');await f.mail.intake({mails:[{...parsed,uidl:protocol,protocol,mailbox:'inbox'}]},f.mail.generation,{collectOnly:true,accountId:'fixture'});}
 assert.equal(f.mail.rows().length,0);assert.equal((await readdir(f.mail.rawRoot)).filter(name=>/^[a-f0-9]{64}$/.test(name)).length,0);assert.equal(f.mail.knownUids('fixture').length,3);assert.equal((await readdir(f.mail.wikiRoot)).length,0);
 await f.mail.call({action:'configureIntake',policy:{excludeSubjects:[]}});assert.deepEqual(f.mail.knownUids('fixture'),[]);const parsed=await incoming('홍보 안내');await f.mail.intake({mails:[{...parsed,uidl:'pop3',protocol:'local',mailbox:'inbox'}]},f.mail.generation,{collectOnly:true,accountId:'fixture'});assert.equal(f.mail.rows().length,1);
});
test('original opt-out keeps a derived encrypted body rather than an original EML, including mails without attachments',async t=>{
 const f=await fixture(t);await f.mail.call({action:'configureIntake',policy:{retainOriginals:false}});const parsed=await incoming();f.mail.store.set('account:fixture',{seen:[]});
 await f.mail.intake({mails:[{...parsed,uidl:'body',protocol:'local',mailbox:'inbox'}]},f.mail.generation,{collectOnly:true,accountId:'fixture'});const row=f.mail.rows()[0],files=await readdir(path.join(f.mail.rawRoot,row.id));assert.equal(row.sourceStorage,'body_only');assert(files.includes('body.eml.enc'));assert(!files.includes('message.eml.enc'));assert(!files.some(file=>file.endsWith('.bin.enc')));assert.match((await f.mail.read(row.id,{includePresentation:true})).mail.text,/Original body evidence/);
 const raw=await f.mail.sourceBytes(row);assert.notDeepEqual(raw,parsed.raw);assert((await f.mail.call({action:'search',query:'Original'})).results.some(result=>result.id===row.id));await f.reopen();assert.equal(f.mail.status().retainOriginals,false);assert.match((await f.mail.read(row.id)).mail.text,/Original body evidence/);assert.match((await f.mail.download({id:row.id,kind:'raw',expectedSourceHash:row.sourceHash})).filename,/body-only\.eml$/);
});
test('encrypted Wiki location moves with verified bytes and preserves session paths across reopening',async t=>{
 const f=await fixture(t);await f.mail.call({action:'configureIntake',policy:DEFAULT_MAIL_INTAKE});await f.mail.ensureWiki();const session=f.mail.wikiRoot,previous=f.mail.wikiStoreRoot;await writeFile(path.join(session,'retained.md'),'User edited Wiki');await f.mail.wikiVault.syncAll();const bytes=await readFile(path.join(previous,'retained.md.enc'));
 await f.mail.call({action:'configureIntake',policy:DEFAULT_MAIL_INTAKE,wikiDirectory:path.join(f.root,'chosen')});assert.equal(f.mail.wikiRoot,session);assert.equal(f.mail.status().wikiStoreRoot,await realpath(path.join(f.root,'chosen','nubi-mail-wiki')));assert.deepEqual(await readFile(path.join(f.mail.wikiStoreRoot,'retained.md.enc')),bytes);assert.equal((await readdir(previous)).length,0);
 const selected=f.mail.wikiStoreRoot;await f.reopen();await f.mail.ensureWiki();assert.equal(f.mail.wikiStoreRoot,selected);assert.equal(await readFile(path.join(f.mail.wikiRoot,'retained.md'),'utf8'),'User edited Wiki');
 const blocked=path.join(f.root,'occupied','nubi-mail-wiki');await mkdir(blocked,{recursive:true});await writeFile(path.join(blocked,'foreign'),'preserve');await assert.rejects(f.mail.call({action:'configureIntake',policy:DEFAULT_MAIL_INTAKE,wikiDirectory:blocked}),/mail_storage_not_empty/);assert.equal(f.mail.wikiStoreRoot,selected);assert.equal(await readFile(path.join(blocked,'foreign'),'utf8'),'preserve');
});
test('original opt-out preserves CID and data body-image evidence without the original MIME',async t=>{
 const f=await fixture(t);await f.mail.call({action:'configureIntake',policy:{retainOriginals:false}});const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=','base64'),raw=await new MailComposer({from:'owner@example.test',subject:'Images',text:'body',html:'<img src="cid:body-one"><img src="data:image/png;base64,'+image.toString('base64')+'">',attachments:[{filename:'body.png',content:image,cid:'body-one',contentType:'image/png'}]}).compile().build(),parsed=await normalizePortalMail(raw);f.mail.store.set('account:fixture',{seen:[]});await f.mail.intake({mails:[{...parsed,uidl:'image',protocol:'local',mailbox:'inbox'}]},f.mail.generation,{collectOnly:true,accountId:'fixture'});
 const row=f.mail.rows()[0],source=await f.mail.read(row.id,{includePresentation:true});assert(source.mail.inlineImages.some(part=>part.bodyData));for(const part of source.mail.inlineImages)assert.deepEqual(await f.mail.readAttachmentBytes(source,part),image);assert.equal((await readdir(path.join(f.mail.rawRoot,row.id))).includes('message.eml.enc'),false);
});
test('raw storage cannot be placed under the temporary decrypted Wiki session',async t=>{
 const f=await fixture(t);await f.mail.ensureWiki();await assert.rejects(f.mail.call({action:'configureIntake',policy:DEFAULT_MAIL_INTAKE,rawDirectory:f.mail.wikiRoot}),/mail_storage_nested/);assert.equal(f.mail.intakeConfigured,false);
});
test('folder imports count exclusions separately and reconsider them after scope changes',async t=>{
 const f=await fixture(t),directory=path.join(f.root,'source');await mkdir(directory);await writeFile(path.join(directory,'one.eml'),(await incoming('홍보 안내')).raw);await f.mail.call({action:'configureIntake',policy:{excludeSubjects:['홍보']}});await f.mail.startFolderImport(directory);await f.mail.importTask;assert.equal(f.mail.importProgress.state,'completed');assert.equal(f.mail.importProgress.excluded,1);assert.equal(f.mail.importProgress.imported,0);assert.equal(f.mail.importProgress.failures.length,0);
 await f.mail.call({action:'configureIntake',policy:DEFAULT_MAIL_INTAKE});await f.mail.startFolderImport(directory);await f.mail.importTask;assert.equal(f.mail.importProgress.imported,1);
});
