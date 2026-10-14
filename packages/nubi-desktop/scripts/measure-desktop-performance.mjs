// Isolated product launch and UI timings; no live accounts or model calls.
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';import os from 'node:os';
import {desktopTestWindow} from './electron-test-window.mjs';
const require=createRequire(import.meta.url),label=process.argv[2]||'candidate';
const out=path.resolve('verification/performance-2026-10-14');await mkdir(out,{recursive:true});
const runs=[];
for(let iteration=0;iteration<3;iteration++){
 const temp=await mkdtemp(path.join(os.tmpdir(),'nubi-performance-')),root=path.join(temp,'project'),storage=path.join(temp,'state');
 await mkdir(root);await mkdir(storage);await writeFile(path.join(root,'example.js'),'export const value = 1;\n');
 for(const args of [['init'],['config','user.name','Fixture'],['config','user.email','fixture@example.invalid'],['add','.'],['commit','-m','Fixture']])execFileSync('git',['-C',root,...args],{stdio:'ignore'});
 await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
 let app;const started=performance.now();
 try{
  app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}});
  const page=await desktopTestWindow(app),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.getByRole('navigation',{name:'프로젝트 도구'}).waitFor();const firstScreenMs=performance.now()-started;
  await page.locator('.desktop-shell[data-startup-ready="true"]').waitFor();
  if(await page.getByText('메일을 연결해 주세요',{exact:true}).count())await page.keyboard.press('Escape');
  await page.waitForFunction(()=>document.querySelector('button[aria-label="파일"]')?.disabled===false);
  const projectReadyMs=performance.now()-started;
  // Enable real view transitions after the opening scene, which automated launches skip.
  await page.evaluate(()=>{Object.defineProperty(navigator,'webdriver',{get:()=>false});window.__perf={frames:[],longTasks:[],transitions:0};const transition=document.startViewTransition.bind(document);document.startViewTransition=(...args)=>{window.__perf.transitions++;return transition(...args);};let previous=performance.now();const step=now=>{window.__perf.frames.push(now-previous);previous=now;window.__perf.frame=requestAnimationFrame(step);};window.__perf.frame=requestAnimationFrame(step);window.__perf.observer=new PerformanceObserver(list=>window.__perf.longTasks.push(...list.getEntries().map(e=>e.duration)));window.__perf.observer.observe({type:'longtask'});});
  const interactions=[];
  for(const [name,selector] of [['AI Workspace','.nubi-skill-page'],['메일','.nubi-mail-history'],['설정','[role="dialog"]']]){
   const trigger=page.getByRole('button',{name,exact:true}).first();
   const begin=performance.now();await trigger.click();await page.locator(selector).first().waitFor({timeout:15000});interactions.push({name,ms:performance.now()-begin});
   if(name==='설정')await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(600);
  const result=await page.evaluate(()=>{const p=window.__perf;cancelAnimationFrame(p.frame);p.observer.disconnect();const frames=p.frames.filter(x=>x<1000).sort((a,b)=>a-b);return {transitions:p.transitions,frameP95Ms:frames[Math.floor(frames.length*.95)],longTasks:p.longTasks,heapBytes:performance.memory?.usedJSHeapSize,paint:performance.getEntriesByType('paint').map(e=>({name:e.name,ms:e.startTime}))};});
  if(result.transitions<2)throw Error('real view transitions were not exercised');
  if(iteration===0){await page.getByRole('button',{name:'AI Workspace',exact:true}).first().click();for(const name of ['앱','Talk']){await page.locator('.nubi-workspace-sections').getByRole('tab',{name,exact:true}).click();await page.getByRole('button',{name:'사내 Github SSO 로그인',exact:true}).waitFor();}await page.waitForFunction(()=>[...document.querySelectorAll('img.nubi-team-mark')].every(img=>img.complete&&img.naturalWidth>0));await page.screenshot({path:path.join(out,label+'-workspace.png')});}
  if(errors.length)throw Error(JSON.stringify(errors));
  runs.push({firstScreenMs,projectReadyMs,interactions,...result});console.log(JSON.stringify(runs.at(-1)));
 }finally{await app?.close();await rm(temp,{recursive:true,force:true});}
}
const outputs=JSON.parse(await readFile('generated/electron-bundle.json','utf8')).outputs,seen=new Set();
const visit=file=>{if(seen.has(file)||!outputs[file])return;seen.add(file);for(const item of outputs[file].imports||[])if(item.kind!=='dynamic-import')visit(item.path);};visit('electron-app/lib/frontend/renderer.js');
await writeFile(path.join(out,label+'.json'),JSON.stringify({label,runs,initialJsBytes:[...seen].filter(file=>file.endsWith('.js')).reduce((sum,file)=>sum+outputs[file].bytes,0),boundary:'Local macOS Electron, isolated small Git project, real view transitions. Opening cinematic skipped by automation; no live model, company SSO or Windows performance claim.'},null,2)+'\n');
