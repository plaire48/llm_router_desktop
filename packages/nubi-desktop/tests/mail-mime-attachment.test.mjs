import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {extractDocument} from '../runtime/document-extract.mjs';
import {normalizePortalMail} from '../runtime/mail-portal-content.mjs';
import {PersonalMail} from './helpers-personal-mail.mjs';
import {ProjectService} from '../runtime/project-service.mjs';

import {inner,outer,child,body} from './fixtures-mail-mime.mjs';

test('MIME contents select the shared message parser even with a generic filename',async()=>{
  const doc=await extractDocument(inner,'export.dat','application/octet-stream');
  assert.match(doc.text,/내부 메일 본문/);assert.doesNotMatch(doc.text,/actual attachment bytes|Content-Type:|--inner/);
  assert.equal(doc.reader,'mime_mail');assert.match(doc.coverage,/첨부.*별도/);
  const text=await extractDocument(Buffer.from('Subject: notes\n\njust a text file'),'notes.txt');
  assert.match(text.text,/Subject: notes/,'a text note is not a MIME mail by subject alone');
  await assert.rejects(extractDocument(Buffer.from(body),'fake.mysingle'),/document_format/);
});

test('MIME attachment text keeps continuation evidence beyond the normal mail list preview',async()=>{
  const text='긴 메일 본문 '.repeat(12000)+'FINAL EVIDENCE';
  const raw=Buffer.from('Subject: Long MIME attachment\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n'+text);
  const doc=await extractDocument(raw,'generic.bin');assert(doc.text===text,'the complete MIME body must survive parsing');
  const fake=await extractDocument(Buffer.from('not MIME\nMIME-Version: 1.0\nContent-Type: text/plain\nSubject: fake\n\ntext'),'notes.txt');
  assert.match(fake.text,/not MIME/);
});

test('MIME attachment opens as a mail, lists only real inner attachments, and downloads exact child bytes',async t=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'nubi-mime-attachment-')),root=path.join(temp,'project');await mkdir(root);await writeFile(path.join(root,'app.txt'),'source');
  const service=new ProjectService({storageRoot:path.join(temp,'state')});let mail;
  t.after(async()=>{service.dispose();service.store?.close();mail?.dispose();await mail?.rawDisposed;await mail?.wikiDisposed;await rm(temp,{recursive:true,force:true});});
  await service.open(root,{initializeWiki:false});
  mail=new PersonalMail({storageRoot:path.join(temp,'state')},{personalRoot:path.join(temp,'mail')});mail.autoWiki=false;service.personalMail=mail;
  await mail.intake({mails:[{...await normalizePortalMail(outer()),protocol:'local',uidl:'fixture'}]},mail.generation,{collectOnly:true});
  const original=await mail.read(mail.rows()[0].id),attachment=original.mail.attachments[0];
  const doc=await service.mailDocument({id:original.id,attachmentId:attachment.id,expectedSourceHash:original.sourceHash,expectedAttachmentHash:attachment.sha256});
  assert.equal(doc.kind,'mail_message');assert.equal(doc.mailMessage.subject,'Inner message');
  assert.match(doc.text,/내부 메일 본문/);assert.deepEqual(doc.mailMessage.attachments.map(p=>p.filename),['notes.txt']);
  assert(!doc.mailMessage.attachments.some(p=>/body|html|mysingle|export/.test(p.filename)));
  const part=doc.mailMessage.attachments[0];
  const args={id:original.id,kind:'attachment',attachmentId:attachment.id,expectedSourceHash:original.sourceHash,expectedAttachmentHash:attachment.sha256,innerAttachmentId:part.id,expectedInnerHash:part.sha256};
  const saved=await mail.download(args);assert.equal(saved.filename,'notes.txt');assert.deepEqual(Buffer.from(saved.bytes,'base64'),child);
  await assert.rejects(mail.download({...args,expectedInnerHash:'0'.repeat(64)}),/mail_source_changed/);
  await assert.rejects(mail.download({...args,innerAttachmentId:'body.html'}),/mail_source_changed/);
  assert.equal((await mail.read(original.id)).mail.text,original.mail.text);
  assert.deepEqual(Buffer.from((await mail.download({...args,innerAttachmentId:undefined,expectedInnerHash:undefined})).bytes,'base64'),inner);
});
