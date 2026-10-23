import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PersonalMail} from './helpers-personal-mail.mjs';
import {normalizePortalMail} from '../runtime/mail-portal-content.mjs';
import {generateMailTopic} from '../runtime/mail-topic-wiki.mjs';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
const statement='이미지 원문에는 확정 예산이 7천만원이라고 적혀 있습니다.';
const raw=kind=>Buffer.from(kind==='CID'?['Subject: Image-only report','From: owner@example.test','To: reader@example.test','MIME-Version: 1.0','Content-Type: multipart/related; boundary="body"','','--body','Content-Type: text/html; charset=utf-8','','<img src="cid:report">','--body','Content-Type: image/png','Content-ID: <report>','Content-Disposition: inline','Content-Transfer-Encoding: base64','',png,'--body--',''].join('\r\n'):'Subject: Image-only report\r\nFrom: owner@example.test\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<img src="data:image/png;base64,'+png+'">');
async function fixture(t,kind,{vision=true,linked=false,onVision,review=true}={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'mail-image-wiki-')),calls=[],glm='GLM-5.2-NVFP4',qwen='QWEN3.8-27B-FP8-256K';
 const models=[{id:glm,supportsImages:false},...(vision?[{id:qwen}]:[])];
 const vault=new Map(),fallback=linked?'본문 이미지 자료':'Image-only report';
 const host={recoveryOptions:{model:{retries:0}},connectionVault:{get:async key=>vault.get(key)||null,set:async(key,value)=>vault.set(key,value)},storageRoot:path.join(root,'state'),mailSemanticReview:review,providers:{status:()=>({connected:true,provider:'aipro',model:glm,models}),catalogs:()=>[{provider:'aipro',models}],complete:async(messages,tools,signal,onText,onActivity,onHeartbeat,options)=>{
  calls.push({messages,options});
  if(messages.some(message=>Array.isArray(message.content))){assert.equal(options.visionModel,qwen);assert.equal(options.backgroundModel.model,qwen);await onVision?.(mail);return {content:statement,calls:[]};}
  assert.equal(options.backgroundModel.model,glm);assert(!JSON.stringify(messages).includes(png),'GLM receives extracted text, never image bytes');
  const payload=JSON.parse(messages.at(-1).content);
  if(messages[0].content.startsWith('REVIEW_PERSONAL_MAIL')){const quote=vision?statement:fallback,item=payload.windows.find(item=>item.text.includes(quote));assert(item);return {content:JSON.stringify({status:'ready',supports:[{target:'summary',source:item.source,quote}]})};}
  assert.match(JSON.stringify(payload),vision?/7천만원/:/complete":false/);
  return {content:JSON.stringify({summary:vision?statement:fallback,category:'information',priority:'medium',facts:[],actionItems:[]})};
 }}};
 const mail=new PersonalMail(host,{personalRoot:path.join(root,'mail')});mail.autoWiki=false;clearInterval(mail.processingTimer);mail.destination={provider:'aipro',model:glm};
 t.after(async()=>{mail.dispose();await Promise.all([mail.rawDisposed,mail.wikiDisposed]);await rm(root,{recursive:true,force:true});});
 const bytes=linked?Buffer.from('Subject: Remote image\r\nContent-Type: text/html\r\n\r\n<p>본문 이미지 자료</p><img src="https://images.example.test/report.png">'):(kind==='missing'?Buffer.from('Subject: Image-only report\r\nContent-Type: text/html\r\n\r\n<img src="cid:missing">'):raw(kind));
 const parsed=await normalizePortalMail(bytes);await mail.intake({mails:[{...parsed,uidl:'image-mail',protocol:'local'}]},mail.generation,{collectOnly:true,accountId:'fixture'});
 await mail.ensureWiki();const source=await mail.read(mail.rows()[0].id);return {mail,source,calls,glm,qwen};
}
for(const kind of ['CID','data'])for(const flow of ['automatic','topic'])test(`${flow} wiki reads ${kind} body images with Qwen and writes with the selected GLM`,async t=>{
 const {mail,source,calls,glm}=await fixture(t,kind);let file;
 if(flow==='automatic'){
  mail.store.set('mail:'+source.id,{...mail.rows()[0],attachmentState:'complete'});mail.autoWiki=true;await mail.drain();mail.autoWiki=false;const row=mail.rows()[0];assert.equal(row.state,'saved');file=mail.pagePath(row.path);
 }else file=(await generateMailTopic(mail,{id:source.id,sourceHash:source.sourceHash})).path;
 const text=await readFile(file,'utf8');assert.match(text,/7천만원/);assert(text.includes(source.mail.inlineImages[0].sha256));assert(!text.includes(png));assert.equal(calls.filter(call=>call.messages.some(message=>Array.isArray(message.content))).length,1);assert.equal(mail.destination.model,glm);assert.equal((await mail.read(source.id)).mail.attachments.length,0);
 const extraction=(await mail.read(source.id)).mail.inlineImages[0];assert.equal(extraction.reader,'vision_model');assert.match(extraction.text,/7천만원/);
 const count=calls.length;await generateMailTopic(mail,{id:source.id,sourceHash:source.sourceHash});assert.equal(calls.filter(call=>call.messages.some(message=>Array.isArray(message.content))).length,1);assert(calls.length>=count);
});
test('unavailable image models leave incomplete evidence rather than marking images as read',async t=>{
 const {mail,source,calls}=await fixture(t,'data',{vision:false});
 const result=await generateMailTopic(mail,{id:source.id,sourceHash:source.sourceHash});assert.equal(result.coverage.complete,false);assert.equal(calls.some(call=>call.messages.some(message=>Array.isArray(message.content))),false);assert.notEqual((await mail.read(source.id)).mail.inlineImages[0].contentState,'document_read');
});
test('remote-only body images make Wiki coverage explicitly incomplete',async t=>{
 const {mail,source}=await fixture(t,'data',{vision:false,linked:true});const result=await generateMailTopic(mail,{id:source.id,sourceHash:source.sourceHash});assert.equal(result.coverage.complete,false);assert.match(await readFile(result.path,'utf8'),/본문 이미지.*미확인/);
});

test('changed image source cannot be cached or published after model reading',async t=>{
 const {mail,source}=await fixture(t,'data',{onVision:async service=>{await service.rawVault.write(path.join(service.rawRoot,service.rows()[0].id,'message.eml'),Buffer.from('changed'));}});
 await assert.rejects(generateMailTopic(mail,{id:source.id,sourceHash:source.sourceHash}),/mail_source_changed/);assert.equal(mail.store.get('attachment:'+source.id+':'+source.mail.inlineImages[0].id),null);assert.equal(mail.store.list('mail-topic:').length,0);
});
test('cancellation during Qwen reading leaves no successful image receipt or Wiki',async t=>{
 const {mail,source}=await fixture(t,'CID',{onVision:async service=>service.synthesis.abort()});
 await assert.rejects(generateMailTopic(mail,{id:source.id,sourceHash:source.sourceHash}),/mail_cancelled|cancelled/);assert.equal(mail.store.get('attachment:'+source.id+':'+source.mail.inlineImages[0].id),null);assert.equal(mail.store.list('mail-topic:').length,0);
});

test('folder import accepts image-only MIME and data bodies while preserving empty-mail rejection',async t=>{
 const {mail}=await fixture(t,'CID');const folder=await mkdtemp(path.join(os.tmpdir(),'body-only-import-'));t.after(()=>rm(folder,{recursive:true,force:true}));
 await writeFile(path.join(folder,'cid.eml'),raw('CID'));await writeFile(path.join(folder,'data.eml'),raw('data'));await writeFile(path.join(folder,'empty.eml'),'Subject: Empty\r\n\r\n');
 await mail.startFolderImport(folder);await mail.importTask;assert.equal(mail.importProgress.imported,2);assert.equal(mail.importProgress.failures.length,1);assert.equal(mail.importProgress.failures[0].error,'mail_import_empty');
 for(const row of mail.rows().filter(row=>row.uidl!=='image-mail')){const source=await mail.read(row.id);assert.equal(source.mail.attachments.length,0);assert.equal(source.mail.inlineImages.length,1);}
});

test('automatic Wiki without semantic review still receives one text projection, never binary image input',async t=>{
 const {mail,source,calls}=await fixture(t,'data',{review:false});mail.store.set('mail:'+source.id,{...mail.rows()[0],attachmentState:'complete'});mail.autoWiki=true;await mail.drain();mail.autoWiki=false;assert.equal(mail.rows()[0].state,'saved');
 const call=calls.find(call=>typeof call.messages.at(-1).content==='string'&&!call.messages[0].content.startsWith('REVIEW_PERSONAL_MAIL')),input=JSON.parse(call.messages.at(-1).content);assert.equal(input.inlineImages,undefined);assert.equal(input.attachments.length,1);assert.match(input.attachments[0].text,/7천만원/);
});

test('missing CID bytes remain incomplete instead of silently treating an image-only body as fully read',async t=>{
 const {mail,source,calls}=await fixture(t,'missing',{vision:false});const result=await generateMailTopic(mail,{id:source.id,sourceHash:source.sourceHash});assert.equal(result.coverage.complete,false);assert.match(await readFile(result.path,'utf8'),/본문 이미지.*미확인/);assert.equal(calls.some(call=>call.messages.some(message=>Array.isArray(message.content))),false);
});
