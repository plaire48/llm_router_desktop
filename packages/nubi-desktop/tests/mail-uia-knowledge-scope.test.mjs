import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,readFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {Store} from '../runtime/store.mjs';import {MailSearch} from '../runtime/mail-search.mjs';import {generateMailTopic} from '../runtime/mail-topic-wiki.mjs';
const coverage={scope:'open_message',completeMailbox:false,originalMimeAvailable:false,attachmentsRead:false};
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'uia-knowledge-scope-')),store=new Store(root,{mailList:true});t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});return {root,store};}
test('UIA search remains partial when no attachment bytes have been observed',async t=>{
 const {store}=await fixture(t),values=new Map(),source={subject:'UIA 자료',from:'owner@example.test',text:'UiaNeedle 보안 검토',bodySource:'uia',coverage,attachments:[]};store.set('mail:a',{id:'a',sourceHash:'ha',account:'fixture',state:'collected',listMetadata:{sourceHash:'ha',subject:source.subject,attachments:[]}});
 const owner={store,host:{connectionVault:{get:async k=>values.get(k),set:async(k,v)=>values.set(k,v)}},rows(){throw Error('whole_mailbox_read');},read:async()=>({mail:source}),readKnowledge:async()=>({text:''}),searchSignature:async()=> 'ha'};
 const search=new MailSearch(owner);t.after(()=>search.dispose());const packet=await search.search({query:'UiaNeedle'});assert.equal(packet.results[0].id,'a');assert.equal(packet.retrieval.incomplete,true);assert(packet.retrieval.reasons.includes('incomplete_source_content'));
});
test('a saved topic identifies UIA records and never reports complete original coverage',async t=>{
 const {root,store}=await fixture(t),source={id:'a',sourceHash:'ha',mail:{subject:'UIA 자료',from:'owner@example.test',text:'보안 검토는 진행 중입니다.',bodySource:'uia',coverage,attachments:[]}};
 store.set('mail:a',{id:'a',sourceHash:'ha',account:'fixture',state:'collected',listMetadata:{sourceHash:'ha',subject:source.mail.subject,attachments:[]}});
 const providers={status:()=>({provider:'fixture',model:'fixture'}),complete:async messages=>({content:JSON.stringify(messages[0].content.startsWith('REVIEW_PERSONAL_MAIL')?{status:'ready',supports:[{target:'summary',source:'attachment:a',quote:source.mail.text}]}:{summary:source.mail.text,category:'status',priority:'medium',facts:[],actionItems:[]})})};
 const mail={store,wikiRoot:root,host:{providers},destination:{provider:'fixture',model:'fixture'},modelAvailable:()=>true,ensureWiki:async()=>{},read:async()=>source};const result=await generateMailTopic(mail,{id:'a',sourceHash:'ha'});assert.equal(result.coverage.complete,false);assert.match(await readFile(result.path,'utf8'),/UIA 읽기 기록/);
});
