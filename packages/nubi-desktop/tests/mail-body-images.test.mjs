import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PersonalMail} from './helpers-personal-mail.mjs';
import {normalizePortalMail} from '../runtime/mail-portal-content.mjs';
import {installDesktopFeatures} from '../runtime/desktop-features.mjs';
import {readMailAttachmentsForAgent} from '../runtime/mail-agent-attachments.mjs';
import {AnswerSources} from '../runtime/answer-sources.mjs';

const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
const raw=Buffer.from(['Subject: Image report','From: sender@example.test','To: owner@example.test','MIME-Version: 1.0','Content-Type: multipart/related; boundary="body"','','--body','Content-Type: text/html; charset=utf-8','','<p>보고서</p><img src="cid:chart" alt="매출 그래프"><p>끝</p>','--body','Content-Type: image/png','Content-ID: <chart>','Content-Disposition: inline','Content-Transfer-Encoding: base64','',png,'--body--',''].join('\r\n'));

test('portal presentation restores CID bytes without inventing a file attachment',async()=>{
 const parsed=await normalizePortalMail(raw,{includePresentation:true});
 assert.equal(parsed.presentation.images.length,1);assert.equal(parsed.presentation.images[0].cid,'chart');
 assert.equal(parsed.presentation.images[0].src,'data:image/png;base64,'+png);assert.equal(parsed.attachments[0].presentation,'inline');
});

for(const [kind,input] of [['CID',raw],['data',Buffer.from('Subject: Data image\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>보고서</p><img src="data:image/png;base64,'+png+'">')]])test(kind+' body images reach vision, retain citations and reuse verified extraction',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mail-body-images-')),calls=[];
 class Host{}installDesktopFeatures(Host);const host=new Host();host.storageRoot=root;
 host.providers={status:()=>({connected:true,provider:'chatgpt',model:'vision',models:[{id:'vision',supportsImages:true}]}),catalogs:()=>[],complete:async messages=>{calls.push(messages);return {content:'매출 그래프: 1월 120만원, 2월 180만원.',calls:[]};}};
 const mail=host.personalMail=new PersonalMail(host,{personalRoot:path.join(root,'mail')});mail.autoWiki=false;
 t.after(async()=>{mail.dispose();await mail.wikiDisposed;await rm(root,{recursive:true,force:true});});
 await mail.call({action:'portalConnect',identity:'test',email:'owner@example.test',folders:[]});
 await mail.call({action:'portalImport',uid:'portal:1:1',raw:input.toString('base64'),size:input.length,folder:{id:'1',mailbox:'inbox'}});
 const id=mail.rows()[0].id,source=await mail.read(id,{includePresentation:true});
 assert.equal(source.mail.attachments.length,0);assert.equal(source.mail.inlineImages.length,1);assert.equal(source.mail.presentation.images.length,1);
 const evidence=await readMailAttachmentsForAgent(host,await mail.read(id));
 assert.equal(calls.length,1);assert.equal(calls[0].find(item=>item.role==='user').content[1].image_url.url,'data:image/png;base64,'+png);
 assert.match(evidence.mail.attachments[0].text,/180만원/);assert.equal(evidence.mail.attachments[0].presentation,'inline');assert(!JSON.stringify(evidence).includes(png));
 const citation=new AnswerSources().mail(evidence).find(item=>item.attachmentId);assert.equal(citation.preview,'image');
 await mail.evidence(citation);
 const preview=await host.mailDocument({id,attachmentId:citation.attachmentId,expectedSourceHash:source.sourceHash,expectedAttachmentHash:citation.attachmentHash,action:'previewImage'});assert.equal(preview.image,'data:image/png;base64,'+png);
 await readMailAttachmentsForAgent(host,await mail.read(id));assert.equal(calls.length,1);
 assert.equal((await mail.read(id)).mail.attachments.length,0);
 await assert.rejects(host.mailDocument({id,attachmentId:citation.attachmentId,expectedSourceHash:'changed',action:'analyze'}),/mail_source_changed/);
});
