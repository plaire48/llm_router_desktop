import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {PersonalMail} from './helpers-personal-mail.mjs';
import {mailAttentionInfo,mailAttentionRowInfo} from '../ui/mail-attention-state.mjs';
import {parsePop3Content} from '../../openwiki/src/connectors/sources/pop3-content.mjs';
async function fixture(t,extra={}){
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-mail-attention-')),host={storageRoot:path.join(root,'state'),...extra.host},options={personalRoot:path.join(root,'mail'),...extra.options};
 let mail=new PersonalMail(host,options);
 t.after(async()=>{mail.dispose();await Promise.all([mail.rawDisposed,mail.wikiDisposed]);await rm(root,{recursive:true,force:true});});
 return {mail,host,options,reopen(){mail.dispose();mail=new PersonalMail(host,options);return mail;}};
}
const row=(id,error='mail_summary_failed')=>({id,account:'owner',state:'attention',subject:'Contract '+id,from:'Alice <alice@example.test>',sourceHash:'retained-source-'+id,uidl:'PRIVATE_UIDL_'+id,path:'PRIVATE_STORAGE_PATH',error});
const until=async condition=>{for(let i=0;i<400&&!condition();i++)await new Promise(resolve=>setTimeout(resolve,5));assert(condition(),'background queue advances');};

test('retry queues behind live processing, acknowledges duplicates and preserves the active mail',async t=>{
 const {mail}=await fixture(t);mail.account='owner';mail.autoWiki=false;
 const active={...row('active'),state:'summarizing',error:null,attachmentState:'complete'},queued={...row('next'),attachmentState:'complete'};
 mail.store.set('mail:active',active);mail.store.set('mail:next',queued);mail.synthesis=new AbortController();
 const first=await mail.call({action:'retry',id:'next',sourceHash:queued.sourceHash});
 assert.equal(first.retry.queued,1);assert.deepEqual(mail.store.get('mail:active'),active);assert.equal(mail.store.get('mail:next').state,'queued');
 const stored=mail.store.get('mail:next'),again=await mail.call({action:'retry',id:'next',sourceHash:queued.sourceHash});
 assert.equal(again.retry.alreadyPending,true);assert.deepEqual(mail.store.get('mail:next'),stored);
 await assert.rejects(mail.call({action:'retry',id:'next',sourceHash:'changed'}),/mail_source_changed/);
 mail.synthesis=null;
});

test('a queued retry survives reopening while automatic organization is off',async t=>{
 const f=await fixture(t);f.mail.account='owner';f.mail.autoWiki=false;f.mail.store.set('mail:next',{...row('next'),protocol:'local',attachmentState:'complete'});
 await f.mail.call({action:'retry',id:'next'});const reopened=f.reopen();
 assert.equal(reopened.store.get('mail:next').state,'queued');assert.equal(reopened.store.get('mail:next').sourceHash,'retained-source-next');
});
test('a summary waiting on failed attachments can queue the attachment retry while another reader works',async t=>{
 const {mail}=await fixture(t);mail.account='owner';mail.autoWiki=false;mail.attachmentRead=new AbortController();
 const item={...row('next'),state:'queued',error:null,attachmentState:'attention',attachmentFailures:[{filename:'budget.xlsx',error:'document_office_timeout'}]};mail.store.set('mail:next',item);
 const result=await mail.call({action:'retry',id:'next'});assert.equal(result.retry.queued,1);assert.equal(mail.store.get('mail:next').attachmentState,'queued');
 assert.equal((await mail.call({action:'retry',id:'next'})).retry.alreadyPending,true);mail.attachmentRead=null;
});

test('an attachment retry follows the active reader and retains the saved Wiki and completed attachment cache',async t=>{
 const {mail}=await fixture(t);await until(()=>!mail.reconciling);mail.autoWiki=false;
 const bytes=Buffer.from('fixture attachment'),hash=createHash('sha256').update(bytes).digest('hex');
 for(const id of ['active','next'])mail.store.set('mail:'+id,{...row(id),protocol:'local',state:'saved',path:id+'.md',error:null,attachmentState:id==='active'?'queued':'attention',attachmentFailures:id==='active'?[]:[{error:'document_timeout'}]});
 const cache={sourceHash:row('next').sourceHash,sha256:hash,state:'complete',text:'retained cached text',reader:'document_parser'};mail.store.set('attachment:next:cached',cache);
 const attachment=(id,filename)=>({id,filename,sha256:hash});
 mail.source=async item=>({attachments:[...(item.id==='next'?[attachment('cached','retained.txt')]:[]),attachment('failed',item.id+'.txt')]});mail.readAttachmentBytes=async()=>bytes;
 const calls=[],release=new Map();mail.extractAttachment=async(_bytes,part)=>{calls.push(part.filename);await new Promise(resolve=>release.set(part.filename,resolve));return {text:'read '+part.filename};};
 mail.autoWiki=true;const running=mail.readAttachments();await until(()=>calls.length===1);const active=mail.store.get('mail:active');
 try{
  assert.equal((await mail.call({action:'retry',id:'next'})).retry.queued,1);assert.equal((await mail.call({action:'retry',id:'next'})).retry.alreadyPending,true);assert.deepEqual(mail.store.get('mail:active'),active);assert.deepEqual(calls,['active.txt']);
  release.get('active.txt')();await running;await until(()=>calls.length===2);assert.deepEqual(calls,['active.txt','next.txt']);release.get('next.txt')();await until(()=>!mail.attachmentRead);
  const next=mail.store.get('mail:next');assert.equal(next.state,'saved');assert.equal(next.path,'next.md');assert.equal(next.attachmentState,'complete');assert.deepEqual(mail.store.get('attachment:next:cached'),cache);
  assert.equal((await mail.call({action:'retry',id:'next'})).retry.completed,true);assert.deepEqual(calls,['active.txt','next.txt']);
 }finally{for(const finish of release.values())finish();}
});

test('retry returns a queue receipt before slow prepared-Wiki reconciliation completes',async t=>{
 const {mail}=await fixture(t);mail.account='owner';mail.autoWiki=false;mail.store.set('mail:next',row('next'));
 let finish,entered=false;const reconciliation=new Promise(resolve=>{finish=resolve;});mail.reconcilePrepared=async()=>{entered=true;await reconciliation;};
 const pending=mail.call({action:'retry',id:'next'});await until(()=>entered);
 let acknowledged=false;void pending.then(()=>{acknowledged=true;});
 try{await until(()=>acknowledged);assert.equal(mail.store.get('mail:next').state,'queued');}finally{finish();await pending;}
});

test('the current prepared save finishes before a queued retry starts, without another model call',async t=>{
 const {mail}=await fixture(t,{host:{providers:{status:()=>({connected:true,provider:'aipro',model:'fixture'}),catalogs:()=>[{provider:'aipro',models:[{id:'fixture'}]}],complete(){assert.fail('prepared work must not invoke the model');}}}});
 await until(()=>!mail.reconciling);
 mail.account='owner';mail.autoWiki=true;mail.destination={provider:'aipro',model:'fixture'};
 const prepared=id=>({...row(id),protocol:'local',state:id==='active'?'queued':'attention',attachmentState:'complete',prepared:{text:'kept '+id,path:id+'.md',hash:'hash'}});
 mail.store.set('mail:active',prepared('active'));mail.store.set('mail:next',prepared('next'));
 mail.read=async()=>({mail:{subject:'fixture',from:'fixture',text:'body',attachments:[]}});mail.source=async()=>({});
 const calls=[],release=new Map();mail.savePrepared=async(item,prepared,timing)=>{calls.push(item.id);await new Promise(resolve=>release.set(item.id,resolve));const {prepared:unused,...saved}=item;mail.store.set('mail:'+item.id,{...saved,state:'saved',error:null});return true;};
 const running=mail.drain();await until(()=>calls.length===1);
 try{
  await mail.call({action:'retry',id:'next'});await mail.call({action:'retry',id:'next'});assert.deepEqual(calls,['active']);assert.equal(mail.store.get('mail:next').state,'queued');
  release.get('active')();await running;await until(()=>calls.length===2);assert.deepEqual(calls,['active','next']);release.get('next')();await until(()=>!mail.synthesis);assert.equal(mail.store.get('mail:next').state,'saved');
 }finally{for(const finish of release.values())finish();}
});

test('lightweight status omits message lists while retaining counts and progress',async t=>{
 const {mail}=await fixture(t);mail.account='owner';mail.autoWiki=false;
 mail.store.set('mail:saved',{...row('saved'),state:'saved',error:null,attachmentState:'complete'});
 const status=await mail.call({action:'status',includeMessages:false});
 assert.equal(Object.hasOwn(status,'messages'),false);assert.equal(status.counts.received,1);assert.equal(status.progress.completed,1);
 assert.equal((await mail.call({action:'status'})).messages[0].id,'saved');
});

test('attention snapshot retains connection and check times without loading message previews',async t=>{
 const {mail}=await fixture(t);mail.account='owner';mail.autoWiki=false;
 mail.lastCheckedAt='2026-10-24T01:02:03.000Z';mail.nextCheckAt='2026-10-24T01:03:03.000Z';
 const originalStatus=mail.status.bind(mail);let includeMessages;
 mail.status=options=>{includeMessages=options?.includeMessages;return originalStatus(options);};
 const {status}=await mail.call({action:'attention'});
 assert.equal(includeMessages,false);
 assert.equal(status.lastCheckedAt,mail.lastCheckedAt);assert.equal(status.nextCheckAt,mail.nextCheckAt);
 assert.equal(status.connectionMethod,mail.connectionMethod);assert.equal(status.protocol,originalStatus({includeMessages:false}).protocol);
 assert.equal(Object.hasOwn(status,'messages'),false);
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
