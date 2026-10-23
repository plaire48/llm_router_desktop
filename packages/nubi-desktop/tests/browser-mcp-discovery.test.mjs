import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {McpRegistry} from '../runtime/mcp.mjs';
import {createInAppPlaywright} from '../runtime/playwright-mcp.mjs';
const require=createRequire(import.meta.url),{BrowserRouter}=require('../electron-app/browser-router.cjs'),{BrowserLaunch}=require('../electron-app/external-browser-launch.cjs'),{samsungRunningBrowser}=require('../electron-app/samsung-browser-discovery.cjs'),{ExternalBrowserHost}=require('../electron-app/external-browser-host.cjs'),{createExternalBrowserContentPort}=require('../electron-app/external-browser-content-port.cjs'),{ChromeDirectConnection}=require('../electron-app/chrome-direct-connection.cjs'),{samsungBrowserEndpoint}=require('../electron-app/samsung-browser-discovery.cjs');
const progress='#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><S S="Error">한글 오류_x000D__x000A_</S></Objs>';
async function fixture(t,{failed=false}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-browser-mcp-discovery-'));let probes=0,launches=0;const notices=[];
 const metadata=()=>samsungRunningBrowser({execute:(_file,_args,_options,done)=>{probes++;done(failed?Object.assign(Error(progress),{code:1,stderr:progress}):null,'NUBI_BROWSER_DISCOVERY:'+JSON.stringify({running:false,userDataDir:null,listeners:[]})+'\r\n',progress);}});
 const launch=new BrowserLaunch({platform:'win32',launch:()=>{launches++;assert.fail('must preserve existing browser');},shell:{openExternal:()=>assert.fail('must not use another browser')}}),external=new ExternalBrowserHost();
 const router=new BrowserRouter({internal:{tabs:new Map(),request:async()=>{},create:()=>assert.fail('must not open internally')},external,launch,notify:event=>notices.push(event)}),window=new EventEmitter();window.isDestroyed=()=>false;window.webContents={isDestroyed:()=>false,send(){}};
 const port=createExternalBrowserContentPort({browser:external,router,window,directFactory:()=>new ChromeDirectConnection({endpoint:()=>samsungBrowserEndpoint({metadata})})});
 const registry=new McpRegistry({file:path.join(directory,'mcp.json'),playwright:()=>createInAppPlaywright((action,args,options)=>router.playwright(action,args,options))});
 t.after(async()=>{port.dispose();await external.stop();await registry.dispose();await rm(directory,{recursive:true,force:true});});await registry.connect('playwright');return {registry,port,counts:()=>({probes,launches}),notices};
}
test('browser MCP opens nothing before connection and does not trigger PowerShell discovery',async t=>{
 const f=await fixture(t),reply=await f.registry.call('mcp__playwright__browser_open',{url:'https://example.test'});assert.equal(reply.ok,true);const receipt=JSON.parse(reply.text);assert.equal(receipt.opened,false);assert.equal(receipt.automation,false);assert.equal(receipt.connectionRequired,true);assert.deepEqual(f.counts(),{probes:0,launches:0});assert(f.notices.some(row=>row.type==='browser_connection_required'));assert.doesNotMatch(reply.text,/CLIXML|<Objs/);
 const definition=f.registry.definitions().find(row=>row.function.name==='mcp__playwright__browser_open');assert.match(definition.function.description,/do not repeat launches/i);assert.match(definition.function.description,/PowerShell\/shell workarounds/);
});
test('browser MCP reports the existing failed connection without retrying discovery or exposing CLIXML',async t=>{
 const f=await fixture(t,{failed:true});await assert.rejects(()=>f.port.request({action:'connect'}),error=>{assert.equal(error.message,'browser_samsung_discovery_failed');assert.equal(error.exitCode,1);assert.match(error.cause.message,/CLIXML/);return true;});
 const reply=await f.registry.call('mcp__playwright__browser_open',{url:'https://example.test'}),receipt=JSON.parse(reply.text);assert.equal(receipt.opened,false);assert.equal(receipt.error,'browser_samsung_discovery_failed');assert.doesNotMatch(reply.text,/CLIXML|<Objs/);assert.deepEqual(f.counts(),{probes:1,launches:0});
});
