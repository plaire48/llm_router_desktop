import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {PersonalMail} from './helpers-personal-mail.mjs';
import {mailAttentionInfo,mailAttentionRowInfo} from '../ui/mail-attention-state.mjs';
import {parsePop3Content} from '../../openwiki/src/connectors/sources/pop3-content.mjs';
async function fixture(t,extra={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-mail-attention-')),host={storageRoot:path.join(root,'state'),...extra.host},options={personalRoot:path.join(root,'mail'),...extra.options};
 let mail=new PersonalMail(host,options);
 t.after(async()=>{await mail.dispose();await rm(root,{recursive:true,force:true});});
 return {mail,host,options,reopen(){mail.dispose();mail=new PersonalMail(host,options);return mail;}};
}
const row=(id,error='mail_summary_failed')=>({id,account:'owner',state:'attention',subject:'Contract '+id,from:'Alice <alice@example.test>',sourceHash:'retained-source-'+id,uidl:'PRIVATE_UIDL_'+id,path:'PRIVATE_STORAGE_PATH',error});

test('lightweight status omits message lists while retaining counts and progress',async t=>{
 const {mail}=await fixture(t);mail.account='owner';mail.autoWiki=false;
 mail.store.set('mail:saved',{...row('saved'),state:'saved',error:null,attachmentState:'complete'});
 const status=await mail.call({action:'status',includeMessages:false});
 assert.equal(Object.hasOwn(status,'messages'),false);assert.equal(status.counts.received,1);assert.equal(status.progress.completed,1);
 assert.equal((await mail.call({action:'status'})).messages[0].id,'saved');
});

test('attention pages show only active-account display facts and bounded server failures',async t=>{
 const {mail}=await fixture(t);mail.account='owner';
 for(let i=0;i<23;i++)mail.store.set('mail:'+i,row(String(i)));
 mail.store.set('mail:other',{...row('other'),account:'other'});mail.store.set('mail:cancelled',row('cancelled','mail_cancelled'));
 mail.store.set('account:owner',{rejected:[{uidl:'PRIVATE_SERVER_ID',error:'mail_retrieval_failed'},{uidl:'PRIVATE_CANCEL_ID',error:'mail_cancelled'}]});
 const first=await mail.call({action:'attention'}),second=await mail.call({action:'attention',offset:10}),last=await mail.call({action:'attention',offset:20});
 assert.equal(first.total,23);assert.equal(first.items.length,10);assert.equal(second.items.length,10);assert.equal(last.items.length,3);
 assert.equal(new Set([...first.items,...second.items,...last.items].map(item=>item.id)).size,23);
 assert.deepEqual(first.retrieval,{count:1,errors:['mail_retrieval_failed']});assert.doesNotMatch(JSON.stringify(first),/PRIVATE|uidl|path/);
 assert.equal(first.status.progress.attention,first.total+first.retrieval.count);
});

test('attachment-only failures appear in the same attention snapshot and retry preserves saved wiki',async t=>{
 const {mail}=await fixture(t);mail.account='owner';mail.autoWiki=false;
 const attachment={...row('attachment'),state:'saved',error:null,path:'wiki/saved.md',attachmentState:'attention',attachmentFailures:[{id:'file',filename:'계약서.docx',error:'document_timeout'}]};
 mail.store.set('mail:attachment',attachment);
 mail.store.set('mail:both',{...row('both'),attachmentState:'attention',attachmentFailures:[{filename:'표.xlsx',error:'document_password'}]});
 mail.store.set('mail:cancelled',row('cancelled','mail_cancelled'));
 mail.store.set('mail:cancelled-file',{...row('cancelled-file'),state:'saved',error:null,attachmentState:'attention',attachmentFailures:[{error:'mail_cancelled'}]});
 mail.store.set('mail:other',{...attachment,id:'other',account:'other'});
 const page=await mail.call({action:'attention'});
 assert.equal(page.total,2);assert.equal(page.status.progress.attention,2);assert.equal(page.status.counts.attentionTotal,2);
 assert.equal(page.status.counts.attention,1);assert.equal(page.status.counts.attachmentAttention,2);
 const item=page.items.find(item=>item.id==='attachment');assert.equal(item.summary,false);assert.equal(item.error,'document_timeout');
 const info=mailAttentionRowInfo(item);assert.equal(info.attachmentsOnly,true);assert.equal(info.action,'retry');assert.match(info.title,/계약서.docx/);
 await mail.call({action:'retry',id:'attachment'});
 const after=mail.store.get('mail:attachment');assert.equal(after.attachmentState,'queued');assert.equal(after.state,'saved');assert.equal(after.path,attachment.path);assert.equal(after.sourceHash,attachment.sourceHash);
 const refreshed=await mail.call({action:'attention'});assert.equal(refreshed.total,1);assert.equal(refreshed.status.progress.attention,1);
});

test('local attachment issues remain visible and changed originals cannot be retried',async t=>{
 const {mail}=await fixture(t);mail.account='owner';mail.autoWiki=false;
 const item={...row('local'),account:'folder',protocol:'local',state:'saved',error:null,attachmentState:'attention',attachmentFailures:[{filename:'자료.pdf',error:'mail_source_changed'}]};
 mail.store.set('mail:local',item);
 const page=await mail.call({action:'attention'});assert.equal(page.total,1);assert.equal(page.status.progress.attention,1);assert.equal(mailAttentionRowInfo(page.items[0]).action,'source');
 await assert.rejects(mail.call({action:'retry',id:'local'}),/mail_source_changed/);
 await mail.call({action:'retry'});assert.deepEqual(mail.store.get('mail:local'),item);
 mail.store.set('mail:local',{...item,attachmentState:'complete',attachmentFailures:[]});
 const resolved=await mail.call({action:'attention'});assert.equal(resolved.total,0);assert.equal(resolved.status.progress.attention,0);
});
test('retrying one failed mail preserves other failures and changed originals cannot be retried',async t=>{
 const {mail}=await fixture(t);mail.account='owner';mail.autoWiki=false;
 const a=row('a'),b=row('b'),changed=row('changed','mail_source_changed'),other={...row('other'),account:'other'};
 for(const item of [a,b,changed,other])mail.store.set('mail:'+item.id,item);
 await mail.call({action:'retry',id:'a'});assert.equal(mail.store.get('mail:a').state,'queued');assert.equal(mail.store.get('mail:a').sourceHash,a.sourceHash);
 assert.deepEqual(mail.store.get('mail:b'),b);assert.deepEqual(mail.store.get('mail:changed'),changed);assert.deepEqual(mail.store.get('mail:other'),other);
 await assert.rejects(mail.call({action:'retry',id:'changed'}),/mail_source_changed/);await assert.rejects(mail.call({action:'retry',id:'other'}),/mail_source_changed/);
 assert.deepEqual(mail.store.get('mail:changed'),changed);
});
test('historical cancellations return to the queue after restart without becoming failures',async t=>{
 const f=await fixture(t),cancelled=row('cancelled','mail_cancelled'),failed=row('failed');f.mail.store.set('mail:cancelled',cancelled);f.mail.store.set('mail:failed',failed);
 const restored=f.reopen();assert.equal(restored.store.get('mail:cancelled').state,'queued');assert.equal(restored.store.get('mail:cancelled').error,null);
 assert.equal(restored.store.get('mail:cancelled').sourceHash,cancelled.sourceHash);assert.deepEqual(restored.store.get('mail:failed'),failed);
 assert.equal((await restored.call({action:'attention'})).total,1);
});
test('pausing a live collection cancels its request without a server-failure record',async t=>{
 let entered,reject;const started=new Promise(resolve=>{entered=resolve;});
 const {mail}=await fixture(t,{options:{pull:()=>new Promise((_resolve,no)=>{reject=no;entered();})}});
 mail.account='owner';mail.credentials={user:'fixture',password:'fixture',endpoint:{host:'fixture',port:995,tls:true}};mail.autoWiki=true;mail.paused=false;
 mail.store.set('account:owner',{seen:[],rejected:[]});const checking=mail.cycle();await started;mail.cancelPull=()=>reject(Error('mail_cancelled'));
 await mail.call({action:'pauseWatch'});await checking;
 assert.equal(mail.status().error,null);assert.equal(mail.status().watchPaused,true);assert.equal(mail.failures,undefined);
 assert.equal(mail.status().recentChecks.some(event=>event.kind==='error'),false);
});
test('logout during synthesis preserves the source and queued mail rather than reporting cancellation as failure',async t=>{
 let entered,release;const started=new Promise(resolve=>{entered=resolve;}),destination={provider:'aipro',model:'fixture'};
 const raw=Buffer.from('Subject: Contract\r\nFrom: Alice <alice@example.test>\r\nTo: owner@example.test\r\n\r\nPlease review the contract.');const parsed=await parsePop3Content(raw);
 const f=await fixture(t,{host:{providers:{catalogs:()=>[{provider:'aipro',models:[{id:'fixture'}]}],status:()=>({connected:true,...destination}),complete:async()=>{entered();return new Promise(resolve=>{release=resolve;});}}},options:{pull:async()=>({uidls:['one'],mails:[{uidl:'one',raw,normalized:{subject:parsed.subject,from:parsed.from.text,to:parsed.to.text,date:null,text:parsed.text,contentVersion:parsed.contentVersion,attachments:[]},attachments:[]}],failed:[],delaySeconds:60})}});
 await f.mail.call({action:'connect',requestId:'first',user:'fixture',password:'fixture',destination});await started;
 const before=f.mail.rows()[0];f.mail.disconnect();release({content:JSON.stringify({summary:'Review requested.',category:'direct_request',priority:'high',facts:['Review requested.'],actionItems:['Review']})});
 for(let i=0;i<100&&f.mail.synthesis;i++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(f.mail.synthesis,null);const after=f.mail.rows()[0];assert.equal(after.state,'queued');assert.equal(after.error,null);assert.equal(after.sourceHash,before.sourceHash);assert.equal(after.summaryTiming.state,'cancelled');
 assert.equal((await f.mail.call({action:'attention'})).total,0);
});
test('diagnostics distinguish stopped work, source conflicts, model setup and retriable processing',()=>{
 assert.deepEqual(mailAttentionInfo('mail_cancelled'),{title:'작업이 중단됐어요',action:null,cancelled:true});
 assert.equal(mailAttentionInfo('mail_source_changed').action,'source');assert.equal(mailAttentionInfo('mail_model_missing').action,'settings');assert.equal(mailAttentionInfo('mail_summary_failed').action,'retry');
 assert.doesNotMatch(mailAttentionInfo('PRIVATE_SERVER_RESPONSE').title,/PRIVATE/);
});
