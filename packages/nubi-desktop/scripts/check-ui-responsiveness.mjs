// Exercise the actual focus/inert lifecycles, including native animation paths.
import {build,stop} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const dir=path.resolve('verification/ui-responsiveness');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/ui-responsiveness-fixture.jsx'],outdir:dir,entryNames:'app',splitting:true,bundle:true,format:'esm',platform:'browser',alias:Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),loader:{'.webp':'file','.woff2':'file','.woff':'file','.svg':'dataurl'},define:{'process.env.NODE_ENV':'"production"'}});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(dir+path.sep))throw Error();res.setHeader('content-type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser,page;const errors=[],results=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:1000,height:720}});page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'webdriver',{get:()=>false});
  window.responsiveness={ticks:0,maxTimerGap:0};let previous=performance.now();
  setInterval(()=>{const now=performance.now();window.responsiveness.ticks++;window.responsiveness.maxTimerGap=Math.max(window.responsiveness.maxTimerGap,now-previous);previous=now;},20);
 });
 for(const reducedMotion of ['no-preference','reduce']){
  await page.emulateMedia({reducedMotion});await page.goto('http://127.0.0.1:'+server.address().port);
  for(let cycle=0;cycle<6;cycle++){
   await page.getByRole('button',{name:'메뉴 열기',exact:true}).click();await page.getByRole('dialog',{name:'선택 메뉴',exact:true}).waitFor();
   await page.getByRole('button',{name:'상세 열기',exact:true}).click();const child=page.getByRole('dialog',{name:'상세 창',exact:true});await child.waitFor();
   await page.getByRole('textbox',{name:'상세 입력',exact:true}).fill('typing survives nested focus');
   // Closing a covered menu first must not restore its lock into the newer CX dialog.
   await page.evaluate(()=>window.closeAnchor());await page.getByRole('dialog',{name:'선택 메뉴',exact:true}).waitFor({state:'hidden'});
   assert(await page.locator('#root').evaluate(node=>node.inert),'the remaining dialog still protects its background');
   await page.keyboard.press('Escape');await child.waitFor({state:'hidden'});
   const locked=await page.locator('#root').evaluate(node=>node.inert);
   assert.equal(locked,false,'the last dialog must release the root input lock');
   await page.getByRole('textbox',{name:'메인 입력',exact:true}).fill('cycle '+cycle);
   await page.getByRole('button',{name:'응답 확인 '+cycle,exact:true}).click();
   await page.getByRole('button',{name:'응답 확인 '+(cycle+1),exact:true}).waitFor();
  }
  await page.evaluate(()=>{window.lockShell(true);window.openDirect();});
  await page.getByRole('dialog',{name:'상세 창',exact:true}).waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'상세 창',exact:true}).waitFor({state:'hidden'});
  assert(await page.locator('.desktop-shell').evaluate(node=>node.inert),'a separate startup/shell lock must be preserved');
  await page.evaluate(()=>window.lockShell(false));await page.getByRole('textbox',{name:'메인 입력',exact:true}).fill('shell lock preserved');
  await page.waitForFunction(()=>!document.querySelector('[data-modal-motion="leaving"]'));
  await page.evaluate(()=>window.openWikiScope());const scope=page.getByRole('dialog',{name:'먼저 정리할 폴더',exact:true});await scope.waitFor();await scope.locator('[data-admission=complete]').waitFor();assert.equal(await scope.locator('input[type=checkbox]').count(),60);await scope.getByLabel('폴더 찾기',{exact:true}).fill('synthetic-999');await scope.getByRole('checkbox',{name:'synthetic-999 파일 40개',exact:true}).check();await scope.getByRole('button',{name:'선택한 폴더부터 시작',exact:true}).click();await scope.waitFor({state:'hidden'});await page.getByRole('textbox',{name:'메인 입력',exact:true}).fill('scope selection released focus');assert.equal((await page.evaluate(()=>window.wikiScopeSelected)).length,3);
  const facts=await page.evaluate(async()=>{
   const list=document.createElement('section');list.id='state-workload';
   for(let i=0;i<500;i++){const message=document.createElement('article');message.className='message';message.innerHTML='<div class="message-actions"><span>saved</span></div>';list.append(message);}document.body.append(list);
   const settle=()=>new Promise(resolve=>setTimeout(resolve,0));await settle();
   const changed=list.firstElementChild,untouched=list.lastElementChild,original=Element.prototype.querySelector;let unrelatedReads=0;
   Element.prototype.querySelector=function(selector){if(list.contains(this)&&!changed.contains(this)&&this!==changed)unrelatedReads++;return original.call(this,selector);};
   try{
    const label=changed.querySelector('span');label.className='nubi-message-timestamp';label.setAttribute('role','alert');await settle();
    const active=changed.getAttribute('data-has-message-state'),time=changed.querySelector('.message-actions').getAttribute('data-has-message-time');
    label.className='';label.removeAttribute('role');await settle();
    return {unrelatedReads,active,time,cleared:changed.getAttribute('data-has-message-state'),untouched:untouched.getAttribute('data-has-message-state')};
   }finally{Element.prototype.querySelector=original;list.remove();await settle();}
  });
  assert.equal(facts.unrelatedReads,0,'a local status update must not query 499 unchanged message subtrees');
  assert.equal(facts.active,'true');assert.equal(facts.time,'true');assert.equal(facts.cleared,'false');assert.equal(facts.untouched,'false');
  for(let cycle=0;cycle<6;cycle++){
   const trigger=page.locator('summary[aria-label="작업 관리"]'),menu=page.getByRole('group',{name:'작업 관리',exact:true});
   await trigger.focus();await trigger.press('ArrowDown');await menu.waitFor();await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
   await page.waitForFunction(()=>document.querySelector('summary[aria-label="작업 관리"]')===document.activeElement);
  }
  const trigger=page.locator('summary[aria-label="작업 관리"]');await trigger.focus();await trigger.press('ArrowDown');await page.getByRole('button',{name:'첫 작업',exact:true}).click();
  const actionDialog=page.getByRole('dialog',{name:'상세 창',exact:true});await actionDialog.waitFor();await actionDialog.getByRole('textbox',{name:'상세 입력',exact:true}).fill('the new dialog retains focus');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert(await actionDialog.evaluate(node=>node.contains(document.activeElement)),'popover restoration must not steal focus from its action dialog');
  await page.keyboard.press('Escape');await actionDialog.waitFor({state:'hidden'});await page.getByRole('textbox',{name:'메인 입력',exact:true}).fill('menu and action dialog released focus');
  results.push({reducedMotion,cycles:6,popoverCycles:6,preservedActionDialogFocus:true,preservedShellLock:true,localFacts:facts,...await page.evaluate(()=>window.responsiveness)});
 }
 const graphics=await page.evaluate(()=>window.probeGraphicsWorkers());
 for(const result of graphics){assert(result.buffer[0]*result.buffer[1]>0);assert(result.first.visible>500);assert(result.restored.visible>500);assert.equal(result.first.error,0);assert.equal(result.restored.error,0);assert.deepEqual(result.states,['ready','lost','ready']);}
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({passed:true,results,graphics,errors,scope:'real React/CX focus and inert hooks, synthetic dialogs and real OffscreenCanvas workers in Chrome'},null,2));console.log(JSON.stringify({passed:true,results,graphics}));
}catch(error){if(page){console.error(await page.evaluate(()=>({rootInert:document.querySelector('#root')?.inert,active:document.activeElement?.outerHTML.slice(0,200),layers:[...document.body.children].map(node=>({class:node.className,inert:node.inert,motion:node.dataset.modalMotion})),responsiveness:window.responsiveness})));await page.screenshot({path:path.join(dir,'failure.png')});}throw error;}
finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));stop();}
