import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {PersonalMail} from './helpers-personal-mail.mjs';
import {installDesktopFeatures} from '../runtime/desktop-features.mjs';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');

// Attachment reading is on since 1.2.1 (user decision 2026-10-14). The release policy test now checks that the
// gates are open and that downloads stay byte-exact; the reading itself is covered by mail-knowledge and mail-search.
test('mail attachment reading is on and the feature gates no longer refuse attachment access',async t=>{
  assert.equal(DESKTOP_FEATURES.mailAttachmentReading,true);
  const root=await mkdtemp(path.join(os.tmpdir(),'nubi-mail-beta-'));
  const host={storageRoot:path.join(root,'state'),agent:{running:true},providers:{
    status:()=>({connected:true,provider:'fixture',model:'fixture'}),
    catalogs:()=>[{provider:'fixture',models:[{id:'fixture'}]}],
    complete:async()=>({content:JSON.stringify({summary:'본문 예산 요청',category:'direct_request',priority:'high',facts:['메일 본문에 예산 요청이 있다.'],actionItems:[]})})
  }};
  const mail=new PersonalMail(host,{personalRoot:path.join(root,'mail')});
  t.after(async()=>{mail.dispose();await Promise.all([mail.rawDisposed,mail.wikiDisposed]);await rm(root,{recursive:true,force:true});});
  mail.autoWiki=true;mail.paused=false;mail.account='fixture-account';mail.credentials={};mail.destination={provider:'fixture',model:'fixture'};
  mail.store.set('account:'+mail.account,{seen:[]});
  await mkdir(mail.wikiRoot,{recursive:true});
  const bytes=Buffer.from('ATTACHMENT_PRIVATE_TEXT'),attachment={id:'001-'+sha(bytes).slice(0,16),filename:'Budget.txt',contentType:'text/plain',sha256:sha(bytes),contentState:'text_read',text:bytes.toString(),size:bytes.length};
  await mail.intake({uidls:['one'],mails:[{uidl:'one',raw:Buffer.from('Original MIME'),attachments:[{...attachment,content:bytes}],normalized:{subject:'예산 확인',from:'sender@example.invalid',text:'본문 예산 요청',attachments:[attachment]}}]},mail.generation);
  host.agent.running=false;for(let i=0;i<200&&(mail.attachmentRead||!mail.store.get('attachment:'+mail.rows()[0].id+':'+attachment.id));i++)await new Promise(r=>setTimeout(r,25));await mail.readAttachments();await mail.drain();
  const row=mail.rows()[0];
  assert.equal(mail.store.get('attachment:'+row.id+':'+attachment.id)?.state,'complete','the text attachment is read with the mail');
  const downloaded=await mail.download({id:row.id,attachmentId:attachment.id,kind:'attachment',expectedSourceHash:row.sourceHash});
  assert.deepEqual(Buffer.from(downloaded.bytes,'base64'),bytes);
  class Host {} installDesktopFeatures(Host);
  await new Host().mailDocument({id:row.id,attachmentId:attachment.id}).catch(error=>assert.notEqual(error.message,'mail_attachment_beta_disabled'));
  const evidence=await mail.evidence({id:row.id,sourceHash:row.sourceHash,attachmentId:attachment.id});
  assert.equal(evidence.attachmentId,attachment.id);assert.equal(evidence.attachmentHash,attachment.sha256);
});
