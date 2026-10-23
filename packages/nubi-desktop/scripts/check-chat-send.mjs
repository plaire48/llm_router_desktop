import {build} from 'esbuild';
import {assertDesktopDialog} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
import {WELCOME_GREETINGS} from '../ui/welcome-greetings.mjs';
const dir=path.resolve('verification/chat-send');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.webp':'file','.woff2':'file','.woff':'file','.svg':'dataurl'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));


let browser;const errors=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const width of [1280,440,360]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:width===360?'reduce':'no-preference'}),p=await context.newPage();p.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message);});
  await p.addInitScript(()=>{
   Object.defineProperty(navigator,'webdriver',{get:()=>false,configurable:true});
   window.viewCaptures=0;window.activeCaptures=0;
   const start=document.startViewTransition.bind(document);document.startViewTransition=(...args)=>{window.viewCaptures++;window.activeCaptures++;const t=start(...args);t.finished.then(()=>window.activeCaptures--,()=>window.activeCaptures--);return t;};
   let inObserver=false;window.composerColdReads=0;window.fontReadyReads=0;
   const fontReady=Object.getOwnPropertyDescriptor(FontFaceSet.prototype,'ready');Object.defineProperty(FontFaceSet.prototype,'ready',{...fontReady,get(){window.fontReadyReads++;return fontReady.get.call(this);}});
   const NativeObserver=window.ResizeObserver,scrollHeight=Object.getOwnPropertyDescriptor(Element.prototype,'scrollHeight');
   window.ResizeObserver=class extends NativeObserver{constructor(callback){super((...args)=>{inObserver=true;try{callback(...args);}finally{inObserver=false;}});}};
   Object.defineProperty(Element.prototype,'scrollHeight',{...scrollHeight,get(){if(this.matches?.('textarea.aipro-message-input')&&!inObserver)window.composerColdReads++;return scrollHeight.get.call(this);}});
  });
  await p.goto('http://127.0.0.1:'+server.address().port+'/?integrated&send-transition');
  const field=p.locator('textarea');await field.waitFor();await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await p.evaluate(()=>window.viewCaptures),0,'initial closed-screen state must not capture a no-op view transition');
  assert.equal(await p.evaluate(()=>window.fontReadyReads),0,'mount must not force style via FontFaceSet.ready');
  assert.equal(await p.evaluate(()=>window.composerColdReads),0,'initial composer must not force textarea layout before ResizeObserver delivery');
  await field.fill(Array.from({length:30},(_,i)=>`긴 초안 ${i+1}`).join('\n'));await p.getByRole('button',{name:'더 보기',exact:true}).click();
  assert.equal(await p.locator('.nubi-composer-input').getAttribute('data-expanded'),'true');
  await field.fill('메일과 코드의 차이를 확인해 주세요.');await p.waitForFunction(()=>document.querySelector('.nubi-composer-input')?.dataset.expanded==='false');
  assert.equal(await p.locator('.nubi-composer-more').count(),0);
  assert.equal(await p.locator('.nubi-composer-input').getAttribute('data-expanded'),'false');
  // Hold admission completely: the screen must change without any host response.
  await field.press('Enter');await p.waitForFunction(()=>window.sendGate.createTask);
  await p.locator('.nubi-outgoing').waitFor();assert.equal(await field.inputValue(),'');assert.equal(await p.locator('.welcome').count(),0);
  assert.equal(await p.locator('.nubi-user-bubble').count(),1);assert(await p.getByText('요청 보내는 중',{exact:true}).isVisible());
  await field.fill('보내는 동안 작성한 다음 초안');await p.locator('.nubi-compose-card').evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished.catch(()=>{}))));const pendingBox=await field.boundingBox();
  await p.screenshot({path:path.join(dir,`pending-${width}.png`),animations:'disabled'});
  await p.evaluate(()=>window.sendGate.createTask.release());await p.waitForFunction(()=>window.sendGate.startAgent);
  await p.getByText('시작하는 중',{exact:true}).waitFor();assert.equal(await field.inputValue(),'보내는 동안 작성한 다음 초안');
  assert.equal(await p.locator('.nubi-user-bubble').count(),1);const admittedBox=await field.boundingBox();
  assert(Math.abs(pendingBox.y-admittedBox.y)<12,JSON.stringify({pendingBox,admittedBox}));
  await p.evaluate(()=>window.sendGate.startAgent.release());await p.getByRole('button',{name:'중지',exact:true}).waitFor();
  await p.waitForFunction(()=>!document.querySelector('.nubi-outgoing'));assert.equal(await field.inputValue(),'보내는 동안 작성한 다음 초안');
  // Queued steering responds instantly too, before its receipt returns.
  await field.press('Enter');await p.waitForFunction(()=>window.sendGate.agentInput);await p.getByText('대기열에 보내는 중',{exact:true}).waitFor();assert.equal(await field.inputValue(),'');
  await field.fill('다음 초안 유지');await p.evaluate(()=>window.sendGate.agentInput.release());
  await p.waitForFunction(()=>!document.querySelector('.nubi-outgoing'));assert.equal(await field.inputValue(),'다음 초안 유지');
  await p.evaluate(()=>{window.finishSend();window.sendGate.startAgent=null;});await p.getByText('확인한 결과입니다.',{exact:true}).waitFor();
  if(width===1280){
   await p.waitForFunction(()=>document.querySelector('.nubi-conversation-scroll')?.dataset.admission==='complete'&&window.activeCaptures===0);
   const before=await p.evaluate(()=>window.viewCaptures);
   await p.locator('.nubi-session-row[data-current="true"] .nubi-session-select').click();
   await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   assert.equal(await p.evaluate(()=>window.viewCaptures),before,'reselecting the displayed conversation must not snapshot unchanged screens');
   await p.getByRole('button',{name:'사이드바 접기',exact:true}).click();
   await p.waitForFunction(before=>window.viewCaptures>before,before);
   await p.getByRole('button',{name:'사이드바 펼치기',exact:true}).click();
  }
  // Existing conversation follow-up must also appear before admission.
  await field.fill('기존 대화 추가 요청');await field.press('Enter');await p.waitForFunction(()=>window.sendGate.startAgent);await p.locator('.nubi-outgoing').waitFor();
  assert.equal(await field.inputValue(),'');assert.equal(await p.locator('.nubi-user-bubble').filter({hasText:'기존 대화 추가 요청'}).count(),1);
  await field.fill('실패해도 남는 새 초안');await p.evaluate(()=>window.sendGate.startAgent.reject());
  await p.getByText('전송 결과 확인 필요',{exact:true}).waitFor({timeout:6000}).catch(async error=>{await p.screenshot({path:path.join(dir,'failed.png')});console.log(await p.locator('body').innerText());throw error;});assert.equal(await field.inputValue(),'실패해도 남는 새 초안');
  assert.equal(await p.evaluate(()=>window.sendCalls.filter(c=>c.method==='startAgent').length),3,'uncertain admission is never resent');
  await p.screenshot({path:path.join(dir,`recovery-${width}.png`),animations:'disabled'});
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  // Preserve the exact uncertain request across renderer reloads.
  await p.evaluate(()=>window.saveSendFixture());await p.reload();await p.getByText('전송 결과 확인 필요',{exact:true}).waitFor();
  assert.equal(await field.inputValue(),'실패해도 남는 새 초안');assert.equal(await p.locator('.nubi-user-bubble').filter({hasText:'기존 대화 추가 요청'}).count(),1);
  if(width===1280){
   await p.waitForFunction(()=>window.activeCaptures===0);
   const before=await p.evaluate(()=>window.viewCaptures);
   await p.getByRole('button',{name:'새 대화',exact:true}).click();
   await p.waitForFunction(before=>window.viewCaptures>before,before,{timeout:1500});
   await p.waitForFunction(()=>window.activeCaptures===0);
   const beforeSelect=await p.evaluate(()=>window.viewCaptures);
   await p.locator('.nubi-session-row .nubi-session-select').first().click();
   await p.waitForFunction(before=>window.viewCaptures>before,beforeSelect,{timeout:1500});
  }
  await context.close();console.log(`PASS ${width}px: held create/start/queue, immediate bubble, draft handoff, stable composer, uncertain failure and reload recovery.`);
 }
 const loginPage=await browser.newPage({viewport:{width:1280,height:800}});loginPage.on('pageerror',e=>errors.push(e.message));
 for(const connected of [false,true]){
  await loginPage.goto('http://127.0.0.1:'+server.address().port+'/?integrated&modals&toolbar'+(connected?'&company-connected':''));
  const account=loginPage.locator('.nubi-account-button');await account.waitFor();
  if(connected)await account.locator('img').waitFor();
  else {assert.equal(await account.innerText(),'로그인');assert.equal(await account.locator('.nubi-account-avatar svg').count(),1);}
  await account.click();await loginPage.locator('.nubi-ghes-modal').waitFor();
  await loginPage.screenshot({path:path.join(dir,connected?'account-connected.png':'github-login.png'),animations:'disabled'});
 }
 await loginPage.close();
 assert.deepEqual(errors,[]);console.log('PASS: actual Workbench with controlled host latency; no real provider request.');
}finally{await browser?.close();server.close();}
