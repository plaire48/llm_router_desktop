import {build,stop} from 'esbuild';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {rendererBundleOptions} from './renderer-bundle.mjs';
const phase=process.argv[2]||'after';assert(['before','after','mochi-final'].includes(phase));
const dir=path.resolve('verification/motion-2026-10-17/'+phase);await mkdir(dir,{recursive:true});
await build({...rendererBundleOptions(),entryPoints:['tests/motion-performance-fixture.jsx'],entryNames:'app',outdir:dir,splitting:false});
await build({entryPoints:['ui/workflow-layout-worker.mjs'],outfile:path.join(dir,'chunks/workflow-layout-worker.js'),bundle:true,format:'esm',minify:true});stop();
await writeFile(dir+'/index.html','<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(dir+path.sep))throw Error();const body=await readFile(file);res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream'}).end(body);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;const trials=[],errors=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(let trial=0;trial<3;trial++){
  const page=await browser.newPage({viewport:{width:1200,height:800}});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{Object.defineProperty(navigator,'webdriver',{get:()=>false});window.motionStats={frames:[],longTasks:[],widthWrites:0,transitions:0};new PerformanceObserver(list=>{window.motionStats.longTasks.push(...list.getEntries().map(e=>e.duration));}).observe({type:'longtask',buffered:true});});
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.getByRole('button',{name:'설정 열기'}).waitFor();await page.evaluate(()=>document.fonts.ready);
  const client=await page.context().newCDPSession(page);await client.send('Performance.enable');await client.send('Emulation.setCPUThrottlingRate',{rate:4});
  const before=Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  await page.evaluate(()=>{const root=document.querySelector('main'),set=root.style.setProperty.bind(root.style);root.style.setProperty=(key,...args)=>{if(key==='--nubi-sidebar-width')window.motionStats.widthWrites++;return set(key,...args);};document.addEventListener('pointerdown',e=>window.dragPointer=e.pointerId,{capture:true});let previous=performance.now();window.sampleMotion=true;const sample=now=>{if(!window.sampleMotion)return;window.motionStats.frames.push(now-previous);previous=now;requestAnimationFrame(sample);};requestAnimationFrame(sample);const start=document.startViewTransition.bind(document);document.startViewTransition=(...args)=>{window.motionStats.transitions++;return start(...args);};});
  const separator=page.getByRole('separator'),r=await separator.boundingBox();await page.mouse.move(r.x+4,r.y+100);await page.mouse.down();
  await page.evaluate(async start=>{const handle=document.querySelector('[role=separator]');for(let batch=0;batch<12;batch++){for(let i=0;i<40;i++)handle.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:window.dragPointer,isPrimary:true,clientX:start+70+i}));await new Promise(requestAnimationFrame);}},r.x+4);
  await page.mouse.up();const drag=await separator.getAttribute('aria-valuenow');assert.equal(Number(drag),389,'latest drag position is committed');
  await page.evaluate(async()=>{const pause=ms=>new Promise(r=>setTimeout(r,ms));for(let i=0;i<3;i++){window.motionActions.navigate();await pause(140);}for(let i=0;i<6;i++){window.motionActions.open();await pause(90);for(let j=0;j<4;j++){window.motionActions.resize(4+j*3);await pause(32);}window.motionActions.close();await pause(70);window.motionActions.navigate();await pause(40);}await pause(500);window.sampleMotion=false;});
  const workflowScenes={};for(const layout of ['linear','lanes']){
   await page.evaluate(layout=>{window.workflowLongTasks=[];window.workflowObserver=new PerformanceObserver(list=>window.workflowLongTasks.push(...list.getEntries().map(entry=>entry.duration)));window.workflowObserver.observe({type:'longtask'});window.toggleWorkflow(layout);},layout);await page.locator(`[data-layout=${layout}][data-virtualized="true"] [data-step-kind]`).first().waitFor();assert.ok(await page.locator('[data-step-kind]').count()<50);await page.evaluate(()=>window.toggleWorkflow());await page.waitForTimeout(100);workflowScenes[layout]=await page.evaluate(()=>{window.workflowObserver.disconnect();return window.workflowLongTasks;});assert.equal(workflowScenes[layout].length,0,layout+' workflow mount/unmount must not create a 50ms main-thread task');
  }const workflowLongTasks=workflowScenes.linear,workflowLaneLongTasks=workflowScenes.lanes;
  const after=Object.fromEntries((await client.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
  const result=await page.evaluate(()=>{const s=window.motionStats,frames=s.frames.filter(n=>n>0).sort((a,b)=>a-b);return {...s,frames:frames.length,frameP95:frames[Math.floor(frames.length*.95)],frameMax:Math.max(...frames),framesOver34:frames.filter(n=>n>34).length,motionEnabled:document.documentElement.dataset.modalMotion==='on',leaving:document.querySelectorAll('[data-modal-motion=leaving]').length,surfaces:document.querySelectorAll('.nubi-modal-morph-surface').length,inert:document.querySelector('main').inert};});
  assert(result.motionEnabled&&result.transitions>0,'exercise actual animated paths');assert.equal(result.leaving+result.surfaces,0,'transient layers cleaned');assert.equal(result.inert,false,'input lock released');assert.deepEqual(errors,[]);
  trials.push({...result,workflowNodes:150,workflowLongTasks,workflowLaneLongTasks,trial,metrics:Object.fromEntries(['LayoutCount','RecalcStyleCount','LayoutDuration','RecalcStyleDuration','TaskDuration'].map(k=>[k,after[k]-before[k]]))});await page.close();
 }
 await writeFile(dir+'/result.json',JSON.stringify({phase,trials,errors,boundary:'Three local Chrome trials, 4x CPU throttle, real modal/view-transition/sidebar hooks with synthetic content. Native-device FPS and company flows are separate.'},null,2));console.log(JSON.stringify({phase,trials}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
