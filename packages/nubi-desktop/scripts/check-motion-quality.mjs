import {killProcessTree} from './electron-test-window.mjs';
import {DESIGN_MOTION_FILES,sourceDesignIssues} from './design-rules.mjs';
import {captureDesign} from './design-rules.mjs';
// P2 red baseline. This collects current product styles and real Workbench
// animations; missing coverage must be completed before the P2 gate is green.
import {build,stop} from 'esbuild';
import {chromium,_electron as electron} from 'playwright';
import {mkdir,readFile,writeFile,cp,mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {rendererBundleOptions} from './renderer-bundle.mjs';
import {springSamples} from './motion-spring.mjs';
import {parseAmbientRegistry} from '../ui/motion-policy.mjs';
import {isSharedRunner,recordUnjudged} from './admission-calibration.mjs';

const tag=process.env.MOTION_TAG||'after-1';if(!/^[a-z0-9-]+$/.test(tag))throw Error('invalid motion tag');
const dir=path.resolve('verification/motion-1.3.0/'+tag);
await mkdir(dir,{recursive:true});
const result={boundary:'Local Chrome, actual Workbench/CX hooks and controls, synthetic data. No connected services or Windows proof.',checks:[],scenes:[],errors:[]};
const check=(name,pass,detail)=>result.checks.push({name,pass,detail});
// Frame gaps and wall-clock durations are judged on target hardware (local Mac, Windows).
// A shared runner records them as unjudged and keeps every functional check (§8 답 15).
const sharedRunner=isSharedRunner(),unjudgedTimings=[];
const timing=(name,pass,detail)=>{if(pass||!sharedRunner)return check(name,pass,detail);unjudgedTimings.push({name,detail});result.checks.push({name,pass:true,verdict:'unjudged',detail});};
let tokens='';
try{tokens=await readFile('design/workspace-motion.css','utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
for(const [name,ms] of Object.entries({enter:280,exit:180,press:120,state:180}))check('token:'+name,new RegExp(`--nubi-motion-${name}:\\s*${ms}ms`).test(tokens),{expected:ms});
const cssFiles=DESIGN_MOTION_FILES;
const literals=[],all=[];
for(const file of cssFiles){
 const source=(await readFile(file,'utf8')).replace(/\/\*[\s\S]*?\*\//g,'');
 for(const finding of sourceDesignIssues(file,source)){if(finding.rule==='motion_literal')literals.push(finding);if(finding.rule==='transition_all')all.push(finding);}
}
check('hardcoded-duration-zero',literals.length===0,literals);
check('transition-all-zero',all.length===0,all);
await build({...rendererBundleOptions(),entryPoints:[],stdin:{contents:"if(new URLSearchParams(location.search).has('quality-controls'))await import('./tests/motion-quality-fixture.jsx');else await import('./tests/shared-ui-fixture.jsx'); import './electron-app/modal-motion.css'; import {installModalMotion} from './ui/modalMotion.js'; window.stopQualityMotion=installModalMotion();",resolveDir:process.cwd(),loader:'jsx'},entryNames:'app',outdir:dir,splitting:false});stop();
await build({entryPoints:['ui/workflow-layout-worker.mjs'],outfile:path.join(dir,'chunks/workflow-layout-worker.js'),bundle:true,format:'esm',minify:true});stop();
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(dir+path.sep))throw Error('outside');const body=await readFile(file);res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.webp':'image/webp','.png':'image/png'})[path.extname(file)]||'application/octet-stream'}).end(body);}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser,electronApp,storage;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const width of (process.env.MOTION_VISIBILITY_ONLY?[]:[1280,440]))for(const reduced of [false,true]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:reduced?'reduce':'no-preference'});
  page.on('pageerror',error=>result.errors.push(error.message));
  await page.addInitScript(()=>{
   Object.defineProperty(navigator,'webdriver',{get:()=>false});window.qualityTasks=[];
   // Attach completion timing at animationstart inside the page. Reading an
   // already-finished animation through later CDP calls measures transport
   // delay as well as motion, which is not the animation's completion time.
   window.qualityWalls=[];const measured=new WeakSet();
   document.addEventListener('animationstart',event=>{
    if(!/^nubi-modal-.*-(in|out)$/.test(event.animationName))return;
    for(const animation of event.target.getAnimations())if(animation.animationName===event.animationName&&!measured.has(animation)){
     measured.add(animation);window.qualityWalls.push({phase:event.animationName.endsWith('-in')?'in':'out',done:(async()=>{await animation.ready;const start=animation.startTime;await animation.finished;return {name:animation.animationName,elapsed:performance.now()-start};})()});
    }
   },true);
   new PerformanceObserver(list=>window.qualityTasks.push(...list.getEntries().map(entry=>({at:entry.startTime,duration:entry.duration})))).observe({type:'longtask'});
   window.qualityTrack=()=>{const frames=[],counts=[],captured=[];const seen=new Set();let previous;const start=performance.now();let active=true;const frame=now=>{if(!active)return;if(previous!==undefined)frames.push({at:now,interval:now-previous});previous=now;const animations=document.getAnimations().filter(animation=>animation.playState==='running');for(const animation of animations){const key=animation.animationName+':'+animation.transitionProperty+':'+animation.effect.pseudoElement+':'+animation.effect.target?.className;if(!seen.has(key)){seen.add(key);captured.push({name:animation.animationName||animation.id||animation.transitionProperty,target:String(animation.effect.target?.className?.baseVal??animation.effect.target?.className??''),pseudo:animation.effect.pseudoElement,duration:animation.effect.getTiming().duration,frames:animation.effect.getKeyframes()});}}const interactions=animations.filter(animation=>!window.qualityAmbient.has(animation.animationName));counts.push({at:now,ambient:animations.length-interactions.length,interactionTargets:new Set(interactions.map(animation=>animation.effect.pseudoElement||animation.effect.target)).size});requestAnimationFrame(frame);};requestAnimationFrame(frame);return()=>{active=false;return {start,end:performance.now(),frames,counts,captured,longTasks:window.qualityTasks.filter(task=>task.at>=start)};};};
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/?catalog&integrated`);
  await page.locator('.welcome').waitFor();await page.evaluate(()=>document.fonts.ready);
  // Start-up branding is an explicit P2 exception. Observe the stable screen
  // only after its actual removal, rather than counting that exception as a defect.
  await page.waitForFunction(()=>!document.querySelector('.nubi-connecting,.nubi-intro'));
  await page.waitForFunction(()=>[...document.querySelectorAll('.agent-mark img')].every(image=>image.complete&&image.naturalWidth>0));
  const ambient=await page.evaluate(()=>document.getAnimations().filter(animation=>animation.playState==='running').map(animation=>({name:animation.animationName||animation.transitionProperty||'WAAPI',target:String(animation.effect?.target?.className?.baseVal??animation.effect?.target?.className??''),duration:animation.effect.getTiming().duration,iterations:animation.effect.getTiming().iterations===Infinity?'infinite':animation.effect.getTiming().iterations})));
  const registry=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--nubi-ambient-registry'));
  const names=parseAmbientRegistry(registry);await page.evaluate(names=>window.qualityAmbient=new Set(names),[...names.keys()]);
  if(!reduced)check(`pastel-path-exercised:${width}`,ambient.some(animation=>animation.name==='nubi-pastel-flow'),ambient);
  await page.mouse.move(-1,-1);
  check(`ambient-registered:${width}:${reduced}`,ambient.filter(animation=>animation.iterations==='infinite').every(animation=>names.has(animation.name)),ambient);
  check(`interaction-concurrency:${width}:${reduced}`,ambient.filter(animation=>!names.has(animation.name)).length<=3,ambient);
  if(reduced)check(`reduced-ambient:${width}`,ambient.every(animation=>animation.iterations!=='infinite'),ambient);
  await captureDesign(page,{path:path.join(dir,`welcome-${width}-${reduced?'reduced':'normal'}.png`)});
  await page.evaluate(()=>{window.qualityStop=window.qualityTrack();});
  const settings=page.getByRole('button',{name:'설정',exact:true});await settings.click();
  const dialog=page.getByRole('dialog',{name:'설정',exact:true});await dialog.waitFor();
  const opening=await page.locator('.cx-panel-backdrop').evaluate(backdrop=>[...backdrop.getAnimations(),...backdrop.querySelector(':scope > .cx-detail-panel').getAnimations()].map(animation=>({name:animation.animationName,duration:animation.effect.getTiming().duration,frames:animation.effect.getKeyframes()})));
  check(`modal-enter:${width}:${reduced}`,opening.length===2&&opening.every(animation=>Math.abs(animation.duration-(reduced?120:280))<=20&&(!reduced||animation.frames.every(frame=>!('transform' in frame)))),opening);
  await page.waitForFunction(()=>window.qualityWalls.filter(row=>row.phase==='in').length===2);const openWall=await page.evaluate(()=>Promise.all(window.qualityWalls.filter(row=>row.phase==='in').map(row=>row.done)));
  timing(`modal-wall-open:${width}:${reduced}`,openWall.length===2&&openWall.every(row=>Math.abs(row.elapsed-(reduced?120:280))<=20),openWall);
  const during=await page.evaluate(()=>window.qualityStop());
  timing(`modal-long-tasks:${width}:${reduced}`,during.longTasks.length===0,during);
  check(`modal-budget:${width}:${reduced}`,during.counts.every(row=>row.interactionTargets<=3),during.counts);
  check(`modal-ambient-paused:${width}:${reduced}`,await page.evaluate(()=>document.getAnimations().filter(a=>window.qualityAmbient.has(a.animationName)).every(a=>a.playState==='paused')),null);
  if(width===440){const sheet=await dialog.evaluate(element=>({bottom:element.getBoundingClientRect().bottom,viewport:innerHeight,radius:getComputedStyle(element).borderBottomLeftRadius}));check(`narrow-bottom-sheet:${reduced}`,Math.abs(sheet.bottom-sheet.viewport)<1&&sheet.radius==='0px',sheet);}
  if(width===1280){const headings=await page.locator('.nubi-sidebar-quick-actions button').evaluateAll(buttons=>buttons.map(button=>{const b=button.getBoundingClientRect(),label=button.querySelector('span'),r=label?.getBoundingClientRect();return {left:b.left,right:b.right,labelLeft:r?.left,labelRight:r?.right};}));check(`sidebar-modal-labels:${reduced}`,headings.length>1&&headings.every((b,i)=>i===0||b.left>=headings[i-1].right-1)&&headings.every(b=>b.labelLeft===undefined||b.labelLeft>=b.left-1&&b.labelRight<=b.right+1),headings);}
  await captureDesign(page,{path:path.join(dir,`modal-${width}-${reduced?'reduced':'normal'}.png`)});
  await page.keyboard.press('Escape');
  const closing=await page.locator('[data-modal-motion="leaving"]').evaluateAll(backdrops=>backdrops.flatMap(backdrop=>[...backdrop.getAnimations(),...backdrop.querySelector(':scope > .cx-detail-panel').getAnimations()].map(animation=>({name:animation.animationName,duration:animation.effect.getTiming().duration}))));
  check(`modal-exit:${width}:${reduced}`,closing.length===2&&closing.every(animation=>Math.abs(animation.duration-(reduced?120:180))<=20),closing);
  await page.waitForFunction(()=>window.qualityWalls.filter(row=>row.phase==='out').length===2);const closeWall=await page.evaluate(()=>Promise.all(window.qualityWalls.filter(row=>row.phase==='out').map(row=>row.done)));
  timing(`modal-wall-close:${width}:${reduced}`,closeWall.length===2&&closeWall.every(row=>Math.abs(row.elapsed-(reduced?120:180))<=20),closeWall);
  await page.locator('[data-modal-motion="leaving"]').waitFor({state:'detached'});
  // Preserve every mounted ambient Animation, including pseudo-element pastel
  // layers and actual CX spinner classes, across preference changes.
  await page.evaluate(()=>{const probe=document.createElement('div');probe.className='nubi-progress-atmosphere';probe.innerHTML='<i class="status-spinner"></i><i class="status-spinner nubi-mail-watching-spinner"></i><div class="nubi-progress is-indeterminate"><span></span></div>';document.querySelector('.desktop-shell').append(probe);const answers=document.createElement('div');answers.className='nubi-workbench';const model=document.createElement('div');model.className='answer-model';answers.append(model);for(const mood of ['idle','working','celebrate']){const mark=document.querySelector('.agent-mark').cloneNode(true);mark.classList.add('nubi-answer-mark');mark.dataset.mood=mood;model.append(mark);}answers.insertAdjacentHTML('beforeend','<div class="nubi-agent-activity" data-activity-live="true"><details class="agent-trace"><summary><span class="agent-trace-title">합성 진행 상태</span></summary></details></div>');document.querySelector('.desktop-shell').append(answers);});
  await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForTimeout(70);
  const phase=await page.evaluate(()=>{window.qualityAmbientRefs=document.getAnimations().filter(a=>window.qualityAmbient.has(a.animationName)&&a.playState==='running');return window.qualityAmbientRefs.map(a=>({name:a.animationName,at:a.currentTime,duration:a.effect.getTiming().duration}));});
  const answerMarks=await page.locator('.answer-model .nubi-answer-mark').evaluateAll(marks=>marks.map(mark=>({animation:getComputedStyle(mark).animationName,transform:getComputedStyle(mark).transform,images:[...mark.querySelectorAll('img')].map(image=>getComputedStyle(image).animationName)})));
  check(`answer-static-baseline:${width}:${reduced}`,answerMarks.length===3&&answerMarks.every(mark=>mark.animation==='none'&&mark.transform==='none'&&mark.images.every(name=>name==='none')),answerMarks);
  check(`live-progress-paths:${width}:${reduced}`,phase.some(a=>a.name==='nubi-live-spin')&&phase.some(a=>a.name==='nubi-live-breathe'),phase);
  check(`spinner-periods:${width}:${reduced}`,phase.some(a=>a.name==='master-spin'&&a.duration===800)&&phase.some(a=>a.name==='master-spin'&&a.duration===2400),phase);
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(70);
  const paused=await page.evaluate(()=>window.qualityAmbientRefs.map(a=>({name:a.animationName,same:document.getAnimations().includes(a),state:a.playState,at:a.currentTime})));
  await page.waitForTimeout(70);const held=await page.evaluate(()=>window.qualityAmbientRefs.map(a=>a.currentTime));
  check(`ambient-same-phase:${width}:${reduced}`,paused.length>0&&paused.every((a,i)=>a.same&&a.state==='paused'&&Math.abs(held[i]-a.at)<1),{phase,paused,held});
  await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForTimeout(70);
  const readResumed=()=>page.evaluate(()=>window.qualityAmbientRefs.map(a=>({name:a.animationName,same:document.getAnimations().includes(a),state:a.playState,at:a.currentTime})));
  let resumed=await readResumed();
  for(let waited=70;sharedRunner&&waited<2000&&!resumed.every((a,i)=>a.at>held[i]);waited+=100){await page.waitForTimeout(100);resumed=await readResumed();}
  check(`ambient-resume:${width}:${reduced}`,resumed.every((a,i)=>a.same&&a.state==='running'&&a.at>held[i]),{held,resumed});
  const attention=await page.evaluate(async()=>{
   const workbench=document.querySelector('.nubi-workbench'),sentinel=document.createElement('span');sentinel.className='nubi-task';workbench.append(sentinel);
   const art=[...document.getAnimations()].filter(a=>a.effect.target?.matches?.('.deck-blob,.deck-spark')&&a.effect.target.closest('.deck-ambient')&&workbench.contains(a.effect.target));
   document.documentElement.setAttribute('data-nubi-transition','');document.dispatchEvent(new Event('nubi-motion-change'));
   document.documentElement.removeAttribute('data-nubi-transition');document.dispatchEvent(new Event('nubi-motion-change'));
   await Promise.all(art.map(a=>a.ready));
   const paused=art.map(a=>({name:a.animationName,target:a.effect.target.className,same:document.getAnimations().includes(a),state:a.playState,at:a.currentTime}));await new Promise(resolve=>setTimeout(resolve,70));
   const held=art.map(a=>a.currentTime);sentinel.remove();await new Promise(resolve=>setTimeout(resolve,70));
   return {paused,held,resumed:art.map(a=>({same:document.getAnimations().includes(a),state:a.playState,at:a.currentTime}))};
  });
  check(`work-attention-pause:${width}:${reduced}`,attention.paused.length>0&&attention.paused.every((a,i)=>a.same&&a.state==='paused'&&Math.abs(a.at-attention.held[i])<1)&&attention.resumed.every((a,i)=>a.same&&a.state==='running'&&a.at>attention.held[i]),attention);
  await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});
  result.scenes.push({width,reduced,ambient,opening,closing,transition:during,openWall,closeWall,phase:{paused,held,resumed}});
  await page.goto(`http://127.0.0.1:${server.address().port}/?quality-controls`);
  await page.locator('.nubi-workflow-node').first().waitFor();await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(names=>window.qualityAmbient=new Set(names),[...names.keys()]);
  await page.waitForTimeout(320);
  for(const [kind,selector] of [['button','.nubi-settings-row'],['row','.nubi-session-select'],['card','.nubi-start-card'],['node','.nubi-workflow-node']]){
   const control=page.locator(selector).first();await control.scrollIntoViewIfNeeded();const box=await control.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.waitForTimeout(300);const hovered=await control.evaluate(element=>getComputedStyle(element).transform);check(`hover-color-only:${kind}:${width}:${reduced}`,hovered==='none',hovered);await page.mouse.down();await page.waitForTimeout(140);
   const pressed=await control.evaluate(element=>({transform:getComputedStyle(element).transform,opacity:getComputedStyle(element).opacity,duration:getComputedStyle(element).transitionDuration}));
   check(`press:${kind}:${width}:${reduced}`,reduced?pressed.transform==='none':Math.abs(Number(pressed.transform.match(/matrix\(([^,]+)/)?.[1])-.98)<.002,pressed);
   await page.mouse.up();const release=await control.evaluate(element=>element.getAnimations().map(a=>({duration:a.effect.getTiming().duration,easing:a.effect.getTiming().easing,frames:a.effect.getKeyframes()})));
   check(`release:${kind}:${width}:${reduced}`,release.some(animation=>Math.abs(animation.duration-(reduced?120:280))<=20&&animation.frames.some(frame=>reduced?'opacity' in frame:'transform' in frame)&& (reduced||animation.easing.startsWith('linear(')))&&release.every(animation=>animation.duration<=(reduced?120:300)),release);await page.waitForTimeout(300);
  }
  const list=await page.evaluate(async()=>{
   const rows=[],seen=new Set();const collect=async()=>{const end=performance.now()+240;while(performance.now()<end){for(const a of document.getAnimations())if(a.id.startsWith('nubi-list-')&&!seen.has(a)){seen.add(a);rows.push({id:a.id,duration:a.effect.getTiming().duration,frames:a.effect.getKeyframes()});}await new Promise(requestAnimationFrame);}};
   window.qualityAdd();await collect();window.qualityRemove();await collect();return rows;
  });
  check(`list-height-fade:${width}:${reduced}`,list.some(row=>row.id==='nubi-list-enter')&&list.some(row=>row.id==='nubi-list-exit')&&list.every(row=>row.duration===(reduced?120:180)&&row.frames.every(frame=>reduced?!('height' in frame):'height' in frame)),list);
  await page.evaluate(()=>window.qualityLoad());await page.locator('[data-quality-loaded]').waitFor();
  const load=await page.locator('[data-quality-loaded]').evaluate(element=>({width:element.offsetWidth,animations:element.getAnimations().map(a=>({duration:a.effect.getTiming().duration,frames:a.effect.getKeyframes()}))}));
  check(`load:${width}:${reduced}`,load.width>0&&load.animations.some(a=>a.duration===120),load);await page.waitForTimeout(160);
  await page.evaluate(()=>window.qualityStatus());await page.locator('.nubi-workflow-node[data-status=complete]').waitFor();
  const state=await page.locator('.nubi-workflow-node[data-status=complete] .nubi-workflow-node-state').evaluate(element=>element.getAnimations().map(animation=>({duration:animation.effect.getTiming().duration,frames:animation.effect.getKeyframes()})));
  check(`state-color:${width}:${reduced}`,state.some(animation=>animation.duration===(reduced?120:180)),state);await page.waitForTimeout(220);
  await page.evaluate(()=>{window.qualityStop=window.qualityTrack();window.qualityNavigate();});await page.waitForTimeout(420);
  const view=await page.evaluate(()=>window.qualityStop());timing(`view-long-tasks:${width}:${reduced}`,view.longTasks.length===0,view.longTasks);check(`view-budget:${width}:${reduced}`,view.counts.every(row=>row.interactionTargets<=3),view.counts);
  check(`view-exercised:${width}:${reduced}`,view.captured.some(row=>/^nubi-(view|motion-fade)/.test(row.name)),view.captured);
  const metadata=new Set(['offset','computedOffset','easing','composite']),allowed=new Set(['transform','opacity','color','backgroundColor','borderColor','borderTopColor','borderRightColor','borderBottomColor','borderLeftColor','fill','stroke']);
  const properties=[...during.captured,...view.captured,...opening,...list].flatMap(row=>row.frames.flatMap(frame=>Object.keys(frame).filter(key=>!metadata.has(key)&&!allowed.has(key)&&!(key==='height'&&row.id?.startsWith('nubi-list-')))));
  check(`compositor-properties:${width}:${reduced}`,properties.length===0,properties);
  result.scenes.at(-1).view=view;result.scenes.at(-1).list=list;
  check(`view-ambient-paused:${width}:${reduced}`,view.counts.filter(row=>row.interactionTargets>0).every(row=>row.ambient===0),view.counts);
  await captureDesign(page,{path:path.join(dir,`controls-${width}-${reduced?'reduced':'normal'}.png`)});await page.close();
 }
 // Load the actual component stylesheet: controls do not mount the host cover.
 {const probe=await browser.newPage({viewport:{width:440,height:900}});await probe.goto(`http://127.0.0.1:${server.address().port}/?quality-controls`);await probe.locator('.nubi-main').waitFor();const css=await readFile('ui/project-switch-cover.css','utf8');
 const measure=()=>{const section=document.createElement('section');section.className='nubi-git-clone-progress';section.innerHTML='<progress aria-label="합성 불확정 진행"></progress>';document.querySelector('.nubi-main').append(section);const bar=section.firstElementChild,style=getComputedStyle(bar),width=bar.clientWidth,imageWidth=parseFloat(style.backgroundSize)/100*width,left=parseFloat(style.backgroundPositionX)/100*(width-imageWidth),value={width,imageWidth,left,visible:Math.max(0,Math.min(width,left+imageWidth)-Math.max(0,left)),play:style.animationPlayState};section.remove();return value;};
 const oldStyle=await probe.addStyleTag({content:css.replace('center / 30%','-43% center / 30%')});const before=await probe.evaluate(measure);await oldStyle.evaluate(node=>node.remove());await probe.addStyleTag({content:css});const fill=await probe.evaluate(measure);check('indeterminate-fill-regression',Number.isFinite(before.visible)&&before.visible===0,before);check('indeterminate-fill-visible',fill.width>0&&Number.isFinite(fill.visible)&&fill.visible>0,fill);await probe.close();}
 // Actual native visibility, using an isolated Electron window and userData.
 storage=await mkdtemp(path.join(os.tmpdir(),'nubi-motion-'));
 const require=createRequire(import.meta.url);
 console.log('native: launch');
 electronApp=await electron.launch({executablePath:require('electron'),args:['tests/motion-electron.cjs',`http://127.0.0.1:${server.address().port}/?catalog&integrated`],env:{...process.env,NUBI_FREEZE_STORAGE:storage,ELECTRON_RUN_AS_NODE:undefined},cwd:process.cwd(),timeout:15000});
 console.log('native: first window');
 const native=await electronApp.firstWindow();native.on('pageerror',error=>result.errors.push(error.message));await native.evaluate(()=>Object.defineProperty(navigator,'webdriver',{get:()=>false}));
 console.log('native: welcome');
 await native.locator('.welcome').waitFor();await native.waitForFunction(()=>!document.querySelector('.nubi-connecting,.nubi-intro'));
 console.log('native: ready');await native.evaluate(()=>{window.nativeAmbient=document.getAnimations().filter(animation=>animation.effect.getTiming().iterations===Infinity&&animation.playState==='running');window.visibilityEvents=[];window.nubi?.onHostEvent?.(event=>window.visibilityEvents.push(event));});
 const beforeNative=await electronApp.evaluate(({BrowserWindow,app})=>{const win=BrowserWindow.getAllWindows()[0];globalThis.nativeVisibilityEvents=[];for(const name of ['hide','show','minimize','restore'])win.on(name,()=>globalThis.nativeVisibilityEvents.push(name));return {visible:win.isVisible(),minimized:win.isMinimized(),backgroundThrottling:win.webContents.getBackgroundThrottling(),flags:process.argv.filter(arg=>arg.startsWith('--'))};});
 console.log('native: hide');await Promise.race([electronApp.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide()),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('native hide stalled')),3000);timer.unref();})]);
 await native.waitForTimeout(100);
 result.nativeDiagnostics={before:beforeNative,afterHide:await native.evaluate(()=>({hidden:document.hidden,visibility:document.visibilityState,nubi:typeof window.nubi,subscribe:typeof window.nubi?.onHostEvent,events:window.visibilityEvents,flags:document.documentElement.outerHTML.slice(0,400)})),window:await electronApp.evaluate(({BrowserWindow})=>({visible:BrowserWindow.getAllWindows()[0].isVisible(),minimized:BrowserWindow.getAllWindows()[0].isMinimized(),events:globalThis.nativeVisibilityEvents}))};console.log(JSON.stringify(result.nativeDiagnostics));
 await native.waitForFunction(()=>document.documentElement.hasAttribute('data-nubi-window-hidden'),null,{polling:50,timeout:3000});
 const hidden=await native.evaluate(async()=>{await Promise.all(window.nativeAmbient.map(a=>a.ready));return {hidden:document.hidden,nativeHidden:document.documentElement.hasAttribute('data-nubi-window-hidden'),animations:window.nativeAmbient.map(a=>({name:a.animationName,phase:a.currentTime,state:a.playState,same:document.getAnimations().includes(a)}))};});await native.waitForTimeout(100);
 const held=await native.evaluate(()=>window.nativeAmbient.map(a=>a.currentTime));
 check('native-hidden-pauses-same-phase',hidden.nativeHidden&&hidden.animations.length>0&&hidden.animations.every((a,i)=>a.same&&a.state==='paused'&&Math.abs(a.phase-held[i])<1),{hidden,held});
 await electronApp.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());await native.waitForFunction(()=>!document.documentElement.hasAttribute('data-nubi-window-hidden'),null,{polling:50});await native.waitForTimeout(100);
 const visible=await native.evaluate(()=>window.nativeAmbient.map(a=>({name:a.animationName,state:a.playState,phase:a.currentTime,same:document.getAnimations().includes(a)})));
 check('native-visible-resumes-same-animation',visible.every((a,i)=>a.same&&a.state==='running'&&a.phase>held[i]),visible);
 result.visibility={hidden,held,visible};

}catch(error){result.errors.push(error.stack);}
finally{
 server.closeAllConnections();
 if(electronApp){const nativeProcess=electronApp.process();let deadline;const closed=await Promise.race([electronApp.close().then(()=>true,error=>{result.errors.push('native teardown: '+error.message);return false;}),new Promise(resolve=>{deadline=setTimeout(()=>resolve(false),5000);deadline.unref();})]);clearTimeout(deadline);check('native-teardown-clean',closed&&nativeProcess.exitCode===0,{closed,exitCode:nativeProcess.exitCode});if(!closed){result.errors.push('native teardown timeout');killProcessTree(nativeProcess);}}
 if(storage)await rm(storage,{recursive:true,force:true});await browser?.close();await new Promise(resolve=>server.close(resolve));
}
check('page-errors-zero',result.errors.length===0,result.errors);
const spring=springSamples();check('spring-overshoot',Math.max(...spring.values)<=1.03,{max:Math.max(...spring.values),physics:spring.physics});
result.coveragePending=[];
await writeFile(path.join(dir,'result.json'),JSON.stringify(result,null,2));
const failed=result.checks.filter(item=>!item.pass);console.log(JSON.stringify({pass:result.checks.length-failed.length,failed:failed.map(item=>item.name),errors:result.errors,path:path.join(dir,'result.json')},null,2));
if(!failed.length)for(const item of unjudgedTimings)await recordUnjudged({id:'motion-quality:'+item.name,check:'motion-quality',functionalPassed:true,reason:'shared_runner',detail:item.detail});
console.log(JSON.stringify({check:'motion-quality',functionalPassed:!failed.length,verdict:failed.length?'failed':unjudgedTimings.length?'unjudged':'passed',unjudged:unjudgedTimings.length}));
process.exitCode=failed.length?1:0;
