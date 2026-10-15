import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import MailComposer from 'nodemailer/lib/mail-composer';
import {PersonalMail} from '../runtime/mail.mjs';
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
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-storage-policy-'));t.after(()=>rm(root,{recursive:true,force:true}));const host={storageRoot:path.join(root,'state')},options={personalRoot:path.join(root,'mail')};let mail=new PersonalMail(host,options);t.after(()=>mail.dispose());await mail.call({action:'setAutoWiki',enabled:false});
 assert.equal(mail.status().includeAttachments,true);await mail.call({action:'confirmStorage',includeAttachments:false});mail.dispose();mail=new PersonalMail(host,options);assert.equal(mail.status().includeAttachments,false);
 const raw=await message(),parsed=await normalizePortalMail(raw);mail.store.set('account:fixture',{seen:[]});
 await mail.intake({mails:[{...parsed,uidl:'one',protocol:'local'}]},mail.generation,{collectOnly:true,accountId:'fixture'});
 const row=mail.rows()[0],source=await mail.read(row.id,{includePresentation:true}),excluded=source.mail.attachments[0];assert.equal(excluded.contentState,'not_stored');assert.match(source.mail.presentation.html,/본문/);
 const files=await readdir(path.join(mail.rawRoot,row.id));assert.equal(files.filter(file=>file.endsWith('.bin')).length,1);
 await assert.rejects(mail.download({id:row.id,kind:'attachment',attachmentId:excluded.id,expectedSourceHash:row.sourceHash}),/mail_attachment_not_stored/);
 const download=await mail.download({id:row.id,kind:'raw',expectedSourceHash:row.sourceHash});assert.match(download.filename,/-body-only.eml$/);assert.equal((await simpleParser(Buffer.from(download.bytes,'base64'))).attachments.length,1);
 const target=path.join(root,'blocked');await mkdir(path.join(target,'nubi-mail-raw'),{recursive:true});await writeFile(path.join(target,'nubi-mail-raw','occupied'),'x');
 await assert.rejects(mail.relocateRaw(target,{includeAttachments:true}),/mail_storage_not_empty/);assert.equal(mail.status().includeAttachments,false);
 await mail.call({action:'confirmStorage',includeAttachments:true});assert.equal(mail.status().includeAttachments,true);assert.deepEqual(await readFile(path.join(mail.rawRoot,row.id,'message.eml')),Buffer.from(download.bytes,'base64'),'preference never rewrites existing originals');
});
