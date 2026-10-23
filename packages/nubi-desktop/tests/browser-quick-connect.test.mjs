import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {createQuickConnector} from '../browser-connector/quick-connector.js';
const require=createRequire(import.meta.url),{ExternalBrowserHost}=require('../electron-app/external-browser-host.cjs'),{BrowserWindowDock}=require('../electron-app/browser-window-dock.cjs');
const {createExternalBrowserContentPort}=require('../electron-app/external-browser-content-port.cjs');
const uuid=()=>crypto.randomUUID(),ticket='a'.repeat(64),owner='http://127.0.0.1:1234/nubi-browser-connect/'+ticket;
function fixture(){
 let listener,next=10;const connected=[],live=new Map([[1,{id:1,windowId:8,url:'https://work.test',active:false,lastAccessed:2}],[2,{id:2,windowId:8,url:owner,active:true}],[3,{id:3,windowId:9,url:'https://other.test',active:true,lastAccessed:1}]]);
 const chrome={runtime:{id:'extension',getURL:file=>'chrome-extension://extension/'+file,onMessage:{addListener:fn=>listener=fn}},windows:{getAll:async()=>[{id:8},{id:9}]},tabs:{
  query:async({windowId,active}={})=>[...live.values()].filter(t=>(windowId===undefined||t.windowId===windowId)&&(active===undefined||t.active===active)),
  get:async id=>{if(!live.has(id))throw Error('closed');return {...live.get(id)};},
  update:async(id,args)=>{if(args.active){for(const t of live.values())if(t.windowId===live.get(id).windowId)t.active=t.id===id;}},
  create:async args=>{const id=next++;for(const t of live.values())if(t.windowId===args.windowId)t.active=false;const tab={id,...args};live.set(id,tab);return tab;},
  remove:async id=>{const tab=live.get(id);live.delete(id);if(tab?.active&&live.has(tab.openerTabId))live.get(tab.openerTabId).active=true;}
 }};
 const connector=createQuickConnector({chrome,connect:async(code,tab)=>{assert.match(code,/^ws:/);connected.push(tab.id);},connected:()=>false});
 const sender={id:chrome.runtime.id,url:owner,tab:{id:2},frameId:0};
 const send=(message,from=sender)=>new Promise(resolve=>{if(listener(message,from,resolve)!==true)resolve(undefined);});
 return {live,connected,connector,send,sender};
}
test('one-button connection selects the most recently used original tab and only closes its own bridge',async()=>{
 const f=fixture();try{const result=await f.send({action:'quickPrepare',proof:false});assert.equal(result.nonces.length,1);assert.deepEqual(await f.send({action:'quickCommit',nonce:result.nonces[0],code:'ws://127.0.0.1:1234/'+ticket}),{connected:true});assert.deepEqual(f.connected,[1]);assert.ok(f.live.has(1)&&f.live.has(3));assert.ok(!f.live.has(2));}finally{await f.connector.clean();}
});
test('window intake commits only the exact nonce selected by native proof and retains all original tabs',async()=>{
 const f=fixture();try{const result=await f.send({action:'quickPrepare',proof:true});assert.equal(result.nonces.length,2);await f.send({action:'quickCommit',nonce:result.nonces[1],code:'ws://127.0.0.1:1234/'+ticket});assert.deepEqual(f.connected,[3]);assert.deepEqual([...f.live.keys()],[1,3]);}finally{await f.connector.clean();}
});
test('websites, nested frames and another bridge cannot use an in-flight connection',async()=>{
 const f=fixture();try{assert.equal(await f.send({action:'quickPrepare'},{...f.sender,url:'https://evil.test'}),undefined);assert.equal(await f.send({action:'quickPrepare'},{...f.sender,frameId:2}),undefined);const result=await f.send({action:'quickPrepare'});assert.equal((await f.send({action:'quickCommit',nonce:result.nonces[0],code:'ws://127.0.0.1:1234/'+ticket},{...f.sender,tab:{id:99}})).error,'external_browser_code_invalid');assert.deepEqual(f.connected,[]);}finally{await f.connector.clean();}
});
test('changing the selected tab during proof cancels rather than connecting an old or guessed tab',async()=>{
 const f=fixture();try{const result=await f.send({action:'quickPrepare',proof:true});for(const t of f.live.values())if(t.windowId===9)t.active=t.id===3;assert.equal((await f.send({action:'quickCommit',nonce:result.nonces[1],code:'ws://127.0.0.1:1234/'+ticket})).error,'dock_cancelled');assert.deepEqual(f.connected,[]);assert.ok(f.live.has(1)&&f.live.has(3));}finally{await f.connector.clean();}
});
test('cleanup preserves a proof tab the user navigated into a real page',async()=>{
 const f=fixture();const result=await f.send({action:'quickPrepare',proof:true});const proof=[...f.live.values()].find(t=>t.url.endsWith(result.nonces[0]));f.live.get(proof.id).url='https://work.test/new';await f.connector.clean();assert.ok(f.live.has(proof.id));
});
test('loopback handoff uses independent one-use secrets, no-store CSP and exact Origin checks',async()=>{
 const host=new ExternalBrowserHost();try{let seen;const paired=await host.pair({resolveProof:async nonces=>{seen=nonces;return nonces[0];}}),url=paired.connectUrl,origin=new URL(url).origin;
  assert.notEqual(url.split('/').at(-1),paired.code.split('/').at(-1));
  const page=await fetch(url);assert.equal(page.status,200);assert.equal(page.headers.get('cache-control'),'no-store');assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.ok(!(await page.text()).includes(paired.code));
  assert.equal((await fetch(url+'/config')).status,200);assert.equal((await fetch(url+'/config')).headers.get('access-control-allow-origin'),null);
  const nonces=[uuid()];assert.equal((await fetch(url+'/resolve',{method:'POST',headers:{Origin:'https://evil.test'},body:JSON.stringify(nonces)})).status,404);assert.equal(seen,undefined);
  assert.equal((await fetch(url+'/resolve',{method:'POST',headers:{Origin:origin},body:JSON.stringify(nonces)})).status,200);assert.deepEqual(seen,nonces);
  host.ticket=null;assert.equal((await fetch(url+'/config')).status,404);
 }finally{await host.stop();}
});
test('native window drop uses proof to connect content without previewing, moving or attaching the browser',async()=>{
 const calls=[],nonce=uuid(),native={onEvent:null,start:async()=>{},request:async(action,args)=>{calls.push(action);if(action==='choose')return {candidateId:args.candidateId,browserName:'Chrome'};if(action==='resolveProof'){assert.equal(args.candidateId,'dropped');return {candidateId:'dropped'};}},close:async()=>{}},external={quickConnect:async({resolveProof})=>{assert.equal(await resolveProof([nonce]),nonce);return {connected:true};}},dock=new BrowserWindowDock({native,external,launch:{preference:{mode:'external'}},platform:'win32'});
 const result=await dock.bring({candidateId:'dropped',source:'drag'});assert.equal(result.displayMode,'tab-content');assert.equal(dock.status().windowDocked,false);assert.deepEqual(calls,['choose','resolveProof']);
});
test('a superseded button connection cannot stop a newer pairing or focus it as its own result',async()=>{
 const browser={mirror:{onEvent(){},stop:async()=>{}},status:()=>({connected:false}),pair:async()=>{browser.quick={owner:'old'};return {connectUrl:owner};},stop:async()=>assert.fail('must preserve newer pairing')},window=new EventEmitter();let release,entered;
 const gate=new Promise(resolve=>release=resolve),opening=new Promise(resolve=>entered=resolve),router={mode:'external',launch:{open:async()=>{entered();await gate;}}};
 const port=createExternalBrowserContentPort({browser,router,window});const request=port.request({action:'connect'});await opening;const newer=browser.quick={owner:'new'};release();await assert.rejects(request,/connection_changed/);assert.equal(browser.quick,newer);port.dispose();
});
