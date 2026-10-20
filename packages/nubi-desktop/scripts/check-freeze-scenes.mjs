// P1 measurement: production surfaces, synthetic workloads, unchanged limits.
import {build,stop} from 'esbuild';
import {chromium,_electron as electron} from 'playwright';
import {createRequire,SourceMap} from 'node:module';
import {mkdir,readFile,writeFile,mkdtemp,rm,cp} from 'node:fs/promises';
import os from 'node:os';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {rendererBundleOptions} from './renderer-bundle.mjs';
import {isSharedRunner,timingVerdict,recordUnjudged,judgedTimingRow} from './admission-calibration.mjs';
import {FREEZE_SCENES,freezeMetrics,freezeViolations,conversationAdmissionViolations} from './freeze-metrics.mjs';
import {calibrationState,captureSystemLoad,freezeExitCode,createSceneLoadSampler,sceneEnvironmentState,classifyFreezeResults} from './freeze-environment.mjs';
const mode=process.argv.includes('--electron')?'electron':'browser',baseline=process.argv.includes('--baseline');
const sharedRunner=isSharedRunner();
const timingCodes=new Set(['long_tasks','freezes','startup_freeze','missed_frames','consecutive_missed_frames','frame_max','input_delay','admission_deadline']);
const phase=baseline?'baseline':'after',only=process.env.FREEZE_SCENE,widths=process.env.FREEZE_WIDTH?[Number(process.env.FREEZE_WIDTH)]:[1280,440];
const tag=process.env.FREEZE_TAG||'';assert.match(tag,/^[a-z0-9-]*$/);
const dir=path.resolve('verification/freeze-1.3.0/'+(tag?tag+'/':'')+phase+'/'+mode),bundle=path.join(dir,'fixture');await mkdir(bundle,{recursive:true});await writeFile(path.join(dir,'result.json'),JSON.stringify({mode,phase,results:[],errors:[],status:'collecting'}));
await cp('../../extensions/aipro-chat/public/icons',path.join(bundle,'icons'),{recursive:true});
const baselineSources=process.argv.includes('--reference-snapshot')?JSON.parse(await readFile('../../.superpowers/sdd/2026-10-19-nubi-desktop-1.3.0-release/'+(process.argv.includes('--q9-reference-snapshot')?'P1-q9-baseline-sources.json':'P1-baseline-sources.json'),'utf8')):null;
const originalSourcePlugin={name:'verified-baseline-snapshot',setup(builder){builder.onLoad({filter:/\.(mjs|jsx|js|css)$/},args=>{const rel=path.relative(process.cwd(),args.path).split(path.sep).join('/');if(baselineSources&&Object.hasOwn(baselineSources,rel))return {contents:baselineSources[rel],loader:rel.endsWith('.jsx')?'jsx':rel.endsWith('.css')?'css':'js',resolveDir:path.dirname(args.path)};});}};
await build({...rendererBundleOptions(),plugins:[...rendererBundleOptions().plugins.filter(plugin=>!baselineSources||plugin.name!=='cx-unused-reference-css'),originalSourcePlugin],entryPoints:['tests/freeze-scenes-fixture.jsx'],entryNames:'app',outdir:bundle,splitting:true,minify:true,sourcemap:'external'});
for(const name of ['workflow','wiki'])await build({entryPoints:[`ui/${name}-layout-worker.mjs`],outfile:path.join(bundle,`chunks/${name}-layout-worker.js`),bundle:true,format:'esm',minify:true,plugins:[originalSourcePlugin]});
stop();await writeFile(path.join(bundle,'index.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(bundle,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(bundle+path.sep))throw Error();res.setHeader('content-type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.webp':'image/webp','.svg':'image/svg+xml','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url='http://127.0.0.1:'+server.address().port,results=[],errors=[],calibration=[];let browser,app,page,storage,environment,sceneSampler;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function topFunctions(profile,productOnly=false){const nodes=new Map(profile.nodes.map(n=>[n.id,n])),totals=new Map();for(let i=0;i<(profile.samples||[]).length;i++){const f=nodes.get(profile.samples[i])?.callFrame;if(!f||f.functionName==='(idle)'||productOnly&&!f.url.startsWith(url))continue;const key=[f.functionName||'(anonymous)',f.url?f.url.replace(url,''):'[engine-or-driver]',f.lineNumber+1,f.columnNumber].join(':');totals.set(key,(totals.get(key)||0)+(profile.timeDeltas?.[i]||0));}const mapped=[];for(const [functionLocation,microseconds] of [...totals].sort((a,b)=>b[1]-a[1]).slice(0,5)){const location=functionLocation.split(':');let original=null;try{const lines=Number(location.at(-2))-1;const file=location.at(-3);const map=new SourceMap(JSON.parse(await readFile(path.join(bundle,file+'.map'),'utf8')));original=map.findEntry(lines,Number(location.at(-1)));}catch{}mapped.push({functionLocation,selfMs:microseconds/1000,original});}return mapped;}
async function clickVisible(locator){if(await locator.count()&&await locator.first().isVisible())await locator.first().click();}
async function exercise(id,durationMs){
 const start=Date.now();console.log('장면 시작',id);await page.evaluate(id=>window.freezeOpen(id),id);
 if(id==='chat'){
  await page.locator('.nubi-workbench').waitFor();await clickVisible(page.locator('.nubi-session-row').filter({hasText:'500개 대화'}));await page.locator('.nubi-history-more').waitFor({state:'attached'});await page.waitForFunction(()=>document.querySelector('.nubi-conversation-scroll')?.getAttribute('aria-busy')!=='true');assert.equal(await page.locator('.nubi-message').count(),40,'valid running history starts with recent40 before all500 are loaded');await page.evaluate(()=>window.freezeStream());await page.locator('textarea').last().fill('스트리밍 중에도 입력한 문장은 보존합니다.');
  for(let i=0;i<12;i++){
   // Scrolling the actual button into view can trigger its top sentinel first.
   // Accept that race only when a full page really advances, never a stationary
   // or obscured control. Keep all waiting/scrolling frames in the measurement.
   await page.waitForFunction(()=>document.querySelector('.nubi-conversation-scroll')?.getAttribute('aria-busy')!=='true');
   const before=await page.locator('.nubi-message').count();
   if(before<500){try{await page.locator('.nubi-history-more button').click({timeout:1000});}catch(error){await page.waitForFunction(()=>document.querySelector('.nubi-conversation-scroll')?.getAttribute('aria-busy')!=='true');if(error.name!=='TimeoutError'||await page.locator('.nubi-message').count()<Math.min(500,before+40))throw error;}}
   await page.locator('#freeze-probe').click();await pause(80);
  }
  await page.waitForFunction(()=>document.querySelector('.nubi-conversation-scroll')?.getAttribute('aria-busy')!=='true');
  assert.equal(await page.locator('.nubi-message').count(),500,'all500 history messages remain available after automatic or manual paging');
  await page.locator('textarea').last().fill('스트리밍 중에도 입력한 문장은 보존합니다.');
 }else if(id==='wiki'){
  await page.getByRole('heading',{name:'위키',exact:true}).waitFor();await clickVisible(page.getByRole('tab',{name:'관계 지도',exact:true}));await clickVisible(page.getByRole('tab',{name:'연결 탐색',exact:true}));
  const nodes=page.locator('.nubi-wiki-map svg [role=button]');await nodes.first().waitFor();assert.ok(await nodes.count()>0);await nodes.first().focus();await page.keyboard.press('Enter');await page.locator('.nubi-wiki-document:not([hidden]) h2').first().waitFor();
 }else if(id==='mail'){
  await page.locator('.nubi-mail-table tbody tr').first().waitFor();await page.locator('summary[aria-label="메일 페이지 설정"]').click();await page.locator('select[aria-label="페이지당 메일 수"]').selectOption('100');await page.locator('summary[aria-label="메일 페이지 설정"]').click();
  await page.waitForFunction(()=>document.querySelector('.nubi-mail-results')?.dataset.admission==='complete'&&document.querySelectorAll('.nubi-mail-table [data-mail-id]').length===100);
  assert.equal(await page.locator('.nubi-mail-table [data-mail-id]').count(),100,'the requested full100 rows remain after admission');
  await page.locator('button[aria-label="제목 정렬"]').click();await page.locator('.nubi-mail-search-input-row input').first().fill('합성 검토 요청 9');
 }else if(id==='workflow')await page.locator('[data-step-id]').first().waitFor();
 else if(id==='terminal')await page.getByText('5000 / 5000줄',{exact:true}).waitFor();
 else{
  await page.locator('.nubi-workbench').waitFor();for(let i=0;i<10;i++){const name=['위키','메일','워크플로우','홈'][i%4];await page.locator('.nubi-workspace-rail button[aria-label="'+name+'"]').click();await page.locator(({위키:'.nubi-wiki-browser',메일:'.nubi-mail-history',워크플로우:'.nubi-workflows',홈:'.welcome'})[name]).first().waitFor();await page.evaluate(()=>window.freezeCalls.navigations=(window.freezeCalls.navigations||0)+1);await pause(220);}await page.evaluate(()=>window.freezeSwitchProject());
 }
 await page.locator('#freeze-probe').click();let probes=1;
 while(Date.now()-start<durationMs||await page.evaluate(()=>window.freezeMeasurement.frames.length)<600){await page.locator('#freeze-probe').click({noWaitAfter:true});probes++;
  await page.evaluate(()=>{for(const n of document.querySelectorAll('.nubi-conversation-scroll,.nubi-mail-results,.nubi-workflow-timeline,.freeze-content'))if(n.scrollHeight>n.clientHeight)n.scrollTop=n.scrollTop>n.scrollHeight/2?0:n.scrollHeight;});await pause(180);}
 assert.ok(probes>0);if(id==='chat')assert.equal(await page.locator('.nubi-message').count(),500,'load all retained messages');if(id==='workflow')assert.ok(await page.evaluate(()=>window.freezeCalls.polls)>=25,'60s must exercise actual two-second polling');
 return await page.evaluate(()=>({calls:window.freezeCalls,loadedMessages:document.querySelectorAll('.nubi-message').length,renderedSteps:document.querySelectorAll('[data-step-id]').length,terminalLines:document.querySelector('.nubi-terminal-receipt')?.textContent}));
}
try{
 if(mode==='browser')browser=await chromium.launch({channel:'chrome',headless:true});
 else{storage=await mkdtemp(path.join(os.tmpdir(),'nubi-freeze-'));const require=createRequire(import.meta.url);app=await electron.launch({executablePath:require('electron'),args:['tests/freeze-electron.cjs',url],env:{...process.env,NUBI_FREEZE_STORAGE:storage,ELECTRON_RUN_AS_NODE:undefined},cwd:process.cwd()});}
 for(const width of widths)for(const scene of FREEZE_SCENES.filter(s=>!only||s.id===only)){
  page=mode==='browser'?await browser.newPage({viewport:{width,height:900}}):await app.firstWindow();if(mode==='electron')await app.evaluate(({BrowserWindow},w)=>BrowserWindow.getAllWindows()[0].setContentSize(w,900),width);
  const pageErrors=[];const onError=e=>{pageErrors.push(e.message);console.error('pageerror',e.message);};page.on('pageerror',onError);page.setDefaultTimeout(15000);await page.addInitScript(()=>Object.defineProperty(navigator,'webdriver',{get:()=>false,configurable:true}));
  await page.goto(url);await page.waitForFunction(()=>window.freezeReady===true);await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  let inputPreparation;
  if(mode==='electron')inputPreparation=await app.evaluate(()=>globalThis.__nubiFreezePrepareInput());
  else{const started=performance.now();try{await page.mouse.move(-1,-1);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));inputPreparation={status:'ready',sent:true,durationMs:performance.now()-started,environment:'warm browser: one empty-shell mouseMove'};}catch{inputPreparation={status:'failed',sent:false,error:'native_input_failed',durationMs:performance.now()-started};}}
  // Environment/host preparation precedes the scene. Its raw duration is retained;
  // every pointer sample after scene entry, including the first scroll, is counted.
  const idle=await page.evaluate(()=>new Promise(resolve=>{const frames=[];let previous;const end=performance.now()+3000;const sample=t=>{if(previous!==undefined)frames.push(t-previous);previous=t;if(performance.now()<end)requestAnimationFrame(sample);else resolve(frames);};requestAnimationFrame(sample);}));const idleState=calibrationState(idle),d=idleState.metrics.displayIntervalMs;
  const calibrationRow={scene:scene.id,width,inputPreparation,displayIntervalMs:d,frameP95Ms:idleState.metrics.frameP95Ms,missedFrames:idleState.metrics.missedFrames,missedFrameRatio:idleState.metrics.missedFrameRatio,frames:idle};calibration.push(calibrationRow);
  if(mode==='browser'&&idleState.status==='environment_unstable'&&!sharedRunner){
   if(inputPreparation.status!=='ready')errors.push('native_input_preparation');
   environment={status:'environment_unstable',reason:'missed_frames',scene:scene.id,width,calibration:calibrationRow,systemLoad:await captureSystemLoad()};
   throw Object.assign(Error('environment_unstable'),{code:'environment_unstable'});
  }
  sceneSampler=createSceneLoadSampler({context:{scene:scene.id,width,mode}});await sceneSampler.start();
  const client=await page.context().newCDPSession(page);await client.send('Profiler.enable');await client.send('Profiler.setSamplingInterval',{interval:1000});
  await page.evaluate(scene=>{const m=window.freezeMeasurement={tasks:[],frames:[],inputs:[],peakNodes:0};if(scene==='workflow'){m.nodeObserver=new MutationObserver(()=>{m.peakNodes=Math.max(m.peakNodes,document.querySelectorAll('[data-step-kind]').length);});m.nodeObserver.observe(document.body,{childList:true,subtree:true});}m.admission=[];if(scene==='chat'){m.admissionObserver=new MutationObserver(()=>{const count=document.querySelectorAll('.nubi-message').length;if(count&&count!==m.admission.at(-1)?.count)m.admission.push({count,at:performance.now()});if(count>=40)m.admissionObserver.disconnect();});m.admissionObserver.observe(document.body,{childList:true,subtree:true});}let previous=performance.now();m.active=true;m.observer=new PerformanceObserver(list=>m.tasks.push(...list.getEntries().map(t=>({startTime:t.startTime,duration:t.duration}))));m.observer.observe({type:'longtask'});
   // The first rAF timestamp can precede performance.now() at registration.
   // Keep its actual startup delay separately; intervals require two rAF ticks.
   previous=undefined;const registeredAt=performance.now();
   const frame=now=>{if(!m.active)return;if(previous===undefined)m.startupDelayMs=performance.now()-registeredAt;else m.frames.push(now-previous);previous=now;requestAnimationFrame(frame);};requestAnimationFrame(frame);
   m.inputTimings=[];m.onPointer=e=>{if(e.target.closest('#freeze-probe')){const start=e.timeStamp,index=m.inputTimings.length,timing={start,dispatch:performance.now()};m.inputTimings.push(timing);if(window.freezeTrace)performance.mark('probe-'+index);requestAnimationFrame(()=>{timing.first=performance.now();requestAnimationFrame(()=>{timing.second=performance.now();m.inputs.push(timing.second-start);});});}};document.addEventListener('pointerdown',m.onPointer);},scene.id);
  let trace=[],traceDone;if(process.env.FREEZE_TRACE){client.on('Tracing.dataCollected',e=>trace.push(...e.value));traceDone=new Promise(resolve=>client.once('Tracing.tracingComplete',resolve));await page.evaluate(()=>{window.freezeTrace=true;});await client.send('Tracing.start',{categories:process.env.FREEZE_TRACE==='light'?'toplevel,devtools.timeline,blink.user_timing':'disabled-by-default-devtools.timeline.invalidationTracking,blink,cc,renderer.scheduler,toplevel,blink.user_timing,devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack,v8',transferMode:'ReportEvents'});}await client.send('Profiler.start');const start=Date.now();const workload=await exercise(scene.id,scene.durationMs);await pause(80);
  const environmentSamples=await sceneSampler.stop();sceneSampler=null;const sceneEnvironment=sceneEnvironmentState(environmentSamples);
  const raw=await page.evaluate(()=>{const m=window.freezeMeasurement;m.active=false;m.observer.takeRecords().forEach(t=>m.tasks.push({startTime:t.startTime,duration:t.duration}));m.observer.disconnect();m.nodeObserver?.disconnect();m.admissionObserver?.disconnect();document.removeEventListener('pointerdown',m.onPointer);return {admission:m.admission,inputTimings:m.inputTimings,startupDelayMs:m.startupDelayMs,peakNodes:m.peakNodes,tasks:m.tasks,frames:m.frames,inputs:m.inputs,heapBytes:performance.memory?.usedJSHeapSize||null};});
  // Preserve every sample even when an admission contract assertion aborts
  // before the summarized scene row can be written.
  await writeFile(path.join(dir,scene.id+'-'+width+'-raw.json'),JSON.stringify({...raw,environmentSamples,environmentReasons:sceneEnvironment.reasons}));
  const admissionFailures=scene.id==='chat'&&!baseline?conversationAdmissionViolations(raw.admission):[];
  assert.ok(Number.isFinite(raw.startupDelayMs)&&raw.startupDelayMs>=0,'initial rAF scheduling delay is observed with a monotonic clock');
  assert.deepEqual(await page.locator('img[src^="./icons/"]').evaluateAll(images=>images.filter(n=>!n.complete||!n.naturalWidth).map(n=>n.getAttribute('src'))),[],'production artwork must load before a scene can qualify');
  const {profile}=await client.send('Profiler.stop');if(traceDone){await client.send('Tracing.end');await traceDone;await writeFile(path.join(dir,scene.id+'-'+width+'-trace.json'),JSON.stringify({traceEvents:trace}));}if(scene.id==='terminal'){const output=page.locator('.nubi-terminal-output');const exact=await output.evaluate(n=>{const selection=getSelection();selection.removeAllRanges();const range=document.createRange();range.selectNodeContents(n);selection.addRange(range);const same=selection.toString()===n.textContent;selection.removeAllRanges();return same;});assert.ok(exact,'native selection retains complete output text');assert.equal(await output.evaluate(n=>n.textContent.split('\n').length),5000,'all 5000 lines remain available');}const metrics=freezeMetrics({...raw,displayIntervalMs:d}),violations=[...freezeViolations(metrics,{judgeFrames:mode==='browser'}),...admissionFailures];if(inputPreparation.status!=='ready')violations.push('native_input_preparation');if(scene.id==='workflow'&&raw.peakNodes>=50)violations.push('initial_virtualization');
  await writeFile(path.join(dir,scene.id+'-'+width+'.cpuprofile'),JSON.stringify(profile));await page.screenshot({path:path.join(dir,scene.id+'-'+width+'.png')});if(scene.id==='wiki'){await page.getByRole('button',{name:'탐색으로 돌아가기',exact:true}).click();await page.screenshot({path:path.join(dir,'wiki-map-'+width+'.png')});}
  errors.push(...pageErrors);const unstable=sceneEnvironment.status==='environment_unstable'||mode==='browser'&&idleState.status==='environment_unstable';const row={timingVerdict:timingVerdict(unstable,{sharedRunner}),calibration:calibrationRow,environmentSamples,environmentReasons:sceneEnvironment.reasons,environmentStatus:sceneEnvironment.status,admission:raw.admission,inputTimings:raw.inputTimings,inputPreparation,scene:scene.id,width,durationMs:Date.now()-start,peakNodes:raw.peakNodes,metrics,violations,topFunctions:await topFunctions(profile),productFunctions:await topFunctions(profile,true),workload,pageErrors};results.push(row);await writeFile(path.join(dir,'result.json'),JSON.stringify({mode,phase,results,errors,calibration,boundary:'Product React surfaces and synthetic business APIs. Isolated Electron uses product native-input preparation. No connected services, business host IPC, Office or Windows. Pointer to next-paint upper estimate uses two rAF. All frame samples retained.'},null,2));
  console.log(JSON.stringify({scene:scene.id,width,...Object.fromEntries(Object.entries(metrics).filter(([k])=>!['tasks','frames','inputs'].includes(k))),violations,topFunctions:row.topFunctions,workload}));page.off('pageerror',onError);await client.detach();if(mode==='browser')await page.close();
 }
 assert.deepEqual(errors,[],'scene errors invalidate measurements');
 // Raw violations and every sample remain in results. Only known timing limits
 // on an unstable shared runner are excluded from the functional decision.
 const judgedResults=results.map(row=>judgedTimingRow(row,timingCodes));
 const outcome=classifyFreezeResults({results:judgedResults,errors,baseline});if(outcome===2){environment={status:'environment_unstable',reason:'scene_load',scenes:results.filter(r=>r.environmentReasons?.length).map(r=>({scene:r.scene,width:r.width,reasons:r.environmentReasons}))};throw Object.assign(Error('scene_environment_unstable'),{code:'environment_unstable'});}if(outcome===1)throw Error('P1 limits');
 for(const row of results.filter(row=>row.timingVerdict==='unjudged'))await recordUnjudged({id:'freeze:'+phase+':'+mode+':'+row.scene+':'+row.width,check:'freeze',mode,phase,scene:row.scene,width:row.width,functionalPassed:true,reason:row.environmentReasons.length?'scene_load':'empty_shell_frames',calibration:row.calibration,environmentReasons:row.environmentReasons,metrics:row.metrics,violations:row.violations,resultPath:path.join(dir,'result.json')});
 const unjudged=results.filter(row=>row.timingVerdict==='unjudged').length;
 console.log(JSON.stringify({check:'freeze',mode,functionalPassed:true,verdict:unjudged?'unjudged':'passed',unjudged}));
 await writeFile(path.join(dir,'result.json'),JSON.stringify({mode,phase,status:unjudged?'unjudged':baseline?'baseline_collected':'passed',verdict:unjudged?'unjudged':'passed',functionalPassed:true,unjudged,exitCode:0,results,errors,calibration,boundary:'Product React surfaces and synthetic business APIs. Isolated Electron uses product native-input preparation. No connected services, business host IPC, Office or Windows. All frame samples retained.'},null,2));
}catch(error){
 if(sceneSampler){const samples=await sceneSampler.stop();await writeFile(path.join(dir,'interrupted-environment.json'),JSON.stringify(samples,null,2));sceneSampler=null;}
 const exitCode=freezeExitCode(error,{results,errors,baseline});
 await writeFile(path.join(dir,'result.json'),JSON.stringify({mode,phase,status:exitCode===2?'environment_unstable':'failed',exitCode,results,errors,calibration,environment,error:{code:error.code||'measurement_failed',message:error.message}},null,2));
 if(exitCode===2){console.error(JSON.stringify(environment));process.exitCode=2;}
 else{await page?.screenshot({path:path.join(dir,'failure.png')}).catch(()=>{});throw error;}
}
finally{server.closeAllConnections();await Promise.allSettled([browser?.close(),app?.close()]);await new Promise(r=>server.close(r));if(storage)await rm(storage,{recursive:true,force:true});}
