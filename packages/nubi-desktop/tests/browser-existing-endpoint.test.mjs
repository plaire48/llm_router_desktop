import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require=createRequire(import.meta.url);
async function server(t,reply){
 const requests=[],s=createServer((req,res)=>{requests.push(req.url);reply(req,res,s.address().port);});await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));
 t.after(()=>{s.closeAllConnections();s.close();});return {port:s.address().port,requests};
}
test('Samsung discovers an already-running fixed-port browser without a discovery file',async t=>{
 const {samsungBrowserEndpoint}=require('../electron-app/samsung-browser-discovery.cjs');
 const f=await server(t,(_req,res,port)=>res.end(JSON.stringify({webSocketDebuggerUrl:`ws://127.0.0.1:${port}/devtools/browser/original`}))),metadata=async()=>({running:true,userDataDir:null,listeners:[{address:'127.0.0.1',port:f.port}]});
 assert.equal(await samsungBrowserEndpoint({metadata,localAppData:path.join(os.tmpdir(),'no-samsung-endpoint')}),`ws://127.0.0.1:${f.port}/devtools/browser/original`);
 assert.deepEqual(f.requests,['/json/version']);
});
test('Samsung uses owned discovery metadata without an HTTP probe for consent-only endpoints',async t=>{
 const {samsungBrowserEndpoint}=require('../electron-app/samsung-browser-discovery.cjs'),dir=await mkdtemp(path.join(os.tmpdir(),'nubi-existing-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const f=await server(t,(_req,res)=>{res.writeHead(404);res.end();});await mkdir(path.join(dir,'Samsung/User Data'),{recursive:true});await writeFile(path.join(dir,'Samsung/User Data/DevToolsActivePort'),`${f.port}\n/devtools/browser/owned\n`);
 assert.equal(await samsungBrowserEndpoint({localAppData:dir,metadata:async()=>({running:true,userDataDir:null,listeners:[{address:'127.0.0.1',port:f.port}]})}),`ws://127.0.0.1:${f.port}/devtools/browser/owned`);assert.deepEqual(f.requests,[]);
});
test('Samsung never probes arbitrary ports or follows endpoint redirects outside the owned loopback listener',async t=>{
 const {samsungBrowserEndpoint}=require('../electron-app/samsung-browser-discovery.cjs');
 for(const endpoint of ['ws://evil.test:9222/devtools/browser/id','ws://127.0.0.1:1/devtools/browser/id','ws://user:secret@127.0.0.1:9222/devtools/browser/id']){
  const f=await server(t,(_req,res)=>res.end(JSON.stringify({webSocketDebuggerUrl:endpoint})));
  await assert.rejects(()=>samsungBrowserEndpoint({metadata:async()=>({running:true,listeners:[{address:'127.0.0.1',port:f.port}]}),localAppData:null}),/browser_samsung_control_unavailable/);assert.deepEqual(f.requests,['/json/version']);
 }
 const f=await server(t,(_req,res)=>{res.writeHead(302,{Location:'https://evil.test/'});res.end();});
 await assert.rejects(()=>samsungBrowserEndpoint({metadata:async()=>({running:true,listeners:[{address:'127.0.0.1',port:f.port}]}),localAppData:null}),/browser_samsung_control_unavailable/);assert.equal(f.requests.length,1);
});
test('Samsung distinguishes no running browser from a running browser without web control',async()=>{
 const {samsungBrowserEndpoint}=require('../electron-app/samsung-browser-discovery.cjs');
 await assert.rejects(()=>samsungBrowserEndpoint({metadata:async()=>({running:false,listeners:[]}),localAppData:null}),/browser_samsung_not_running/);
 await assert.rejects(()=>samsungBrowserEndpoint({metadata:async()=>({running:true,listeners:[]}),localAppData:null}),/browser_samsung_control_unavailable/);
});
test('an explicitly selected Samsung executable scopes existing-process discovery',async t=>{
 const {samsungBrowserEndpoint}=require('../electron-app/samsung-browser-discovery.cjs'),executable='C:\\Samsung\\Application\\browser.exe';let selected;
 const f=await server(t,(_req,res,port)=>res.end(JSON.stringify({webSocketDebuggerUrl:`ws://127.0.0.1:${port}/devtools/browser/selected`})));
 await samsungBrowserEndpoint({executable,localAppData:null,metadata:async args=>{selected=args.executable;return {running:true,listeners:[{address:'127.0.0.1',port:f.port}]};}});
 assert.equal(selected,executable);
});
test('Samsung discovery rejects unowned stale port files and bounds a stalled metadata response',async t=>{
 const {samsungBrowserEndpoint}=require('../electron-app/samsung-browser-discovery.cjs'),dir=await mkdtemp(path.join(os.tmpdir(),'nubi-stale-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const foreign=await server(t,(_req,res)=>res.end('{}'));await mkdir(path.join(dir,'Samsung/User Data'),{recursive:true});await writeFile(path.join(dir,'Samsung/User Data/DevToolsActivePort'),`${foreign.port}\n/devtools/browser/foreign\n`);
 const stalled=await server(t,()=>{}),controller=new AbortController();
 const pending=samsungBrowserEndpoint({metadata:async()=>({running:true,listeners:[{address:'127.0.0.1',port:stalled.port}]}),localAppData:dir,signal:controller.signal});setTimeout(()=>controller.abort(),25);
 await assert.rejects(pending,/dock_cancelled|abort/i);assert.deepEqual(foreign.requests,[]);
});
test('Samsung metadata requests reject oversized responses and stop a stalled listener',{timeout:2500},async t=>{
 const {samsungBrowserEndpoint}=require('../electron-app/samsung-browser-discovery.cjs');
 for(const reply of [(_req,res)=>res.end('x'.repeat(17000)),()=>{}]){
  const f=await server(t,reply);
  await assert.rejects(()=>samsungBrowserEndpoint({localAppData:null,metadata:async()=>({running:true,listeners:[{address:'127.0.0.1',port:f.port}]})}),/browser_samsung_control_unavailable/);
  assert.equal(f.requests.length,1);
 }
});
