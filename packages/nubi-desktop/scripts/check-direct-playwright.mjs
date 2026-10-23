import {chromium} from 'playwright';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm,readdir,access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createInAppPlaywright} from '../runtime/playwright-mcp.mjs';
const require=createRequire(import.meta.url),{ChromeDirectConnection}=require('../electron-app/chrome-direct-connection.cjs'),{ExternalBrowserHost}=require('../electron-app/external-browser-host.cjs'),{BrowserRouter}=require('../electron-app/browser-router.cjs');
const temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-direct-playwright-')),out=path.resolve('verification/direct-playwright-2026-10-23');await mkdir(out,{recursive:true});
let browser,client,direct,external,release;let clicks=0;const calls=[],checks=[];
const server=createServer(async(req,res)=>{if(req.url==='/slow')await new Promise(resolve=>{release=resolve;});if(req.url==='/click'){clicks++;res.end('ok');return;}res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><title>Direct Playwright fixture</title><h1>원래 브라우저 업무</h1><button onclick="fetch(\'/click\')">한 번 실행</button>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
try{
 let executable=process.env.NUBI_TEST_CHROMIUM;const cache=path.join(os.homedir(),'Library/Caches/ms-playwright');
 if(!executable)for(const name of (await readdir(cache)).filter(x=>/^chromium-\d+$/.test(x)).sort((a,b)=>Number(b.split('-')[1])-Number(a.split('-')[1]))){const candidate=path.join(cache,name,'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');try{await access(candidate);executable=candidate;break;}catch{}}
 browser=await chromium.launchPersistentContext(path.join(temporary,'chrome'),{executablePath:executable,headless:true,viewport:null,args:['--remote-debugging-port=0']});const source=browser.pages()[0];await source.goto(origin+'/ready');
 direct=new ChromeDirectConnection({portFile:path.join(temporary,'chrome/DevToolsActivePort')});const candidates=await direct.connect();await direct.choose(candidates[0].id);external=new ExternalBrowserHost();await external.adoptDirect(direct);
 const router=new BrowserRouter({internal:{tabs:new Map(),request:async()=>{}},external,launch:{preference:{mode:'external'},status:()=>({mode:'external'})}});
 client=await createInAppPlaywright(async(action,args,options)=>{calls.push(action);return router.playwright(action,args,options);});
 const started=performance.now(),opened=await client.callTool({name:'browser_open',arguments:{url:origin+'/slow'}});const receipt=JSON.parse(opened.content[0].text);assert(receipt.tabId);checks.push({name:'opening a loading external page retains its exact open receipt',elapsedMs:performance.now()-started,receipt});
 release?.();const target=browser.pages().find(p=>p!==source);await target.getByRole('heading',{name:'원래 브라우저 업무'}).waitFor();
 const snapshot=await client.callTool({name:'browser_snapshot',arguments:{tabId:receipt.tabId}});assert(!snapshot.isError,JSON.stringify(snapshot));const text=snapshot.content.filter(p=>p.type==='text').map(p=>p.text).join('\n');assert.match(text,/원래 브라우저 업무/);checks.push({name:'official Playwright MCP reads the connected external page'});
 const binding=await external.request('check',{tabId:receipt.tabId}),ref=text.match(/button "한 번 실행" \[ref=([^\]]+)\]/)?.[1];assert(ref,text);const result=await client.callTool({name:'browser_click',arguments:{tabId:receipt.tabId,documentId:binding.documentId,element:'한 번 실행',target:ref}});assert(!result.isError,JSON.stringify(result));await target.waitForFunction(async()=>document.readyState==='complete');assert.equal(clicks,1);checks.push({name:'document-bound Playwright click executes exactly once'});
 assert.equal(calls.filter(x=>x==='open').length,1);assert.equal(browser.pages().length,2);await writeFile(path.join(out,'report.json'),JSON.stringify({checks,calls,clicks,scope:'temporary Chromium, direct CDP, real official Playwright MCP; local fixture only, no Samsung Windows or provider'},null,2));console.log(JSON.stringify({checks,calls,clicks}));
}catch(error){await writeFile(path.join(out,'failure.txt'),String(error.stack)+'\n'+JSON.stringify({calls,checks,clicks}));throw error;}
finally{release?.();await client?.close();await external?.stop();if(!external)await direct?.close();await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(temporary,{recursive:true,force:true});}
