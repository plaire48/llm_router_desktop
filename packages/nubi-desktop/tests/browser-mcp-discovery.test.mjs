import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {McpRegistry} from '../runtime/mcp.mjs';
import {createInAppPlaywright} from '../runtime/playwright-mcp.mjs';
const require=createRequire(import.meta.url),{BrowserRouter}=require('../electron-app/browser-router.cjs'),{BrowserLaunch}=require('../electron-app/external-browser-launch.cjs'),{samsungInstallation}=require('../electron-app/samsung-browser-discovery.cjs');
const progress='#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><S S="Error">한글 오류_x000D__x000A_</S></Objs>';
async function fixture(t,{failed=false}={}){
 const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-browser-mcp-discovery-'));let probes=0,launches=0;const notices=[];
 const launch=new BrowserLaunch({platform:'win32',resolveSamsung:()=>samsungInstallation({execute:(_file,_args,_options,done)=>{probes++;done(failed?Object.assign(Error(progress),{code:1,stderr:progress}):null,'NUBI_BROWSER_DISCOVERY:'+JSON.stringify({executable:'C:\\Samsung\\browser.exe',userDataDir:null})+'\r\n',progress);}}),launch:(file,args,options)=>{launches++;assert.equal(file,'C:\\Samsung\\browser.exe');assert.deepEqual(args,['https://example.test/']);assert.equal(options.shell,false);const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;},shell:{openExternal:()=>assert.fail('must not use another browser')}});
 const router=new BrowserRouter({internal:{tabs:new Map(),request:async()=>{},create:()=>assert.fail('must not open internally')},external:{status:()=>({connected:false}),request:()=>assert.fail('no automation before connection')},launch,notify:event=>notices.push(event)});
 const registry=new McpRegistry({file:path.join(directory,'mcp.json'),playwright:()=>createInAppPlaywright((action,args,options)=>router.playwright(action,args,options))});
 t.after(async()=>{await registry.dispose();await rm(directory,{recursive:true,force:true});});await registry.connect('playwright');return {registry,counts:()=>({probes,launches}),notices};
}
test('browser MCP opens Samsung once after framed discovery even if stderr contains progress CLIXML',async t=>{
 const f=await fixture(t),reply=await f.registry.call('mcp__playwright__browser_open',{url:'https://example.test'});assert.equal(reply.ok,true);const receipt=JSON.parse(reply.text);assert.equal(receipt.opened,true);assert.equal(receipt.automation,false);assert.equal(receipt.connectionRequired,true);assert.deepEqual(f.counts(),{probes:1,launches:1});assert(f.notices.some(row=>row.type==='browser_connection_required'));assert.doesNotMatch(reply.text,/CLIXML|<Objs/);
 const definition=f.registry.definitions().find(row=>row.function.name==='mcp__playwright__browser_open');assert.match(definition.function.description,/do not repeat launches/);assert.match(definition.function.description,/PowerShell\/shell workarounds/);
});
test('browser MCP retains a real PowerShell failure and never launches or retries a browser',async t=>{
 const f=await fixture(t,{failed:true});await assert.rejects(f.registry.call('mcp__playwright__browser_open',{url:'https://example.test'}),error=>{assert.equal(error.message,'browser_samsung_discovery_failed');assert.equal(error.exitCode,1);assert.match(error.cause.message,/CLIXML/);return true;});assert.deepEqual(f.counts(),{probes:1,launches:0});
});
