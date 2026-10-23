import {build,stop} from 'esbuild';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {rendererBundleOptions} from './renderer-bundle.mjs';

const phase=process.argv[2]||'after';assert(['before','after'].includes(phase));
const directory=path.resolve('verification/motion-atlas-2026-10-23',phase);await mkdir(directory,{recursive:true});
await build({...rendererBundleOptions(),entryPoints:['tests/motion-atlas-fixture.jsx'],entryNames:'app',outdir:directory,splitting:false,minify:true});stop();
await writeFile(directory+'/index.html','<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(request,response)=>{try{const file=path.resolve(directory,'.'+new URL(request.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(directory+path.sep))throw Error();response.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');response.end(await readFile(file));}catch{response.writeHead(404).end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`,results=[],checks=[],errors=[];let browser;
const check=(name,passed)=>checks.push({name,passed:!!passed});
try{
 for(const software of [false,true]){
  browser=await chromium.launch({channel:'chrome',headless:true,...(software?{args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']}:{})});
  const context=await browser.newContext({viewport:{width:1200,height:860},deviceScaleFactor:1.5});await context.addInitScript(()=>Object.defineProperty(navigator,'webdriver',{get:()=>false}));
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.getByRole('button',{name:'변경 반영',exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(150);
  const optics=await page.evaluate(()=>window.atlasOptics());await writeFile(directory+`/pixels-${software?'software':'default'}.json`,JSON.stringify(optics.pixels));delete optics.pixels;
  check(`clipped-shader:${software}`,optics.supported&&optics.draws.every(rect=>rect[2]*rect[3]<optics.canvas[0]*optics.canvas[1]*.5)&&optics.error===0);
  const client=await context.newCDPSession(page);await client.send('Emulation.setCPUThrottlingRate',{rate:4});
  const travel=await page.evaluate(async()=>{const layer=document.querySelector('#atlas-rail .nubi-liquid-glass'),selection=layer.querySelector('.nubi-liquid-glass__selection'),frames=[],positions=[];let previous;window.atlasSelect(12);for(let i=0;i<50;i++){const now=await new Promise(requestAnimationFrame);if(previous)frames.push(now-previous);previous=now;positions.push(new DOMMatrixReadOnly(selection.style.transform||'none').m42);}return {mode:layer.parentElement.dataset.liquidGlass,frames,positions,metrics:{...layer.glassMetrics}};});
  travel.frameP95=[...travel.frames].sort((a,b)=>a-b)[Math.floor(travel.frames.length*.95)];travel.frameMax=Math.max(...travel.frames);delete travel.frames;
  const press=page.getByRole('button',{name:'변경 반영',exact:true});await press.hover();await page.mouse.down();await page.waitForTimeout(135);const squish=await press.evaluate(element=>{const matrix=new DOMMatrixReadOnly(getComputedStyle(element).transform);return {x:matrix.a,y:matrix.d};});await page.mouse.up();
  check(`directional-button-squish:${software}`,squish.x>1&&squish.y<1);
  await page.getByLabel('검사 메뉴',{exact:true}).first().click();const menu=page.getByRole('group',{name:'검사 메뉴',exact:true});await menu.waitFor();const opening=await menu.evaluate(element=>element.getAnimations().map(animation=>({name:animation.animationName,frames:animation.effect.getKeyframes()})));check(`anchored-menu:${software}`,opening.some(row=>row.name==='nubi-view-menu-in'));
  await page.keyboard.press('Escape');await page.getByRole('textbox',{name:'입력 반응'}).fill('입력은 모션 완료를 기다리지 않습니다.');
  const snapshot=await page.evaluate(()=>window.atlasSnapshotBenchmark());check(`unchanged-snapshot-no-rebuild:${software}`,snapshot.unchangedPropertyWrites===0);
  await page.screenshot({path:directory+`/surface-${software?'software':'default'}.png`});results.push({software,optics,travel,squish,opening,snapshot});
  await context.close();
  const fallback=await browser.newContext({viewport:{width:1200,height:860}});await fallback.addInitScript(()=>{Object.defineProperty(navigator,'webdriver',{get:()=>false});const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return /webgl/.test(type)?null:original.call(this,type,...args);};});
  const probe=await fallback.newPage();probe.on('pageerror',error=>errors.push(error.message));await probe.goto(url);await probe.getByRole('button',{name:'변경 반영',exact:true}).waitFor();await probe.waitForTimeout(120);
  const movement=await probe.evaluate(async()=>{const host=document.querySelector('#atlas-rail'),layer=host.querySelector('.nubi-liquid-glass'),selection=layer.querySelector('.nubi-liquid-glass__selection'),positions=[];window.atlasSelect(12);for(let i=0;i<45;i++){await new Promise(requestAnimationFrame);positions.push(new DOMMatrixReadOnly(selection.style.transform||'none').m42);}return {mode:host.dataset.liquidGlass,visible:getComputedStyle(layer).display!=='none',positions,metrics:{...layer.glassMetrics}};});
  check(`no-webgl-keeps-sliding-selection:${software}`,movement.visible&&movement.positions.at(-1)>400&&movement.positions.some(value=>value>10&&value<450));results.at(-1).fallback=movement;
  await probe.emulateMedia({reducedMotion:'reduce'});await probe.getByRole('tab',{name:'2',exact:true}).click();await probe.waitForTimeout(80);check(`reduced-no-spring:${software}`,await probe.locator('#atlas-rail .nubi-liquid-glass').getAttribute('data-glass-moving')==='false');
  await fallback.close();await browser.close();browser=null;
 }
 assert.deepEqual(errors,[]);
 await writeFile(directory+'/result.json',JSON.stringify({phase,checks,results,errors,scope:'Actual production motion hooks and renderer in Chrome. Paired normal/forced SwiftShader, 4x CPU slowdown, DPR 1.5 and WebGL-unavailable contexts on macOS; this is not a physical Windows measurement.'},null,2)+'\n');
 console.log(JSON.stringify({phase,checks,results:results.map(row=>({software:row.software,backend:row.optics.backend,travel:row.travel.frameP95,snapshot:row.snapshot,fallbackMode:row.fallback.mode})),errors}));
 if(phase==='after')assert(checks.every(row=>row.passed),JSON.stringify(checks.filter(row=>!row.passed)));
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
