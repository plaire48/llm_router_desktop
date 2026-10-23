import {prepareMailWikiAttachments} from './mail-wiki-attachments.mjs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {open,readFile} from 'node:fs/promises';
import {synthesizePersonalMail} from '../generated/openwiki.mjs';
import {modelTransport} from './recovery.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const ownedText=text=>Buffer.from(text,'utf8').toString('utf8');
// This multi-mail note is never substituted for selected-mail-only evidence.
export async function generateMailTopic(mail,{id,sourceHash}={}){
 if(mail.synthesis||mail.resetting||mail.disposed)throw Error('mail_busy');
 let selected=await mail.read(id);if(selected.sourceHash!==sourceHash)throw Error('mail_source_changed');
 const subject=selected.mail.subject;selected=null;
 const destination=mail.destination;
 const controller=new AbortController();mail.synthesis=controller;
 try{
  const card=mail.store.mailList.thread(id,{limit:50,offset:0}),sources=[],attachments=[];
  const items=card.items.some(item=>item.id===id)?card.items:[{id,sourceHash},...card.items.slice(0,49)];
  const allowance=Math.max(1200,Math.floor(72000/Math.max(1,items.length)));let projectionComplete=true;
  for(const item of items){
   if(controller.signal.aborted)throw Error('mail_cancelled');let source=await mail.read(item.id);if(source.sourceHash!==item.sourceHash)throw Error('mail_source_changed');
   if(source.mail.attachments?.length)source=await prepareMailWikiAttachments(mail,source,controller.signal);
   const readable=source.mail.attachments.filter(a=>['document_read','text_read'].includes(a.contentState)&&a.text?.trim());
   const partBudget=Math.max(256,Math.floor(allowance/(1+readable.length)));
   const sourcePartial=source.mail.truncated||source.mail.coverage?.complete===false||source.mail.coverage?.completeMessage===false||source.mail.coverage?.originalMimeAvailable===false||source.mail.coverage?.attachmentsRead===false;if(sourcePartial)projectionComplete=false;
   const body=String(source.mail.text||''),header=`메일 ID: ${source.id}\n메일 날짜: ${source.mail.date||'미확인'}\n발신: ${source.mail.from}\n`;
   if(body.length<=partBudget)attachments.push({id:source.id,contentState:'document_read',coverage:{complete:!sourcePartial},text:header+body});
   else{projectionComplete=false;const half=Math.floor(partBudget/2);attachments.push({id:source.id,contentState:'document_read',coverage:{complete:false},segments:[{text:header},{text:ownedText(body.slice(0,half))},{text:ownedText(body.slice(-half))}]});}
   for(const part of source.mail.attachments){
    const text=part.text||(part.segments||[]).map(s=>s.text||'').join('\n'),label=`첨부: ${part.filename||part.id} / 읽기: ${part.reader||'document_parser'} / 범위: ${typeof part.coverage==='string'?part.coverage:JSON.stringify(part.coverage||{})}\n`;
    if(['document_read','text_read'].includes(part.contentState)&&text.trim()){
     const complete=text.length<=partBudget&&part.partial!==true&&part.coverage?.complete!==false;if(!complete)projectionComplete=false;
     attachments.push({id:source.id+':'+part.id,contentState:part.contentState,coverage:{complete},segments:[{text:label},...(text.length<=partBudget?[{text}]:[{text:ownedText(text.slice(0,Math.floor(partBudget/2)))},{text:ownedText(text.slice(-Math.floor(partBudget/2)))}])]});
    }else{projectionComplete=false;attachments.push({id:source.id+':'+part.id,contentState:part.contentState||'not_read_in_topic'});}
   }
   // Retain receipts and small projections, never fifty complete large bodies.
   sources.push({id:source.id,sourceHash:source.sourceHash,mail:{subject:source.mail.subject,from:source.mail.from,date:source.mail.date,bodySource:source.mail.bodySource,coverage:source.mail.coverage,attachments:source.mail.attachments.map(a=>({id:a.id,filename:a.filename,sha256:a.sha256,contentState:a.contentState,reader:a.reader,coverage:a.coverage,evidenceHash:a.text?hash(a.text):null}))}});
  }
  const key=hash(JSON.stringify([card.thread,sources.map(s=>[s.id,s.sourceHash,s.mail.bodySource,s.mail.coverage,s.mail.attachments.map(a=>[a.id,a.sha256,a.contentState,a.reader,a.evidenceHash,a.coverage])]),destination]));
  const topicKey=hash(JSON.stringify([mail.store.get('mail:'+id)?.account||'',card.thread]));
  await mail.ensureWiki();if(mail.wikiVault&&!mail.wikiVault.active)throw Error('mail_encryption_unavailable');
  const cached=mail.store.get('mail-topic:'+topicKey);
  if(cached?.fingerprint===key){try{const file=mail.pagePath?mail.pagePath(cached.path):cached.path,bytes=await readFile(file);if(hash(bytes)===cached.wikiHash){const summary=/^---\n[\s\S]*?\n---\n# [^\n]*\n\n([\s\S]*?)\n\n## /u.exec(bytes.toString('utf8'))?.[1];if(summary)return {...cached,path:file,summary,cached:true};}}catch{}}
  if(!mail.modelAvailable(destination))throw Error('mail_model_missing');
  const host=mail.host,invoke=modelTransport({recoveryOptions:host.recoveryOptions,providers:{status:()=>({...host.providers.status(),...destination}),complete:(...args)=>{
   if(controller.signal.aborted||JSON.stringify(mail.destination)!==JSON.stringify(destination))throw Error('mail_model_changed');
   return host.providers.complete(...args.slice(0,6),{...args[6],backgroundModel:destination});
  }}},{signal:controller.signal});
  const summary=await synthesizePersonalMail({subject,sourceType:'mail_thread',documentKind:'여러 메일의 결정 이력과 명시된 요청',text:'',attachments},messages=>invoke(messages,[],controller.signal,'personal_mail_topic'),{verify:true});
  for(const source of sources){const current=await mail.read(source.id);if(current.sourceHash!==source.sourceHash)throw Error('mail_source_changed');for(const receipt of source.mail.attachments){const part=current.mail.attachments.find(a=>a.id===receipt.id);if(!part||part.sha256!==receipt.sha256)throw Error('mail_source_changed');if(part.originalStored!==false&&part.contentState!=='not_stored'&&typeof mail.readAttachmentBytes==='function'&&hash(await mail.readAttachmentBytes(current,part))!==receipt.sha256)throw Error('mail_source_changed');}}
  if(controller.signal.aborted||mail.disposed)throw Error('mail_cancelled');
  await mail.ensureWiki();
  const title=String(subject).replace(/[\r\n]/g,' '),text=`---\ntitle: ${JSON.stringify(title)}\nsourceType: mail_thread\n---\n# ${title}\n\n${summary.summary}\n\n## 확인한 내용\n\n${summary.facts.map(f=>'- '+f).join('\n')||'추가 확인 내용 없음'}\n\n## 요청과 후속 작업\n\n${summary.actionItems.map(f=>'- '+f).join('\n')||'명시된 요청 없음'}\n\n## 근거\n\n${sources.flatMap(s=>[`- ${s.mail.bodySource==='uia'?'UIA 읽기 기록':'메일 원문'} mail/${s.id} / ${s.mail.date||'날짜 미확인'} / SHA-256: ${s.sourceHash}`,...s.mail.attachments.map(a=>`  - ${String(a.filename||a.id).replace(/[\r\n]/g,' ')} / SHA-256: ${a.sha256} / ${a.reader||a.contentState||'미확인'} / ${String(typeof a.coverage==='string'?a.coverage:JSON.stringify(a.coverage||{})).replace(/[\r\n]/g,' ')}`)]).join('\n')}\n\n## 확인 범위\n\n대화 ${sources.length}/${card.count}통. ${sources.some(s=>s.mail.bodySource==='uia')?'UIA로 확인한 본문과 메타데이터 기준입니다. 원본 MIME 및 내려받지 않은 첨부 내용은 미확인입니다. ':''}${summary.coverage?.complete&&projectionComplete&&!card.hasMore?'읽은 자료 전체를 검토했습니다.':'일부 범위만 검토했습니다. 누락된 자료의 결정과 정정은 미확인입니다.'}\n`;
  const name=`topic-${hash(card.thread).slice(0,24)}-${hash(text).slice(0,16)}.md`,file=path.join(mail.wikiRoot,name);
  try{const handle=await open(file,'wx',0o600);try{await handle.writeFile(text);await handle.sync();}finally{await handle.close();}}catch(error){if(error.code!=='EEXIST'||hash(await readFile(file))!==hash(text))throw Error('mail_file_conflict');}
  await mail.wikiVault?.persist(name,text);
  if(hash(await readFile(file))!==hash(text))throw Error('mail_file_conflict');
  const record={fingerprint:key,path:file,wikiHash:hash(text),sources:sources.map(s=>({id:s.id,sourceHash:s.sourceHash,date:s.mail.date,bodySource:s.mail.bodySource,sourceCoverage:s.mail.coverage})),coverage:{...summary.coverage,messages:sources.length,totalMessages:card.count,complete:!!summary.coverage?.complete&&projectionComplete&&!card.hasMore},savedAt:new Date().toISOString()};
  mail.store.set('mail-topic:'+topicKey,record);return {...record,summary:summary.summary};
 }finally{if(mail.synthesis===controller)mail.synthesis=null;}
}
