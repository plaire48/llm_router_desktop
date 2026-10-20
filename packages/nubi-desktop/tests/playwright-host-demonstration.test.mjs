import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PlaywrightHost}=require('../electron-app/playwright-host.cjs'),{DEMONSTRATION_BINDING}=require('../electron-app/demonstration-recorder.cjs');

// Browser teach plan T3, product step: the demonstration action of the host both product browsers share.
function fixture(url){
 const dbg=new EventEmitter();let attached=false;
 Object.assign(dbg,{isAttached:()=>attached,attach:()=>{attached=true;},detach:()=>{attached=false;dbg.emit('detach');},sendCommand:async method=>method==='Page.getFrameTree'?{frameTree:{frame:{id:'main'}}}:method==='Runtime.enable'?(dbg.emit('message',null,'Runtime.executionContextCreated',{context:{id:1,auxData:{isDefault:true,frameId:'main'}}}),{}):{identifier:'s'}});
 const wc=new EventEmitter();let current=url,destroyed=false;Object.assign(wc,{debugger:dbg,isDestroyed:()=>destroyed,getURL:()=>current,getTitle:()=>'양식',destroy(){destroyed=true;wc.emit('destroyed');}});
 const row={id:'t1',automationDocument:'doc',title:'양식',view:{webContents:wc}};
 const host=new PlaywrightHost({tab:id=>{if(id!==row.id||destroyed)throw Error('browser_tab_missing');return row;},tabs:new Map([[row.id,row]]),active:row.id});
 return {host,dbg,wc,row,navigate:next=>{current=next;}};
}
const event=url=>JSON.stringify({kind:'click',at:1,index:0,items:[{tag:'button',name:'확인'}],url,title:'양식'});
const call=(dbg,url)=>dbg.emit('message',null,'Runtime.bindingCalled',{name:DEMONSTRATION_BINDING,payload:event(url),executionContextId:1});

test('recording never starts on a protected page and leaves protected pages out of the events',async()=>{
 const login=fixture('https://idp.invalid/sso?SAMLRequest=x');
 await assert.rejects(login.host.request('demonstration',{op:'start',tabId:'t1'}),/browser_auth_protected/);
 assert.equal(login.dbg.isAttached(),false);
 const {host,dbg,navigate}=fixture('https://service.invalid/form');
 const started=await host.request('demonstration',{op:'start',tabId:'t1'});
 assert.equal(started.recording,true);assert.equal(started.tabId,'t1');assert.equal(started.documentId,'doc');
 assert.deepEqual(await host.request('demonstration',{op:'start',tabId:'t1'}),started,'a second start reports the running session');
 call(dbg,'https://service.invalid/form');
 call(dbg,'https://service.invalid/callback#access_token=abc');
 call(dbg,'https://idp.invalid/sso?SAMLResponse=x');
 const status=await host.request('demonstration',{op:'status',tabId:'t1'});assert.equal(status.events,1);assert.equal(status.dropped,2);
 // Stop works even when the person ended on a page the automation guard refuses, and that address is not reported.
 navigate('https://service.invalid/done#id_token=abc');
 const stopped=await host.request('demonstration',{op:'stop',tabId:'t1'});
 assert.equal(stopped.events.length,1);assert.equal(stopped.url,null);assert.equal(stopped.title,'양식');assert.equal(dbg.isAttached(),false);
 await assert.rejects(host.request('demonstration',{op:'stop',tabId:'t1'}),/browser_recording_missing/);
 await assert.rejects(host.request('demonstration',{op:'rewind',tabId:'t1'}),/browser_action_invalid/);
 await assert.rejects(host.request('demonstration',{op:'status'}),/browser_tab_required/);
});

test('a closed tab still hands back its recording, and disposing the host ends every recording',async()=>{
 const {host,dbg,wc}=fixture('https://service.invalid/form');
 await host.request('demonstration',{op:'start',tabId:'t1'});call(dbg,'https://service.invalid/form');wc.destroy();
 const status=await host.request('demonstration',{op:'status',tabId:'t1'});assert.equal(status.recording,false);assert.equal(status.reason,'tab_closed');assert.equal(status.documentId,null);
 assert.equal((await host.request('demonstration',{op:'stop',tabId:'t1'})).events.length,1);
 const other=fixture('https://service.invalid/form');
 await other.host.request('demonstration',{op:'start',tabId:'t1'});assert.equal(other.dbg.isAttached(),true);
 other.host.dispose();assert.equal(other.dbg.isAttached(),false);assert.equal((await other.host.request('demonstration',{op:'status',tabId:'t1'})).recording,false);
});
