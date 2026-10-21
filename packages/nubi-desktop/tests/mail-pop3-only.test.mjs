import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {Store} from '../runtime/store.mjs';
import {PersonalMail} from './helpers-personal-mail.mjs';
import {parsePop3Content} from '../../openwiki/src/connectors/sources/pop3-content.mjs';

test('withdrawn IMAP settings return to POP3 without changing retained mail records',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-pop3-only-')),storageRoot=path.join(root,'state');
 const store=new Store(path.join(storageRoot,'personal-mail'));
 const retained={id:'retained',account:'old-account',uidl:'original-uid',state:'saved',subject:'Retained',from:'sender@example.test',sourceHash:'original-hash'};
 store.set('setting:server-profile','company_imap');store.set('mail:retained',retained);store.close();
 const packets=[],mail=new PersonalMail({storageRoot},{personalRoot:path.join(root,'mail'),pull:async input=>{packets.push(input);return {uidls:[],mails:[],failed:[],delaySeconds:60};}});
 t.after(async()=>{mail.dispose();await Promise.all([mail.rawDisposed,mail.wikiDisposed]);await rm(root,{recursive:true,force:true});});
 assert.equal(mail.status().serverProfile,'company');assert.equal(mail.store.get('setting:server-profile'),'company');
 assert.deepEqual(mail.store.get('mail:retained'),retained);
 await assert.rejects(mail.call({action:'connect',serverProfile:'company_imap',requestId:'stale',user:'fixture',password:'fixture'}),/mail_input_invalid/);
 assert.equal(packets.length,0);
 await mail.call({action:'connect',requestId:'current',user:'fixture',password:' fixture-password '});
 assert.deepEqual(packets[0].endpoint,{host:'pop3.samsung.net',port:995,tls:true,protocol:'pop3'});
 assert.equal(packets[0].password,' fixture-password ');assert.equal(packets[0].sentPath,undefined);
 await assert.rejects(mail.call({action:'setSentFolder',path:'Sent'}),/mail_input_invalid/);
 assert.deepEqual(mail.store.get('mail:retained'),retained);
});

test('POP3 reconnect reuses UIDL and raw receipt while retaining HTML and recipient classification',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'nubi-pop3-reconnect-'));
 const raw=Buffer.from('Subject: Contract\r\nFrom: Alice <alice@example.test>\r\nTo: other@example.test\r\nCc: owner@example.test\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<table><tr><td>Contract body</td></tr></table>');
 const parsed=await parsePop3Content(raw),normalized={subject:parsed.subject,from:parsed.from.text,to:parsed.to.text,cc:parsed.cc.text,bcc:'',date:null,text:parsed.text,contentVersion:parsed.contentVersion,attachments:[]},packets=[];
 const mail=new PersonalMail({storageRoot:path.join(root,'state')},{personalRoot:path.join(root,'mail'),pull:async input=>{packets.push(input);return {uidls:['opaque-pop3-uid'],mails:input.known?.includes('opaque-pop3-uid')?[]:[{uidl:'opaque-pop3-uid',raw,normalized,attachments:[]}],failed:[],delaySeconds:60};}});
 t.after(async()=>{mail.dispose();await Promise.all([mail.rawDisposed,mail.wikiDisposed]);await rm(root,{recursive:true,force:true});});
 const args={action:'connect',requestId:'first',user:'owner@example.test',password:'fixture',recipientAddress:'owner@example.test'};
 await mail.call(args);const row=mail.rows()[0],file=path.join(mail.root,'raw',row.id,'manifest.json'),receipt=await mail.rawVault.read(file);
 const result=await mail.call({action:'search',query:'Contract',filters:{mailbox:'inbox',roles:['cc']}});
 assert.equal(result.total,1);assert.equal(result.results[0].recipientRole,'cc');
 assert.match((await mail.read(row.id,{includePresentation:true})).mail.presentation.html,/<table>/);
 mail.disconnect();mail.nextCheckAt=null;await mail.call({...args,requestId:'second'});
 assert(packets[1].known.includes('opaque-pop3-uid'));assert.equal(mail.rows().length,1);
 assert.deepEqual(await mail.rawVault.read(file),receipt);assert.deepEqual(await mail.rawVault.read(path.join(mail.root,'raw',row.id,'message.eml')),raw);
 assert.equal((await mail.call({action:'search',query:'',filters:{mailbox:'sent'}})).total,0);
});
