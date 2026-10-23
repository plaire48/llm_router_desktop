import test from 'node:test';import assert from 'node:assert/strict';import {mailConnectionMethod} from '../runtime/mail-connection-method.mjs';
const store=values=>({get:key=>values[key]});
// The portal is off in the product (user decision 2026-10-23: Knox Desktop Message or POP3). Its code path stays tested with the switch on.
test('three mail methods are explicit and legacy choices survive without making Desktop the empty default',()=>{
 const on={portal:true};
 assert.equal(mailConnectionMethod(store({}),on),'portal');
 for(const method of ['desktop','pop3','portal'])assert.equal(mailConnectionMethod(store({'setting:mail-connection-method':method}),on),method);
 assert.equal(mailConnectionMethod(store({'setting:desktop-mail-source':{mode:'desktop',enabled:true,transport:'uia'}}),on),'desktop');
 assert.equal(mailConnectionMethod(store({'setting:server-profile':'company'}),on),'pop3');assert.equal(mailConnectionMethod(store({'setting:server-profile':'portal'}),on),'portal');
 assert.equal(mailConnectionMethod(store({'setting:mail-connection-method':'portal','setting:desktop-mail-source':{mode:'desktop',enabled:true,transport:'uia'}}),on),'portal');
});
test('with the portal off, a saved or default portal choice reads as Knox Desktop and POP3 stays as chosen',()=>{
 assert.equal(mailConnectionMethod(store({})),'desktop');
 assert.equal(mailConnectionMethod(store({'setting:mail-connection-method':'portal'})),'desktop');
 assert.equal(mailConnectionMethod(store({'setting:mail-connection-method':'pop3'})),'pop3');
});
import {PersonalMail} from '../runtime/mail.mjs';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {normalizePortalMail} from '../runtime/mail-portal-content.mjs';
test('switching between Knox Desktop and POP3 persists selection, keeps originals and refuses the portal while it is off',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'three-mail-methods-')),values=new Map(),pulls=[],host={storageRoot:root,connectionVault:{get:async k=>values.get(k),set:async(k,v)=>values.set(k,v)}};const options={personalRoot:path.join(root,'mail'),pull:async packet=>{pulls.push(packet.endpoint);return {uidls:[],mails:[],delaySeconds:60};}};let mail=new PersonalMail(host,options);mail.autoWiki=false;mail.store.set('setting:auto-wiki',false);
 t.after(async()=>{mail.dispose();await Promise.all([mail.rawDisposed,mail.wikiDisposed]);await rm(root,{recursive:true,force:true});});
 const parsed=await normalizePortalMail(Buffer.from('Subject: retained\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nKeepOriginalBody'));await mail.intake({mails:[{...parsed,uidl:'kept',protocol:'local'}]},mail.generation,{collectOnly:true,accountId:'fixture'});const id=mail.rows()[0].id;
 await assert.rejects(mail.call({action:'selectMethod',method:'portal'}),/mail_portal_off/);
 for(const method of ['desktop','pop3','desktop','pop3']){mail.nextCheckAt=new Date(Date.now()+300000).toISOString();const value=await mail.call({action:'selectMethod',method});assert.equal(value.connectionMethod,method);assert.match((await mail.read(id)).mail.text,/KeepOriginalBody/);}
 await assert.rejects(mail.call({action:'selectMethod',method:'files'}),/mail_input_invalid/);assert.equal(mail.status().connectionMethod,'pop3');
 await mail.call({action:'connect',requestId:'direct-pop3',serverProfile:'company',user:'fixture',password:'fixture'});assert.equal(pulls.length,1);assert.equal(mail.status().connectionMethod,'pop3');
 mail.dispose();await Promise.all([mail.rawDisposed,mail.wikiDisposed]);mail=new PersonalMail(host,options);assert.equal(mail.status().connectionMethod,'pop3');assert.match((await mail.read(id)).mail.text,/KeepOriginalBody/);
});
import {createRequire} from 'node:module';const {mailSourceStatus}=createRequire(import.meta.url)('../electron-app/mail-source-status.cjs');
test('status follows explicit method and never restores portal while reading Desktop or POP3 state',async()=>{
 let restores=0;const portal={restore(){restores++;},status:()=>({connected:false,connecting:false,checking:false,folders:[],error:null})},base={desktop:{mode:'desktop',connected:true},serverProfile:'company',connected:true,localCount:0,progress:{stage:'ready'}};
 const pop3=await mailSourceStatus({snapshot:{...base,connectionMethod:'pop3'},portal});assert.equal(pop3.protocol,'pop3');assert.equal(restores,0);
 const desktop=await mailSourceStatus({snapshot:{...base,connectionMethod:'desktop'},portal});assert.equal(desktop.protocol,'desktop');assert.equal(restores,0);
 const result=await mailSourceStatus({snapshot:{...base,connectionMethod:'portal'},portal});assert.equal(result.protocol,'portal');assert.equal(result.connected,false);assert.equal(restores,1);
});
