import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url),{WebSocketServer}=require('ws');
async function fixture(t){
 const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-direct-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const server=new WebSocketServer({host:'127.0.0.1',port:0}),calls=[];await new Promise(r=>server.once('listening',r));
 t.after(()=>{for(const c of server.clients)c.terminate();server.close();});
 const targets=[{targetId:'work-target',type:'page',title:'업무 페이지',url:'https://work.test/home'},{targetId:'private-target',type:'page',title:'Other private tab',url:'https://private.test'},{targetId:'auth-target',type:'page',title:'Secret token',url:'https://login.test/oauth?code=private'}];
 server.on('connection',socket=>socket.on('message',bytes=>{const x=JSON.parse(bytes);calls.push(x);let result={};
  if(x.method==='Browser.getVersion')result={product:'Chrome/154.0',userAgent:'Chrome/154.0'};
  if(x.method==='Target.getTargets')result={targetInfos:targets};
  if(x.method==='Target.getTargetInfo')result={targetInfo:targets.find(t=>t.targetId===x.params.targetId)};
  if(x.method==='Target.attachToTarget')result={sessionId:'session-'+x.params.targetId};
  if(x.method==='Browser.getWindowForTarget')result={windowId:7,bounds:{windowState:'normal'}};
  if(x.method==='Page.getFrameTree')result={frameTree:{frame:{id:'main-frame',loaderId:'loader-1',url:'https://work.test/home'}}};
  if(x.method==='Runtime.evaluate')result={result:{type:'string',value:'observed'}};
  socket.send(JSON.stringify({id:x.id,result}));
 }));
 const port=server.address().port;await writeFile(path.join(directory,'DevToolsActivePort'),port+'\n/devtools/browser/audit-browser\n');
 return {directory,calls,endpoint:`ws://127.0.0.1:${port}/devtools/browser/audit-browser`,server};
}
test('direct browser connection enumerates titles without attaching or reading unrelated tabs',async t=>{
 const f=await fixture(t),{ChromeDirectConnection}=require('../electron-app/chrome-direct-connection.cjs'),client=new ChromeDirectConnection({portFile:path.join(f.directory,'DevToolsActivePort')});t.after(()=>client.close());
 const list=await client.connect();assert.equal(list.length,2);assert.equal(list.some(t=>JSON.stringify(t).includes('private')),true);assert.equal(list.some(t=>JSON.stringify(t).includes('code=')),false);assert.equal(f.calls.filter(x=>x.method==='Target.attachToTarget').length,0);
 await client.choose('work-target');assert.deepEqual(f.calls.filter(x=>x.method==='Target.attachToTarget').map(x=>x.params.targetId),['work-target']);
 const tabs=await client.command('tabs');assert.equal(tabs.length,1);assert.equal(tabs[0].url,'https://work.test/home');
 await assert.rejects(()=>client.command('cdp',{tabId:String(tabs[0].id),documentId:tabs[0].documentId,method:'Network.getCookies'}),/browser_scope/);
 await client.close();assert.equal(f.calls.some(x=>x.method==='Browser.close'||x.method==='Target.closeTarget'),false);
});
test('direct browser connection rejects forged discovery endpoints and never connects outside loopback',async t=>{
 const f=await fixture(t),{ChromeDirectConnection}=require('../electron-app/chrome-direct-connection.cjs');await writeFile(path.join(f.directory,'DevToolsActivePort'),'1234\n/devtools/browser/id?redirect=https://evil.test\n');
 const c=new ChromeDirectConnection({portFile:path.join(f.directory,'DevToolsActivePort')});t.after(()=>c.close());await assert.rejects(()=>c.connect(),/browser_connection_unavailable/);assert.equal(f.calls.length,0);
});
test('direct connection adopts only the selected original tab into the existing host',async t=>{
 const f=await fixture(t),{ChromeDirectConnection}=require('../electron-app/chrome-direct-connection.cjs'),{ExternalBrowserHost}=require('../electron-app/external-browser-host.cjs');
 const host=new ExternalBrowserHost(),direct=new ChromeDirectConnection({portFile:path.join(f.directory,'DevToolsActivePort')});t.after(()=>host.stop());
 await direct.connect();await direct.choose('work-target');await host.adoptDirect(direct);assert.equal(host.status().connected,true);assert.equal(host.status().tabs.length,1);assert.equal(host.status().connectionKind,'direct');
 const tab=host.status().tabs[0];assert.equal((await host.request('check',{tabId:tab.id})).documentId,tab.documentId);await host.stop();assert.equal(host.status().connected,false);assert.equal(f.calls.some(x=>x.method==='Target.closeTarget'),false);
});
test('one connect action uses direct Chrome transport and returns an explicit tab choice without an extension handoff',async t=>{
 const f=await fixture(t),{ChromeDirectConnection}=require('../electron-app/chrome-direct-connection.cjs'),{ExternalBrowserHost}=require('../electron-app/external-browser-host.cjs'),{createExternalBrowserContentPort}=require('../electron-app/external-browser-content-port.cjs'),{EventEmitter}=require('node:events');
 const host=new ExternalBrowserHost(),window=new EventEmitter();window.isDestroyed=()=>false;window.webContents={isDestroyed:()=>false,send(){}};
 const router={mode:'external',launch:{open:async()=>{throw Error('unexpected_extension_handoff');}}};
 const port=createExternalBrowserContentPort({browser:host,router,window,directFactory:()=>new ChromeDirectConnection({portFile:path.join(f.directory,'DevToolsActivePort')})});t.after(async()=>{port.dispose();await host.stop();});
 assert.equal((await port.request({action:'connect'})).choosing,true);assert.equal(host.status().connected,false);assert.equal(host.status().candidates.length,2);
 await port.request({action:'chooseTab',candidateId:'work-target'});assert.equal(host.status().connected,true);assert.equal(host.status().tabs[0].url,'https://work.test/home');
});
test('Samsung discovery finds endpoint metadata within the vendor directory without importing a profile',async t=>{
 const f=await fixture(t),{samsungPortFile}=require('../electron-app/samsung-browser-discovery.cjs'),{mkdir}=await import('node:fs/promises');
 const directory=path.join(f.directory,'Samsung/Internet/User Data');await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'DevToolsActivePort'),'1234\n/devtools/browser/samsung\n');
 assert.equal(await samsungPortFile({localAppData:f.directory}),path.join(directory,'DevToolsActivePort'));
});
test('disconnect restores the original viewport and held keys before detaching the original tab',async t=>{
 const f=await fixture(t),{ChromeDirectConnection}=require('../electron-app/chrome-direct-connection.cjs');
 const direct=new ChromeDirectConnection({portFile:path.join(f.directory,'DevToolsActivePort')});t.after(()=>direct.close());await direct.connect();await direct.choose('work-target');
 const tab=direct.inventory()[0],args={tabId:tab.id,documentId:tab.documentId,streamId:'00000000-0000-0000-0000-000000000001',width:700,height:600};
 await direct.command('mirrorStart',args);await direct.command('mirrorInput',{...args,input:{kind:'key',type:'rawKeyDown',key:'Shift',code:'ShiftLeft',keyCode:16}});
 await direct.close();
 const methods=f.calls.map(x=>x.method),detach=methods.lastIndexOf('Target.detachFromTarget');
 assert(methods.indexOf('Emulation.clearDeviceMetricsOverride')<detach);assert(methods.indexOf('Page.stopScreencast')<detach);
 assert.equal(f.calls.filter(x=>x.method==='Input.dispatchKeyEvent'&&x.params.type==='keyUp').length,1);
 assert.equal(methods.some(x=>['Browser.close','Target.closeTarget'].includes(x)),false);
});
test('direct tab selection can be cancelled without adopting or closing any original tab',async t=>{
 const f=await fixture(t),{ChromeDirectConnection}=require('../electron-app/chrome-direct-connection.cjs'),{ExternalBrowserHost}=require('../electron-app/external-browser-host.cjs'),{createExternalBrowserContentPort}=require('../electron-app/external-browser-content-port.cjs'),{EventEmitter}=require('node:events');
 const host=new ExternalBrowserHost(),window=new EventEmitter();window.isDestroyed=()=>false;window.webContents={isDestroyed:()=>false,send(){}};
 const port=createExternalBrowserContentPort({browser:host,router:{mode:'external'},window,directFactory:()=>new ChromeDirectConnection({portFile:path.join(f.directory,'DevToolsActivePort')})});t.after(async()=>{port.dispose();await host.stop();});
 await port.request({action:'connect'});await port.request({action:'refreshTabs'});await port.request({action:'cancelConnect'});
 await assert.rejects(()=>port.request({action:'chooseTab',candidateId:'work-target'}),/browser_connection_changed/);
 assert.equal(host.status().connected,false);assert.equal(f.calls.some(x=>x.method==='Target.attachToTarget'||x.method==='Target.closeTarget'),false);
});
test('background connection acknowledges before discovery and a missing Samsung endpoint never waits for Chrome settings',async t=>{
 const {ExternalBrowserHost}=require('../electron-app/external-browser-host.cjs'),{createExternalBrowserContentPort}=require('../electron-app/external-browser-content-port.cjs'),{EventEmitter}=require('node:events');
 const host=new ExternalBrowserHost(),window=new EventEmitter();window.isDestroyed=()=>false;window.webContents={isDestroyed:()=>false,send(){}};
 let release,attempts=0;const factory=new Promise(done=>release=done),router={mode:'external',launch:{preference:{browser:'samsung'},connectionSettings:async()=>assert.fail('Samsung must not open an assumed Chrome permission page')}};
 const port=createExternalBrowserContentPort({browser:host,router,window,directFactory:()=>factory});t.after(async()=>{port.dispose();release({close:async()=>{}});await host.stop();});
 const request=port.request({action:'connect',background:true});request.catch(()=>{});
 const early=await Promise.race([request,new Promise(resolve=>setImmediate(()=>resolve('still waiting')))]);assert.deepEqual(early,{connecting:true});
 release({connect:async()=>{attempts++;throw Error('browser_connection_permission_required');},close:async()=>{}});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(attempts,1);assert.equal(host.status().connectionPhase,'unavailable');assert.equal(host.status().connectionError,'browser_connection_not_ready');
});
test('cancelling slow discovery allows a new attempt and late results cannot overwrite its tab choice',async t=>{
 const {ExternalBrowserHost}=require('../electron-app/external-browser-host.cjs'),{createExternalBrowserContentPort}=require('../electron-app/external-browser-content-port.cjs'),{EventEmitter}=require('node:events');
 const host=new ExternalBrowserHost(),window=new EventEmitter();window.isDestroyed=()=>false;window.webContents={isDestroyed:()=>false,send(){}};let first,attempts=0,closed=0;
 const slow=new Promise(resolve=>first=resolve),client={connect:async()=>[{id:'current',title:'Current'},{id:'other',title:'Other'}],close:async()=>{}};
 const port=createExternalBrowserContentPort({browser:host,router:{mode:'external'},window,directFactory:()=>++attempts===1?slow:client});t.after(async()=>{port.dispose();await host.stop();});
 await port.request({action:'connect',background:true});await new Promise(resolve=>setImmediate(resolve));await port.request({action:'cancelConnect'});
 await port.request({action:'connect',background:true});await new Promise(resolve=>setImmediate(resolve));
 first({connect:async()=>assert.fail('cancelled discovery must never connect'),close:async()=>closed++});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(closed,1);assert.equal(host.status().connectionPhase,'choose_tab');assert.equal(host.status().candidates[0].id,'current');
});
test('host adoption rechecks cancellation after releasing the previous connection',async()=>{
 const {ExternalBrowserHost}=require('../electron-app/external-browser-host.cjs'),host=new ExternalBrowserHost();let release,current=true,closed=0;
 host.stop=()=>new Promise(resolve=>release=resolve);const connection={close:async()=>closed++};
 const adopting=host.adoptDirect(connection,{isCurrent:()=>current});current=false;release();
 await assert.rejects(adopting,/browser_connection_changed/);assert.equal(closed,1);assert.equal(host.status().connected,false);
});
test('an existing browser endpoint works without a DevToolsActivePort file or any browser launch',async t=>{
 const f=await fixture(t),{ChromeDirectConnection}=require('../electron-app/chrome-direct-connection.cjs');
 await rm(path.join(f.directory,'DevToolsActivePort'));
 const direct=new ChromeDirectConnection({endpoint:async()=>f.endpoint,portFile:path.join(f.directory,'DevToolsActivePort')});t.after(()=>direct.close());
 const tabs=await direct.connect();assert.equal(tabs.some(x=>x.id==='work-target'),true);
 assert.equal(f.calls.some(x=>x.method==='Target.createTarget'||x.method==='Target.attachToTarget'),false);
 await direct.choose('work-target');await direct.close();
 assert.equal(f.calls.some(x=>x.method==='Browser.close'||x.method==='Target.closeTarget'),false);
});
test('a missing endpoint never launches a browser settings window during connection',async t=>{
 const {ExternalBrowserHost}=require('../electron-app/external-browser-host.cjs'),{createExternalBrowserContentPort}=require('../electron-app/external-browser-content-port.cjs'),{EventEmitter}=require('node:events');
 const browser=new ExternalBrowserHost(),window=new EventEmitter();window.isDestroyed=()=>false;window.webContents={isDestroyed:()=>false,send(){}};let settings=0;
 const router={mode:'external',launch:{preference:{browser:'custom'},connectionSettings:async()=>{settings++;}}};
 const port=createExternalBrowserContentPort({browser,router,window,directFactory:()=>({connect:async()=>{throw Error('browser_connection_permission_required');},close:async()=>{}})});t.after(async()=>{port.dispose();await browser.stop();});
 await assert.rejects(()=>port.request({action:'connect'}));assert.equal(settings,0);assert.equal(browser.status().connected,false);
});
