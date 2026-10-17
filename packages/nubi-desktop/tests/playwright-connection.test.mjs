import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {createInAppPlaywright} from '../runtime/playwright-mcp.mjs';
const {connectTab}=createRequire(import.meta.url)('../electron-app/playwright-tab.cjs');

test('a stalled Electron target lookup releases the debugger and allows a fresh connection',async()=>{
 const debug=new EventEmitter();let attached=false,calls=0;
 Object.assign(debug,{isAttached:()=>attached,attach:()=>{attached=true;},detach:()=>{attached=false;debug.emit('detach');},sendCommand:()=>++calls===1?new Promise(()=>{}):Promise.resolve({targetInfo:{targetId:'fixture'}})});
 const wc=new EventEmitter();Object.assign(wc,{debugger:debug,isDestroyed:()=>false,getTitle:()=>'',getURL:()=> 'http://localhost/',getUserAgent:()=> 'fixture'});
 const row={view:{webContents:wc}};
 await assert.rejects(connectTab(row,{timeout:20}),/browser_cdp_attach_timeout/);
 assert.equal(attached,false);
 const entry=await connectTab(row,{timeout:1000});
 assert.match(entry.endpoint,/^ws:\/\/127\.0\.0\.1:/);entry.close();assert.equal(attached,false);
});

test('persistent pre-action connection failure retries once and reports that no action was issued',async t=>{
 let attaches=0,checks=0;
 const client=await createInAppPlaywright(async action=>{
  if(action==='check'){checks++;return {tabId:'tab',documentId:'doc'};}
  if(action==='attach'){attaches++;throw Error('browser_cdp_attach_timeout');}
  throw Error('unexpected action: '+action);
 });t.after(()=>client.close());
 const result=await client.callTool({name:'browser_click',arguments:{tabId:'tab',documentId:'doc',target:'e1'}});
 assert.equal(result.isError,true);assert.equal(result.structuredContent.actionIssued,false);
 assert.equal(result.structuredContent.stage,'connection');assert.equal(attaches,2);assert.equal(checks,1);
 // Failed entries are evicted, not kept as a permanently pending client.
 await client.callTool({name:'browser_snapshot',arguments:{tabId:'tab'}});assert.equal(attaches,4);
});

test('an unresponsive CDP websocket is released after bounded handshake retries',async t=>{
 const {WebSocketServer}=createRequire(import.meta.url)('ws');
 const server=new WebSocketServer({host:'127.0.0.1',port:0});
 await new Promise(resolve=>server.once('listening',resolve));
 let attaches=0,releases=0;const methods=[];
 server.on('connection',socket=>socket.on('message',bytes=>methods.push(JSON.parse(String(bytes)).method)));
 const client=await createInAppPlaywright(async action=>{
  if(action==='check')return {tabId:'tab',documentId:'doc'};
  if(action==='attach'){attaches++;return {endpoint:`ws://127.0.0.1:${server.address().port}`};}
  if(action==='release'){releases++;for(const socket of server.clients)socket.terminate();return {};}
  throw Error('unexpected action: '+action);
 });
 t.after(async()=>{await client.close();for(const socket of server.clients)socket.terminate();await new Promise(resolve=>server.close(resolve));});
 const result=await client.callTool({name:'browser_click',arguments:{tabId:'tab',documentId:'doc',target:'e1'}});
 assert.equal(result.structuredContent.error,'browser_cdp_connect_timeout');
 assert.equal(result.structuredContent.actionIssued,false);
 assert.equal(attaches,2);assert.equal(releases,2);
 assert.equal(methods.filter(method=>method==='Browser.getVersion').length,2);
 assert.equal(methods.some(method=>method.startsWith('Input.')),false);
});
