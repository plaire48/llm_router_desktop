// Diagnostic only: never used to pass the performance gate. Compare the
// accepted QA90 source with/without ambient motion and the P2 candidate.
import {build,stop} from 'esbuild';
import {_electron as electron} from 'playwright';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile,mkdtemp,rm,cp} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {rendererBundleOptions} from './renderer-bundle.mjs';
const tag=process.env.MOTION_DIAGNOSTIC_TAG||'wiki-diagnostic';if(!/^[a-z0-9-]+$/.test(tag))throw Error('invalid diagnostic tag');
const root=path.resolve('verification/motion-1.3.0/'+tag);await mkdir(root,{recursive:true});
const variants=['qa90-on','qa90-paused','candidate-on'],results=[];const require=createRequire(import.meta.url);
for(const variant of variants){
 const dir=path.join(root,variant);await mkdir(dir,{recursive:true});
 const previous={name:'qa90-source',setup(builder){const cache=new Map();builder.onLoad({filter:/\.(css|jsx|mjs|js)$/},async args=>{
  const relative=path.relative(process.cwd(),args.path).split(path.sep).join('/');if(variant==='candidate-on'||!['design/','ui/','electron-app/'].some(prefix=>relative.startsWith(prefix)))return;
  if(!cache.has(relative)){try{cache.set(relative,execFileSync('git',['show','70742a64:packages/nubi-desktop/'+relative],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));}catch{cache.set(relative,null);}}
  const contents=cache.get(relative);if(contents!==null)return {contents,loader:relative.endsWith('.jsx')?'jsx':relative.endsWith('.css')?'css':'js',resolveDir:path.dirname(args.path)};
 });}};
 await build({...rendererBundleOptions(),plugins:[...rendererBundleOptions().plugins,previous],entryPoints:['tests/freeze-scenes-fixture.jsx'],entryNames:'app',outdir:dir,minify:true});
 for(const name of ['wiki','workflow'])await build({entryPoints:[`ui/${name}-layout-worker.mjs`],outfile:path.join(dir,'chunks',name+'-layout-worker.js'),bundle:true,format:'esm',minify:true});stop();
 await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
 await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
 const server=createServer(async(req,res)=>{try{const file=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(dir+path.sep))throw Error();res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream'}).end(await readFile(file));}catch{res.writeHead(404).end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const storage=await mkdtemp(path.join(os.tmpdir(),'nubi-motion-wiki-'));let app;
 try{
  app=await electron.launch({executablePath:require('electron'),args:['tests/freeze-electron.cjs',`http://127.0.0.1:${server.address().port}`],env:{...process.env,NUBI_FREEZE_STORAGE:storage,ELECTRON_RUN_AS_NODE:undefined},cwd:process.cwd()});
  const page=await app.firstWindow();await page.addInitScript(()=>Object.defineProperty(navigator,'webdriver',{get:()=>false}));await page.reload();await page.waitForFunction(()=>window.freezeReady);await page.evaluate(()=>document.fonts.ready);await app.evaluate(()=>globalThis.__nubiFreezePrepareInput());
  if(variant.endsWith('paused'))await page.evaluate(()=>{const pause=()=>{for(const animation of document.getAnimations())if(animation.effect.getTiming().iterations===Infinity)animation.pause();};document.addEventListener('animationstart',pause,true);window.diagnosticPause=pause;pause();});
  const client=await page.context().newCDPSession(page),trace=[];client.on('Tracing.dataCollected',event=>trace.push(...event.value));const done=new Promise(resolve=>client.once('Tracing.tracingComplete',resolve));
  await client.send('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing,cc',transferMode:'ReportEvents'});
  await page.evaluate(()=>{window.wikiDiagnostic={frames:[],tasks:[],ambient:[],images:[]};new PerformanceObserver(list=>window.wikiDiagnostic.tasks.push(...list.getEntries().map(entry=>({at:entry.startTime,duration:entry.duration})))).observe({type:'longtask'});let before;const frame=now=>{if(window.stopWikiDiagnostic)return;if(before!==undefined)window.wikiDiagnostic.frames.push({at:now,interval:now-before});before=now;requestAnimationFrame(frame);};requestAnimationFrame(frame);performance.mark('wiki-diagnostic-start');window.freezeOpen('wiki');});
  await page.getByRole('heading',{name:'위키',exact:true}).waitFor();
  await page.waitForTimeout(350);
  const mounted=await page.evaluate(()=>({animations:document.getAnimations().map(animation=>({name:animation.animationName,duration:animation.effect.getTiming().duration,state:animation.playState,iterations:animation.effect.getTiming().iterations===Infinity?'infinite':animation.effect.getTiming().iterations})),images:[...document.images].map(image=>({src:new URL(image.src).pathname,loaded:image.complete,width:image.naturalWidth}))}));
  await page.getByRole('tab',{name:'관계 지도',exact:true}).click();const nodes=page.locator('.nubi-wiki-map svg [role=button]');await nodes.first().waitFor();await nodes.first().focus();await page.keyboard.press('Enter');await page.locator('.nubi-wiki-document:not([hidden]) h2').first().waitFor();
  const end=Date.now()+12000;while(Date.now()<end){await page.locator('#freeze-probe').click();await page.waitForTimeout(180);}
  const raw=await page.evaluate(()=>{window.stopWikiDiagnostic=true;return window.wikiDiagnostic;});await client.send('Tracing.end');await done;
  const decode=trace.filter(event=>/Decode.*Image|ImageDecode|RasterTask|PaintImage/i.test(event.name||'')).map(event=>({name:event.name,at:event.ts,durationMs:(event.dur||0)/1000}));
  const summary={variant,mounted,frames:raw.frames.length,frameMax:Math.max(...raw.frames.map(frame=>frame.interval)),longTasks:raw.tasks,decode:decode.sort((a,b)=>b.durationMs-a.durationMs).slice(0,12)};results.push(summary);
  await writeFile(path.join(dir,'frames.json'),JSON.stringify(raw));await writeFile(path.join(dir,'trace.json'),JSON.stringify({traceEvents:trace}));await page.screenshot({path:path.join(dir,'wiki-1280.png')});console.log(JSON.stringify(summary));
 }finally{server.closeAllConnections();await app?.close();await new Promise(resolve=>server.close(resolve));await rm(storage,{recursive:true,force:true});}
}
await writeFile(path.join(root,'result.json'),JSON.stringify({boundary:'Diagnostic paired trials; ambient-paused is NOT a gate result. QA90 source projected without checkout. Tracing changes overhead. Does not establish the historical 560.9ms cause.',results},null,2));
