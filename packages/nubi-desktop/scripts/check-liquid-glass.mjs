import {_electron as electron} from 'playwright';
import {build,stop} from 'esbuild';
import {rendererBundleOptions} from './renderer-bundle.mjs';
import {desktopTestWindow} from './electron-test-window.mjs';
import {captureDesign,assertAccessibilityRules} from './design-rules.mjs';
import {assertDialogChrome} from './identity-browser.mjs';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const tag=process.env.GLASS_TAG||'native';if(!/^[a-z0-9-]+$/.test(tag))throw Error('invalid glass tag');
const out=path.resolve('verification/liquid-glass-webgl',tag),fixture=path.join(out,'fixture');await mkdir(fixture,{recursive:true});
await build({...rendererBundleOptions(),entryPoints:['tests/liquid-glass-fixture.jsx'],outdir:fixture,entryNames:'probe',splitting:false});stop();
await writeFile(path.join(fixture,'index.html'),'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="probe.css"><div id="root"></div><script type="module" src="probe.js"></script>');
const storage=await mkdtemp(path.join(os.tmpdir(),'nubi-liquid-glass-')),project=path.join(storage,'Nubi Glass');await mkdir(project);
for(const file of ['brand-guidelines.md','design-reference.md'])await writeFile(path.join(project,file),'# Nubi Workspace\n\nSynthetic design review.\n');
execFileSync('git',['init',project],{stdio:'ignore'});await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root:project}));
const require=createRequire(import.meta.url),app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}});
const checks=[],facts={},errors=[];let page;
const record=name=>{checks.push(name);console.log('checked',name);};
function readLens(selector){
 const host=document.querySelector(selector),canvas=host?.querySelector('.nubi-liquid-glass__lens');if(!canvas)return null;
 const gl=canvas.getContext('webgl'),program=gl?.getParameter(gl.CURRENT_PROGRAM);if(!program)return null;
 const rect=Array.from(gl.getUniform(program,gl.getUniformLocation(program,'u_rects[0]'))).slice(0,4);
 return {rect,moving:host.querySelector('.nubi-liquid-glass').dataset.glassMoving==='true',renderer:host.dataset.liquidGlass,metrics:{...host.querySelector('.nubi-liquid-glass').glassMetrics},buffer:[canvas.width,canvas.height]};
}
try {
 page=await desktopTestWindow(app);page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.locator('.desktop-shell[data-startup-ready=true]').waitFor({timeout:60000});await page.waitForFunction(()=>!document.querySelector('.nubi-intro')&&!document.querySelector('.desktop-shell')?.inert);
 const startup=page.getByText('메일을 연결해 주세요');if(await startup.count()){await page.keyboard.press('Escape');await startup.waitFor({state:'hidden'});}
 await page.waitForFunction(()=>document.querySelector('button[aria-label="파일"]')?.disabled===false,null,{timeout:60000});
 const window=await app.browserWindow(page);await window.evaluate(win=>{win.setMinimumSize(400,400);win.setContentSize(1440,960);});
 const rail='.nubi-workspace-rail';await page.waitForFunction(()=>document.querySelector('.nubi-workspace-rail')?.dataset.liquidGlass==='webgl');
 await page.waitForFunction(()=>document.querySelector('.nubi-workspace-rail .nubi-liquid-glass')?.dataset.glassMoving==='false');
 const capture=async name=>{await captureDesign(page,{path:path.join(out,name+'.png'),animations:'disabled',scale:'css'});};
 facts.rail=await page.evaluate(readLens,rail);assert(facts.rail.metrics.pixels<=181000);record('production-navigation-webgl');await capture('home-wide');
 facts.travel=await page.evaluate(async()=>{
  const nav=document.querySelector('.nubi-workspace-rail'),canvas=nav.querySelector('.nubi-liquid-glass__lens'),gl=canvas.getContext('webgl');
  const read=()=>{const p=gl.getParameter(gl.CURRENT_PROGRAM);return Array.from(gl.getUniform(p,gl.getUniformLocation(p,'u_rects[0]'))).slice(0,4);};
  const before=read(),samples=[];nav.querySelector('button[aria-label="메일"]').click();
  for(let i=0;i<55;i++){await new Promise(requestAnimationFrame);samples.push(read());}
  return {before,samples,after:read()};
 });
 assert(facts.travel.after[1]>facts.travel.before[1]+20);assert(facts.travel.samples.some(r=>r[1]>facts.travel.before[1]+1&&r[1]<facts.travel.after[1]-1));assert(facts.travel.samples.some(r=>r[3]>facts.travel.before[3]+1));record('reference-spring-travel-and-directional-stretch');
 const advancing=facts.travel.samples.slice(2,20).filter((rect,index)=>Math.abs(rect[1]-facts.travel.samples[index+1][1])>.001).length;
 facts.travel.cadence={advancing,observed:18};assert(advancing>=15,'visible glass must advance on each display frame while travelling: '+JSON.stringify(facts.travel.cadence));record('display-frame-cadence-without-30fps-throttle');
 await capture('mail-wide');
 const selectedButton=page.locator(rail+' button[aria-label="메일"]');await selectedButton.hover();await page.waitForTimeout(200);
 const hovered=await page.evaluate(readLens,rail);await page.mouse.down();await page.waitForTimeout(120);const pressed=await page.evaluate(readLens,rail);await page.mouse.up();
 assert(pressed.rect[3]<hovered.rect[3]-.5);record('selected-glass-hover-and-press-elasticity');
 await page.getByRole('button',{name:'홈',exact:true}).click();
 for(const file of ['brand-guidelines.md','design-reference.md']){
  await page.getByRole('button',{name:'파일',exact:true}).click();
  const tree=page.getByRole('tree',{name:'폴더의 파일 목록'});await tree.waitFor();await tree.getByRole('treeitem',{name:file,exact:true}).dblclick();
  await page.getByRole('tab',{name:file,exact:true}).waitFor();
 }
 await page.waitForFunction(()=>document.querySelector('.desktop-file-tabs')?.dataset.liquidGlass==='webgl');
 await page.getByRole('tab',{name:'brand-guidelines.md',exact:true}).click();await page.getByRole('tab',{name:'design-reference.md',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.desktop-file-tabs .nubi-liquid-glass')?.dataset.glassMoving==='false');
 facts.tabs=await page.evaluate(readLens,'.desktop-file-tabs');assert(facts.tabs.metrics.pixels<=181000);record('production-document-tabs-switch-and-scroll');await capture('tabs-wide');
 await page.mouse.move(700,500);await page.waitForFunction(()=>document.querySelector('.nubi-workspace-rail .nubi-liquid-glass')?.dataset.glassMoving==='false');await page.waitForTimeout(80);
 const frames=await page.locator(rail+' .nubi-liquid-glass').evaluate(e=>e.glassMetrics.frames);await page.waitForTimeout(200);
 assert.equal(await page.locator(rail+' .nubi-liquid-glass').evaluate(e=>e.glassMetrics.frames),frames);record('idle-render-loop-stops');
 await window.evaluate(win=>win.setContentSize(1024,800));await page.waitForTimeout(180);facts.resize=await page.evaluate(readLens,'.desktop-file-tabs');assert(facts.resize.metrics.pixels<=181000);record('resize-bounded-back-buffer');await capture('tabs-resized');
 await page.getByRole('button',{name:'설정',exact:true}).click();const dialog=page.getByRole('dialog',{name:'설정',exact:true});await dialog.waitFor();await assertDialogChrome(dialog);await assertAccessibilityRules(page);await capture('settings-wide');await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'설정',exact:true}).click();await dialog.waitFor();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});record('branded-dialog-focus-and-reentry');
 await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'메일',exact:true}).click();await page.waitForTimeout(120);assert.equal((await page.evaluate(readLens,rail)).moving,false);record('reduced-motion-without-spring');
 const client=await page.context().newCDPSession(page);await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'},{name:'prefers-reduced-transparency',value:'reduce'}]});
 await page.waitForFunction(()=>document.querySelector('.nubi-workspace-rail')?.dataset.liquidGlass==='fallback');await capture('reduced-transparency');record('reduced-transparency-fallback');
 await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'},{name:'forced-colors',value:'active'}]});await capture('forced-colors');record('forced-colors-fallback');
 await client.send('Emulation.setEmulatedMedia',{features:[]});await page.waitForFunction(()=>document.querySelector('.nubi-workspace-rail')?.dataset.liquidGlass==='webgl');
 const contextExtension=await page.locator(rail+' canvas.nubi-liquid-glass__lens').evaluateHandle(canvas=>canvas.getContext('webgl').getExtension('WEBGL_lose_context'));
 assert(await contextExtension.evaluate(e=>!!e));await contextExtension.evaluate(e=>e.loseContext());await page.waitForFunction(()=>document.querySelector('.nubi-workspace-rail')?.dataset.liquidGlass==='fallback');
 assert.notEqual(await page.locator(rail+' button[aria-label="메일"]').evaluate(e=>getComputedStyle(e).backgroundImage),'none');await capture('context-lost');
 await contextExtension.evaluate(e=>e.restoreContext());await page.waitForFunction(()=>document.querySelector('.nubi-workspace-rail')?.dataset.liquidGlass==='webgl');record('webgl-context-loss-fallback-and-restore');await contextExtension.dispose();
 await window.evaluate(win=>win.setContentSize(440,900));await page.waitForTimeout(120);await capture('mail-narrow');
 await page.getByRole('button',{name:'설정',exact:true}).click();await dialog.waitFor();await assertDialogChrome(dialog);await assertAccessibilityRules(page);await capture('settings-narrow');await page.keyboard.press('Escape');record('narrow-branded-dialog-and-navigation');
 await app.evaluate(async({BrowserWindow},file)=>{const probe=new BrowserWindow({width:600,height:240,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await probe.loadFile(file);},path.join(fixture,'index.html'));
 const probe=app.windows().at(-1);probe.on('pageerror',e=>errors.push(e.message));await probe.waitForFunction(()=>!!window.probeRefraction);
 facts.optics=await probe.evaluate(()=>window.probeRefraction());assert(facts.optics.supported&&facts.optics.different>500&&facts.optics.visible>3000&&facts.optics.error===0);record('actual-electron-shader-refraction-pixel-difference');
 await probe.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/.test(type)?null:original.call(this,type,...args);};});await probe.reload();
 await probe.waitForFunction(()=>document.querySelector('#glass-fixture')?.dataset.liquidGlass==='fallback');await probe.getByRole('tab',{name:'Three',exact:true}).click();await probe.getByRole('tab',{name:'Three',exact:true}).getAttribute('aria-selected').then(value=>assert.equal(value,'true'));record('webgl-unavailable-preserves-real-selection');
 await app.evaluate(async({BrowserWindow},file)=>{const reference=new BrowserWindow({width:1200,height:850,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await reference.loadFile(file);},path.resolve('../../design-reference/nubi-liquid-glass-demo.html'));
 const reference=app.windows().at(-1);await reference.locator('#dock').waitFor();await reference.getByRole('button',{name:'Agents',exact:true}).click();await reference.waitForTimeout(800);await reference.screenshot({path:path.join(out,'reference-demo.png'),scale:'css'});record('supplied-demo-rendered-for-visual-comparison');
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'result.json'),JSON.stringify({checks,facts,errors,boundary:'Actual built Electron UI on macOS with a temporary local project; synthetic optical stripes exercise the shader in an Electron fixture. The live neutral material samples a hidden neutral texture and adds no coloured scene: arbitrary DOM refraction is not implemented. OS preference delivery, Windows and real provider/SSO are separate.'},null,2));console.log(JSON.stringify({passed:checks.length,errors}));
}catch(error){await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await writeFile(path.join(out,'failure.txt'),error.stack);throw error;}
finally{await app.close();await rm(storage,{recursive:true,force:true});}
