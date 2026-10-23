import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {Store} from '../runtime/store.mjs';import {generateMailTopic} from '../runtime/mail-topic-wiki.mjs';
test('thread wiki preserves opposed originals, saves once and reuses only unchanged evidence',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'mail-topic-')),store=new Store(root,{mailList:true});let calls=0,changed=false;
 t.after(async()=>{store.close();await rm(root,{recursive:true,force:true});});
 const sources={a:{id:'a',sourceHash:'ha',mail:{subject:'Atlas',from:'owner@example.test',date:'2026-10-01',text:'배포를 최종 승인합니다.',attachments:[]}},b:{id:'b',sourceHash:'hb',mail:{subject:'Re: Atlas',from:'reviewer@example.test',date:'2026-10-02',text:'승인 여부는 확인하지 못했습니다.',attachments:[]}}};
 for(const [id,s] of Object.entries(sources))store.set('mail:'+id,{id,account:'fixture',sourceHash:s.sourceHash,state:'indexed',listMetadata:{sourceHash:s.sourceHash,subject:s.mail.subject,from:s.mail.from,date:s.mail.date,messageId:'<'+id+'>',...(id==='b'?{inReplyTo:'<a>',references:['<a>']}:{}),attachments:[]}});
 const providers={status:()=>({provider:'fixture',model:'fixture'}),complete:async messages=>{calls++;if(messages[0].content.includes('REVIEW_PERSONAL_MAIL'))return {content:JSON.stringify({status:'ready',supports:[{target:'summary',source:'attachment:a',quote:'배포를 최종 승인합니다.'},{target:'summary',source:'attachment:b',quote:'승인 여부는 확인하지 못했습니다.'}]})};return {content:JSON.stringify({summary:'10월 1일 승인 진술과 10월 2일 미확인 진술이 함께 있습니다.',category:'decision',priority:'high',facts:[],actionItems:[]})};}};
 const mail={store,wikiRoot:root,host:{providers,recoveryOptions:{}},destination:{provider:'fixture',model:'fixture'},modelAvailable:()=>true,ensureWiki:async()=>{},read:async id=>changed&&id==='b'?{...sources[id],sourceHash:'changed'}:sources[id]};
 const first=await generateMailTopic(mail,{id:'a',sourceHash:'ha'});assert((await readFile(first.path,'utf8')).includes('미확인 진술'));assert.equal(first.sources.length,2);assert.equal(calls,2);
 assert(!JSON.stringify(store.list('mail-topic:')).includes(first.summary),'the ordinary metadata DB must not become a plaintext summary cache');
 const again=await generateMailTopic(mail,{id:'a',sourceHash:'ha'});assert.equal(again.cached,true);assert.equal(again.summary,first.summary);assert.equal(calls,2);
 changed=true;await assert.rejects(generateMailTopic(mail,{id:'a',sourceHash:'ha'}),/mail_source_changed/);
});
