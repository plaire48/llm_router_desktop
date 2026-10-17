import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {createNotificationHistory} from '../electron-app/notification-history.cjs';
import {createDecisionNotices} from '../electron-app/decision-notices.cjs';
import {createAnswerNotices} from '../electron-app/answer-notices.cjs';
import {createWikiNotices} from '../electron-app/wiki-notices.cjs';
import {createMailLoginNotices} from '../electron-app/mail-login-notices.cjs';
function ports(history){
 const options=[];class Notification extends EventEmitter{static isSupported(){return true;}constructor(value){super();options.push(value);}show(){}close(){}}
 return {history,Notification,getWindow:()=>({isDestroyed:()=>false}),send:()=>{},platform:'win32',options};
}
test('delivered notifications survive renderer clear and host restart without storing content',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-notices-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=path.join(dir,'history.json');
 const history=createNotificationHistory(file);await history.ready;const p=ports(history);
 const decision={id:'project:task:question',action:'show',summary:'PRIVATE QUESTION'},answer={projectId:'p',taskId:'t',runId:'r'},wiki={projectId:'p',jobId:'j',phase:'created'};
 const factories=[createDecisionNotices,createAnswerNotices,createWikiNotices],values=[decision,answer,wiki];
 for(let i=0;i<factories.length;i++){const notices=factories[i](p),show=value=>i===0?notices.request(value):notices.show(value);assert.equal(show(values[i]).shown,true);notices.clear();assert.equal(show(values[i]).shown,false);}
 await history.flush();const disk=await readFile(file,'utf8');assert(!disk.includes('PRIVATE'));assert(!disk.includes('project:task'));assert.equal(JSON.parse(disk).entries.length,3);
 const restored=createNotificationHistory(file);await restored.ready;
 for(let i=0;i<factories.length;i++){const notices=factories[i](ports(restored));assert.equal((i===0?notices.request(values[i]):notices.show(values[i])).shown,false);}
 const next=createDecisionNotices(ports(restored));assert.equal(next.request({...decision,id:'new-question'}).shown,true,'new work still notifies');
 await restored.flush();
});
test('mail outage is notified once until a successful reconnect resets it',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'nubi-mail-notices-'));t.after(()=>rm(dir,{recursive:true,force:true}));const file=path.join(dir,'history.json'),history=createNotificationHistory(file);await history.ready;
 const notices=createMailLoginNotices(ports(history));assert.equal(notices.show({code:'mail_portal_login'}).shown,true);notices.clear();assert.equal(notices.show({code:'mail_portal_login'}).shown,false);await history.flush();
 const restored=createNotificationHistory(file);await restored.ready;const reopened=createMailLoginNotices(ports(restored));assert.equal(reopened.show({code:'mail_portal_login'}).shown,false);reopened.reset();assert.equal(reopened.show({code:'mail_portal_login'}).shown,true);
 await restored.flush();
});
