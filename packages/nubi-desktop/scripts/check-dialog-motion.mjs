import {build} from 'esbuild';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir=path.resolve('verification/motion-tabs-2026-10-15');await mkdir(dir,{recursive:true});
await build({stdin:{contents:"import './tests/shared-ui-fixture.jsx'; import './electron-app/modal-motion.css'; import {installModalMotion} from './ui/modalMotion.js'; window.stopMotion=installModalMotion();",resolveDir:process.cwd()},outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file','.webp':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><title>누비 모션 검증</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const target=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!target.startsWith(dir+path.sep))throw Error();res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[path.extname(target)]||'application/octet-stream');res.end(await readFile(target));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),checks=[],errors=[];
try{
 for(const reduced of [false,true]){
  const context=await browser.newContext({viewport:{width:1280,height:950},reducedMotion:reduced?'reduce':'no-preference',...(!reduced?{recordVideo:{dir:path.join(dir,'video'),size:{width:1280,height:950}}}:{})});
  // Production normally disables animations for webdriver. Deliberately opt in
  // here so this test exercises real animation lifecycle and interruption.
  await context.addInitScript(()=>Object.defineProperty(navigator,'webdriver',{get:()=>false}));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?context&modals&integrated`);
  const settings=page.getByRole('button',{name:'설정',exact:true});await settings.click();
  const dialog=page.getByRole('dialog',{name:'설정',exact:true});await dialog.waitFor();
  await page.waitForTimeout(450);
  // Exercise intrinsic growth/shrink on the real CX panel, including a resize
  // that interrupts the previous animation. No scale is applied to its text.
  const initial=await dialog.boundingBox();
  for(const growth of [80,24,0]){
   await dialog.evaluate((el,growth)=>{el.querySelector('.cx-panel-body').style.paddingBottom=`${growth+12}px`;},growth);
   if(!reduced){
    await page.waitForFunction(()=>!!document.querySelector('.nubi-modal-morph-surface'));
    assert.equal(await dialog.evaluate(el=>getComputedStyle(el).transform),'none');
    assert.equal(await page.locator('.nubi-modal-morph-surface').count(),1);
   }else{await page.waitForTimeout(30);assert.equal(await page.locator('.nubi-modal-morph-surface').count(),0);}
  }
  await page.waitForFunction(()=>!document.querySelector('.nubi-modal-morph-surface'));
  assert(Math.abs((await dialog.boundingBox()).height-initial.height)<24);
  assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true);
  checks.push(`${reduced?'reduced':'normal'}: grow, interrupt, shrink, stable text and focus`);
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('.cx-panel-backdrop'));
  assert.equal(await settings.evaluate(el=>el===document.activeElement),true);
  for(let i=0;i<3;i++){await settings.click();await dialog.waitFor();await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.cx-panel-backdrop'));}
  checks.push(`${reduced?'reduced':'normal'}: Escape, repeated open/close, focus returns, no orphan surfaces`);
  if(!reduced){
   await settings.click();await dialog.waitFor();await page.waitForTimeout(400);
   await dialog.evaluate(el=>el.querySelector('.cx-panel-body').style.paddingBottom='160px');
   await page.waitForFunction(()=>!!document.querySelector('.nubi-modal-morph-surface'));
   await page.emulateMedia({reducedMotion:'reduce'});
   await page.waitForFunction(()=>!document.querySelector('.nubi-modal-morph-surface'));
   assert.equal(await dialog.evaluate(el=>el.classList.contains('nubi-modal-morphing')),false);
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.cx-panel-backdrop'));
   checks.push('changing system reduced motion interrupts the morph without hiding content');
   await page.emulateMedia({reducedMotion:'no-preference'});
   await page.getByRole('button',{name:'스킬 관리',exact:true}).click();
   await page.getByRole('dialog',{name:'도구 목록',exact:true}).getByRole('button',{name:/^내 스킬/}).click();
   await page.getByRole('dialog',{name:'스킬 관리',exact:true}).waitFor();await page.waitForTimeout(450);
   await page.screenshot({path:path.join(dir,'skills.png')});
   await page.getByRole('button',{name:'등록',exact:true}).click();
   await page.getByRole('dialog',{name:'스킬 등록',exact:true}).waitFor();await page.waitForFunction(()=>!document.querySelector('.nubi-modal-morph-surface'),null,{timeout:3000});
   await page.screenshot({path:path.join(dir,'registration.png')});
   assert.equal(await page.locator('.nubi-modal-morph-surface').count(),0);
   checks.push('actual tool list to skills to registration dialog flow completes');
   await page.setViewportSize({width:440,height:800});await page.waitForTimeout(400);
   const box=await page.getByRole('dialog',{name:'스킬 등록',exact:true}).boundingBox();
   assert(box.x>=0&&box.x+box.width<=440&&box.y>=0&&box.y+box.height<=800);
   assert.equal(await page.locator('.nubi-modal-morph-surface').count(),0);
   await page.screenshot({path:path.join(dir,'registration-narrow.png')});
   checks.push('440px resize keeps the dialog inside the viewport and leaves no animation layer');
   await page.setViewportSize({width:1280,height:950});
   await page.goto(`http://127.0.0.1:${server.address().port}/?context&modals&integrated`);
   const target=page.getByRole('button',{name:'설정',exact:true});await target.waitFor();
   await page.evaluate(()=>{
    const start=document.startViewTransition.bind(document);
    document.startViewTransition=callback=>{const transition=start(callback);window.transitionActive=false;transition.ready.then(()=>window.transitionActive=true,()=>{});transition.finished.then(()=>window.transitionActive=false,()=>{});return transition;};
    document.addEventListener('pointerdown',event=>{window.inputDuringTransition=window.transitionActive;window.inputTarget=event.target.closest('button')?.getAttribute('aria-label');},{once:true,capture:true});
   });
   await page.getByRole('button',{name:'AI Workspace',exact:true}).evaluate(button=>button.click());
   await page.waitForFunction(()=>window.transitionActive===true);
   const targetBox=await target.boundingBox();
   await page.mouse.click(targetBox.x+targetBox.width/2,targetBox.y+targetBox.height/2);
   assert.equal(await page.evaluate(()=>window.inputTarget),'설정');
   await page.getByRole('dialog',{name:'설정',exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>window.inputDuringTransition),true,'next click reaches the UI while the transition is active');
   await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.cx-panel-backdrop'));
   checks.push('a physical click during screen transition opens settings without waiting for the snapshot');
  }
  const video=page.video();await context.close();if(video)await video.saveAs(path.join(dir,'dialog-motion.webm'));
 }
 assert.deepEqual(errors,[]);
 await writeFile(path.join(dir,'motion-result.json'),JSON.stringify({checks,errors,boundary:'Actual React/CX UI with fixture data in Chrome; normal and reduced motion. No live model or Windows performance claim.'},null,2));
 console.log(JSON.stringify({checks,errors}));
}catch(error){console.error(error);for(const context of browser.contexts())for(const page of context.pages())console.error(JSON.stringify(await page.evaluate(()=>[...document.querySelectorAll('.cx-panel-backdrop')].map(e=>({kind:e.dataset.modalMotion,html:e.innerHTML.slice(-2500),animations:e.getAnimations({subtree:true}).map(a=>({name:a.animationName,state:a.playState,time:a.currentTime}))})))));throw error;}finally{await browser.close();await new Promise(r=>server.close(r));}
