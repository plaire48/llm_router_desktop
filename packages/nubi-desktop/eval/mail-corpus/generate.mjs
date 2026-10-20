// Evaluation-only DTOs. No company sources, network, credentials or model calls.
import {createHash} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {finished} from 'node:stream/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const sha=value=>createHash('sha256').update(value).digest('hex');
const pad=(value,size=6)=>String(value).padStart(size,'0');
const messageId=i=>`m${pad(i)}`;
export function corpusOptions(input={}){
  const options={count:300000,threads:20000,people:500,seed:21,...input};
  if(Object.keys(options).some(key=>!['count','threads','people','seed'].includes(key))
    ||Object.values(options).some(value=>!Number.isSafeInteger(value)||value<0)
    ||options.count<1||options.count>300000||options.threads<1||options.threads>options.count
    ||options.people<1||options.people>options.count)throw Error('corpus_options');
  return options;
}
export function mailRecord(index,input={}){
  const options=corpusOptions(input);
  if(!Number.isSafeInteger(index)||index<0||index>=options.count)throw Error('corpus_index');
  const thread=index%options.threads, reply=Math.floor(index/options.threads);
  const person=(thread+reply*17)%options.people, id=messageId(index);
  const threadId=`thread${pad(thread)}`, language=thread%2?'en':'ko';
  const unique=`message${pad(index)}seed${options.seed}`, bodyKey=`detail${pad(index)}seed${options.seed}`;
  const start=Date.UTC(2016,0,1), end=Date.UTC(2026,0,1);
  const date=new Date(start+Math.floor(thread/options.threads*(end-start-7*86400000))+reply*3600000).toISOString();
  const subject=`${reply?'Re: ':''}${threadId} ${language==='ko'?'합성 변경 검토':'Synthetic change review'}`;
  const text=[`${unique} ${bodyKey}`,language==='ko'
    ?'이 문서는 측정용 합성 메일입니다. 가상 변경 요청의 범위와 담당 역할, 검토 결과를 정리합니다.'
    :'This synthetic message records the scope, review and ownership of a fictional change.',
    ...Array.from({length:8},(_,i)=>`${language==='ko'?'검토 항목':'Review item'} ${i+1}: ${threadId} ${reply%3===0?'approved':reply%3===1?'pending':'revised'}; ${language==='ko'?'근거 확인 뒤 다음 단계 진행':'verify evidence before the next step'}.`)
  ].join('\n');
  const mail={subject,from:`Synthetic ${pad(person,3)} <person${pad(person,3)}@example.invalid>`,
    to:`Synthetic ${pad((person+1)%options.people,3)} <person${pad((person+1)%options.people,3)}@example.invalid>`,cc:'',date,text,
    messageId:`<${id}@example.invalid>`,inReplyTo:reply?`<${messageId(index-options.threads)}@example.invalid>`:null,
    references:reply?[`<${messageId(thread)}@example.invalid>`]:[],
    attachments:index%5===0?[{id:`attachment-${id}`,filename:`synthetic-${unique}.pdf`,contentType:'application/pdf',size:1024+(index%8192),contentState:'metadata_only'}]:[]};
  const sourceHash=sha(JSON.stringify(mail));
  return {threadId,language,row:{id,sourceHash,date,fetchedAt:date,state:'saved',mailbox:'inbox',protocol:'local',recipientRole:'to'},mail};
}
export function corpusQuestions(input={}){
  const options=corpusOptions(input), kinds=['message','thread','body','attachment','metadata','absent'];
  return Array.from({length:240},(_,n)=>{
    const kind=kinds[n%kinds.length], i=kind==='attachment'
      ?Math.floor((Math.floor(n/6)*7907%options.count)/5)*5:(Math.floor(n/6)*7907+n)%options.count;
    const record=mailRecord(i,options), unique=`message${pad(i)}seed${options.seed}`;
    const expectedIds=kind==='absent'?[]:kind==='thread'
      ?Array.from({length:Math.ceil((options.count-i%options.threads)/options.threads)},(_,k)=>messageId(i%options.threads+k*options.threads))
      :[record.row.id];
    const query=kind==='thread'?record.threadId:kind==='absent'?`absentrecord${pad(n)}`
      :kind==='body'?`detail${pad(i)}seed${options.seed}`:kind==='metadata'?`${unique} person`
      :kind==='attachment'?record.mail.attachments[0].filename:unique;
    return {id:`q${pad(n,3)}`,kind,query,expectedIds};
  });
}
export async function writeCorpus(directory,input={}){
  const options=corpusOptions(input);
  await mkdir(directory,{recursive:true});
  const output=createWriteStream(path.join(directory,'mail.jsonl'),{flags:'wx',mode:0o600});
  // Register the error listener before open; do not leave an unhandled rejection.
  const done=finished(output);done.catch(()=>{});
  const hash=createHash('sha256');let bytes=0;
  try{
    await once(output,'open');
    for(let i=0;i<options.count;i++){
      const line=JSON.stringify(mailRecord(i,options))+'\n';
      hash.update(line);bytes+=Buffer.byteLength(line);
      if(!output.write(line))await once(output,'drain');
    }
    output.end();await done;
  }catch(error){output.destroy();await done.catch(()=>{});throw error;}
  const manifest={version:1,scope:'synthetic_mail_dto_not_mime_or_attachment_bytes',...options,
    dateRange:['2016-01-01','2025-12-31'],bytes,sha256:hash.digest('hex'),modelCalls:0};
  await writeFile(path.join(directory,'questions.json'),JSON.stringify(corpusQuestions(options),null,2)+'\n',{flag:'wx'});
  await writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  if(!process.argv[2])throw Error('Usage: node generate.mjs OUTPUT_DIRECTORY');
  console.log(JSON.stringify(await writeCorpus(path.resolve(process.argv[2]))));
}
