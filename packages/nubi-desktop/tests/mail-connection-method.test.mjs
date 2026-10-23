import test from 'node:test';import assert from 'node:assert/strict';import {mailConnectionMethod} from '../runtime/mail-connection-method.mjs';
const store=values=>({get:key=>values[key]});
test('three mail methods are explicit and legacy choices survive without making Desktop the empty default',()=>{
 assert.equal(mailConnectionMethod(store({})),'portal');
 for(const method of ['desktop','pop3','portal'])assert.equal(mailConnectionMethod(store({'setting:mail-connection-method':method})),method);
 assert.equal(mailConnectionMethod(store({'setting:desktop-mail-source':{mode:'desktop',enabled:true,transport:'uia'}})),'desktop');
 assert.equal(mailConnectionMethod(store({'setting:server-profile':'company'})),'pop3');assert.equal(mailConnectionMethod(store({'setting:server-profile':'portal'})),'portal');
 assert.equal(mailConnectionMethod(store({'setting:mail-connection-method':'portal','setting:desktop-mail-source':{mode:'desktop',enabled:true,transport:'uia'}})),'portal');
});
import {PersonalMail} from '../runtime/mail.mjs';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {normalizePortalMail} from '../runtime/mail-portal-content.mjs';
test('switching among three methods persists selection, keeps originals and allows independent POP3',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'three-mail-methods-')),values=new Map(),pulls=[],host={storageRoot:root,connectionVault:{get:async k=>values.get(k),set:async(k,v)=>values.set(k,v)}};const options={personalRoot:path.join(root,'mail'),pull:async packet=>{pulls.push(packet.endpoint);return {uidls:[],mails:[],delaySeconds:60};}};let mail=new PersonalMail(host,options);mail.autoWiki=false;mail.store.set('setting:auto-wiki',false);
 t.after(async()=>{mail.dispose();await Promise.all([mail.rawDisposed,mail.wikiDisposed]);await rm(root,{recursive:true,force:true});});
 const parsed=await normalizePortalMail(Buffer.from('Subject: retained\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nKeepOriginalBody'));await mail.intake({mails:[{...parsed,uidl:'kept',protocol:'local'}]},mail.generation,{collectOnly:true,accountId:'fixture'});const id=mail.rows()[0].id;
 for(const method of ['desktop','pop3','portal','pop3']){mail.nextCheckAt=new Date(Date.now()+300000).toISOString();const value=await mail.call({action:'selectMethod',method});assert.equal(value.connectionMethod,method);assert.match((await mail.read(id)).mail.text,/KeepOriginalBody/);}
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
