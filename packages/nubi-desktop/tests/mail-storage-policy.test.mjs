import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import MailComposer from 'nodemailer/lib/mail-composer';
import {PersonalMail} from './helpers-personal-mail.mjs';
import {normalizePortalMail} from '../runtime/mail-portal-content.mjs';
import {mailForStorage} from '../runtime/mail-storage-policy.mjs';
import {simpleParser} from 'mailparser';
async function message(){return new MailComposer({from:'Alice <alice@example.test>',to:'owner@example.test',bcc:'hidden@example.test',subject:'본문과 첨부',text:'본문 내용',html:'<b>본문 내용</b><img src="cid:body-image">',attachments:[{filename:'secret.txt',content:Buffer.from('PRIVATE ATTACHMENT DATA '.repeat(1000))},{filename:'body.png',content:Buffer.from('image fixture'),cid:'body-image'}]}).compile().build();}
test('attachment opt-out removes payload from raw copy, retains inline images and is deterministic',async()=>{
 const raw=await message(),mail=await normalizePortalMail(raw);
 const filtered=await mailForStorage(mail,false),again=await mailForStorage(mail,false),parsed=await simpleParser(filtered.raw,{keepCidLinks:true});
 assert(filtered.raw.length<raw.length/2);assert.deepEqual(filtered.raw,again.raw);assert.equal(parsed.attachments.length,1);assert.equal(parsed.attachments[0].cid,'body-image');assert.match(parsed.html,/cid:body-image/);
 assert.equal(filtered.attachments.length,1);assert.equal(filtered.normalized.attachments.find(item=>item.filename==='secret.txt').contentState,'not_stored');assert.equal(filtered.normalized.storage.mode,'body_only');
 assert.equal(await mailForStorage(mail,true),mail,'default preserves original bytes');
});
test('preference persists, excluded attachments do not create attention, download is explicit and relocation failure preserves preference',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-storage-policy-'));const host={storageRoot:path.join(root,'state')},options={personalRoot:path.join(root,'mail')};let mail=new PersonalMail(host,options);t.after(async()=>{await mail.dispose();await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});});await mail.call({action:'setAutoWiki',enabled:false});
 assert.equal(mail.status().includeAttachments,true);await mail.call({action:'confirmStorage',includeAttachments:false});mail.dispose();mail=new PersonalMail(host,options);assert.equal(mail.status().includeAttachments,false);
 const raw=await message(),parsed=await normalizePortalMail(raw);mail.store.set('account:fixture',{seen:[]});
 await mail.intake({mails:[{...parsed,uidl:'one',protocol:'local'}]},mail.generation,{collectOnly:true,accountId:'fixture'});
 const row=mail.rows()[0],source=await mail.read(row.id,{includePresentation:true}),excluded=source.mail.attachments[0];assert.equal(excluded.contentState,'document_read');assert.equal(excluded.originalStored,false);assert.match(excluded.text,/PRIVATE ATTACHMENT DATA/);assert.match(source.mail.presentation.html,/본문/);
 const files=await readdir(path.join(mail.rawRoot,row.id));assert.equal(files.filter(file=>file.endsWith('.bin.enc')).length,1);
 await assert.rejects(mail.download({id:row.id,kind:'attachment',attachmentId:excluded.id,expectedSourceHash:row.sourceHash}),/mail_attachment_not_stored/);
 const download=await mail.download({id:row.id,kind:'raw',expectedSourceHash:row.sourceHash});assert.match(download.filename,/-body-only.eml$/);assert.equal((await simpleParser(Buffer.from(download.bytes,'base64'))).attachments.length,1);
 const target=path.join(root,'blocked');await mkdir(path.join(target,'nubi-mail-raw'),{recursive:true});await writeFile(path.join(target,'nubi-mail-raw','occupied'),'x');
 await assert.rejects(mail.relocateRaw(target,{includeAttachments:true}),/mail_storage_not_empty/);assert.equal(mail.status().includeAttachments,false);
 await mail.call({action:'confirmStorage',includeAttachments:true});assert.equal(mail.status().includeAttachments,true);assert.deepEqual(await mail.rawVault.read(path.join(mail.rawRoot,row.id,'message.eml')),Buffer.from(download.bytes,'base64'),'preference never rewrites existing originals');
});

test('discarded originals retain encrypted evidence across reopen, search and agent windows',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-mail-evidence-')),host={storageRoot:path.join(root,'state')},options={personalRoot:path.join(root,'mail')};let service=new PersonalMail(host,options);
 t.after(async()=>{await service.dispose();await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});});
 await service.call({action:'setAutoWiki',enabled:false});await service.call({action:'confirmStorage',includeAttachments:false});
 const raw=await new MailComposer({from:'test@example.test',to:'owner@example.test',subject:'Scope',text:'Body evidence',attachments:[{filename:'notes.md',content:'# Decision\nUniqueEvidence352 deadline Friday'}]}).compile().build();
 const mail=await normalizePortalMail(raw);await service.intake({mails:[{...mail,uidl:'evidence',protocol:'local'}]},service.generation,{collectOnly:true,accountId:'fixture'});
 const id=service.rows()[0].id,dir=path.join(service.rawRoot,id);
 assert.deepEqual((await readdir(dir)).sort(),['manifest.json.enc','message.eml.enc']);
 assert(!(await readFile(path.join(dir,'manifest.json.enc'))).includes(Buffer.from('UniqueEvidence352')));
 service.dispose();await service.wikiDisposed;service=new PersonalMail(host,options);await service.prepare();
 const source=await service.read(id),attachment=source.mail.attachments[0];assert.match(source.mail.text,/Body evidence/);assert.match(attachment.text,/UniqueEvidence352/);
 const {readMailAttachmentsForAgent}=await import('../runtime/mail-agent-attachments.mjs');
 const evidence=await readMailAttachmentsForAgent({mailDocument(){throw Error('must use verified extraction');}},source);
 assert.match(evidence.mail.attachments[0].text,/UniqueEvidence352/);
 const search=await service.query('UniqueEvidence352');assert(JSON.stringify(search).includes('UniqueEvidence352'));
 const {installDesktopFeatures}=await import('../runtime/desktop-features.mjs');class Host{} installDesktopFeatures(Host);const previewHost=new Host();previewHost.personalMail=service;
 const preview=await previewHost.mailDocument({id,attachmentId:attachment.id,expectedSourceHash:source.sourceHash,expectedAttachmentHash:attachment.sha256});
 assert.equal(preview.originalStored,false);assert.match(preview.text,/UniqueEvidence352/);assert.equal(preview.pdf,undefined);
 let calls=0;const destination={provider:'aipro',model:'fixture'};
 service.host.providers={status:()=>({connected:true,...destination}),catalogs:()=>[{provider:'aipro',models:[{id:'fixture'}]}],complete:async messages=>{
  calls++;const payload=JSON.stringify(messages);assert.match(payload,/Body evidence/);assert.match(payload,/UniqueEvidence352/);
  return {content:JSON.stringify({summary:'Decision deadline Friday',category:'direct_request',priority:'high',facts:['UniqueEvidence352 deadline Friday'],actionItems:[]})};
 }};
 service.destination=destination;service.autoWiki=true;await service.readAttachments();await service.drain();
 for(let i=0;i<100&&service.rows()[0].state!=='saved';i++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(service.rows()[0].state,'saved',JSON.stringify(service.rows()[0]));assert.equal(calls,1);assert.match((await service.readKnowledge(service.rows()[0])).text,/UniqueEvidence352/);
 service.autoWiki=false;
 const manifest=JSON.parse(await service.rawVault.read(path.join(dir,'manifest.json'),'utf8'));manifest.mail.attachments[0].text='tampered';
 await rm(path.join(dir,'manifest.json.enc'));
 await service.rawVault.write(path.join(dir,'manifest.json'),JSON.stringify(manifest));
 await assert.rejects(service.read(id),/mail_source_changed/);
});
test('failed extraction never acknowledges or discards the source; retry retains completed receipts',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-mail-evidence-retry-')),service=new PersonalMail({storageRoot:path.join(root,'state')},{personalRoot:path.join(root,'mail')});
 t.after(async()=>{await service.dispose();await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});});
 await service.call({action:'setAutoWiki',enabled:false});await service.call({action:'confirmStorage',includeAttachments:false});service.store.set('account:fixture',{seen:[]});
 const parsed=await normalizePortalMail(await message()),incoming={...parsed,uidl:'retry',protocol:'pop3'};
 const extract=service.extractAttachment.bind(service);service.extractAttachment=async()=>{throw Error('document_timeout');};
 await assert.rejects(service.intake({mails:[incoming]},service.generation,{collectOnly:true,accountId:'fixture'}),/mail_attachment_analysis_failed/);
 assert.equal(service.rows().length,0);assert.deepEqual(service.store.get('account:fixture').seen,[]);assert(!(await readdir(service.rawRoot)).some(name=>name.endsWith('.pending')));
 service.extractAttachment=extract;await service.intake({mails:[incoming]},service.generation,{collectOnly:true,accountId:'fixture'});
 assert.deepEqual(service.store.get('account:fixture').seen,['retry']);assert.equal(service.rows().length,1);
 service.extractAttachment=async()=>{throw Error('must not reread completed source');};await service.intake({mails:[incoming]},service.generation,{collectOnly:true,accountId:'fixture'});assert.equal(service.rows().length,1);
});
