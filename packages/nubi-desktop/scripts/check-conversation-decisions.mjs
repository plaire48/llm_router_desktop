import {captureDesign} from './design-rules.mjs';
import {build} from 'esbuild';
import {assertDesktopDialog} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium,_electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import assert from 'node:assert/strict';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
import {WELCOME_GREETINGS} from '../ui/welcome-greetings.mjs';
const electronMode=process.argv.includes('--electron');
const dir=path.resolve('verification/conversation-decisions-2026-10-23'+(electronMode?'/electron':''));await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file','.webp':'file','.svg':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));




let browser,p,temporary;const errors=[],checks=[];
async function resize(width,height=900){if(electronMode){const win=await browser.browserWindow(p);await win.evaluate((window,size)=>{window.setMinimumSize(1,1);window.setContentSize(size.width,size.height);},{width,height});await p.waitForFunction(width=>innerWidth===width,width);}else await p.setViewportSize({width,height});}
try{
 if(electronMode){temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-decision-render-'));const entry=path.join(temporary,'main.cjs');await writeFile(entry,"const {app,BrowserWindow}=require('electron');let win;app.whenReady().then(()=>{win=new BrowserWindow({width:1280,height:900,show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});win.loadURL('about:blank');});app.on('window-all-closed',()=>app.quit());");browser=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:[entry],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});p=await browser.firstWindow();console.log('electron-window-ready');await p.emulateMedia({reducedMotion:'reduce'});}else{browser=await chromium.launch({channel:'chrome',headless:true});p=await browser.newPage({reducedMotion:'reduce'});}p.setDefaultTimeout(15000);p.on('pageerror',error=>errors.push(error.message));
 const origin='http://127.0.0.1:'+server.address().port;
 for(const width of [1280,440,360]){
  console.log('checking',width);await resize(width);await p.goto(origin+'/?integrated&toolbar&modals&decision-sequence');
  const reveal=p.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await reveal.count())await reveal.click();
  await p.locator('.nubi-session-select').filter({hasText:'순서와 승인 화면을 확인해 주세요.'}).click();
  const close=p.getByRole('button',{name:'사이드바 접기',exact:true});if(await close.count())await close.click();
  await p.locator('.nubi-conversation-decisions:not([hidden])').waitFor();await p.evaluate(()=>document.fonts.ready);
  const order=()=>p.evaluate(()=>{const plan=document.querySelector('.nubi-agent-activity'),note=document.querySelector('[data-message-key="sequence-note"]');return {before:!!(plan.compareDocumentPosition(note)&Node.DOCUMENT_POSITION_FOLLOWING),planY:plan.getBoundingClientRect().y};});
  assert((await order()).before,'plan precedes the original note');
  const failures=p.locator('.nubi-agent-activity .agent-trace[data-state=attention]');
  assert.equal(await failures.count(),1,'adjacent failures form one record');assert.equal(await failures.getAttribute('open'),null);
  assert.equal(await p.locator('.agent-trace li[data-status=error]:visible').count(),0,'past failure badges do not crowd chat');
  await p.evaluate(()=>window.askSequenceQuestion());
  const active=p.locator('[data-decision-panel]:not([hidden])');await active.locator('.nubi-question-inline').waitFor();
  assert.equal(await p.locator('.nubi-conversation-scroll .nubi-question-inline,.nubi-conversation-scroll .nubi-approval-form,.nubi-conversation-scroll .nubi-proposal-card').count(),0,'pending forms never appear in the transcript');
  assert.equal(await active.count(),1);
  const glass=await p.locator('.nubi-conversation-decisions').evaluate(node=>({filter:getComputedStyle(node).backdropFilter,radius:getComputedStyle(node).borderRadius}));assert(glass.filter.includes('blur(24px)'),'pending form uses common glass material');
  await active.getByRole('radio',{name:'표로 정리',exact:true}).click();
  await p.waitForFunction(()=>['webgl','fallback'].includes(document.querySelector('.nubi-question-inline')?.dataset.liquidGlass));
  const glassMode=await active.locator('.nubi-question-inline').getAttribute('data-liquid-glass');
  if(glassMode==='webgl')await p.waitForFunction(()=>document.querySelector('.nubi-question-inline .nubi-liquid-glass')?.dataset.glassMoving==='false');
  await captureDesign(p,{path:path.join(dir,'question-glass-'+width+'.png'),animations:'disabled'});
  if(width===1280&&!electronMode){
   const client=await p.context().newCDPSession(p);
   await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'},{name:'prefers-reduced-transparency',value:'reduce'}]});
   await p.waitForFunction(()=>document.querySelector('.nubi-question-inline')?.dataset.liquidGlass==='fallback');
   assert.equal(await p.locator('.nubi-conversation-decisions').evaluate(node=>getComputedStyle(node).backdropFilter),'none');
   await active.getByRole('radio',{name:'문장으로 정리',exact:true}).click();assert.equal(await active.getByRole('radio',{name:'문장으로 정리',exact:true}).getAttribute('aria-checked'),'true');
   await captureDesign(p,{path:path.join(dir,'question-reduced-transparency.png'),animations:'disabled'});
   await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'},{name:'forced-colors',value:'active'}]});
   assert.equal(await p.locator('.nubi-conversation-decisions').evaluate(node=>getComputedStyle(node).backdropFilter),'none');
   await captureDesign(p,{path:path.join(dir,'question-forced-colors.png'),animations:'disabled'});
   await client.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await client.detach();
  }
  if(width===440){
   await p.evaluate(()=>document.documentElement.style.fontSize='200%');
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'200 percent text fits');
   const send=active.getByRole('button',{name:'답변 보내기',exact:true});await send.scrollIntoViewIfNeeded();
   const bounds=await send.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width,'200 percent Send stays inside');
   await captureDesign(p,{path:path.join(dir,'question-large-text.png'),animations:'disabled'});
   await p.evaluate(()=>document.documentElement.style.fontSize='');
  }


  assert((await order()).before,'asking leaves the plan at its original position');
  const field=active.getByRole('textbox',{name:'기타',exact:true});await field.fill('입력 내용 유지');
  await p.getByRole('button',{name:'다음 확인 항목',exact:true}).click();assert.equal(await active.count(),1);
  await p.getByRole('button',{name:'이전 확인 항목',exact:true}).click();assert.equal(await field.inputValue(),'입력 내용 유지');
  const geometry=await p.evaluate(()=>{const note=document.querySelector('[data-message-key="sequence-note"] .message-body'),progress=document.querySelector('.nubi-activity-note .message-body'),plan=document.querySelector('[data-plan-overview]>summary>span:first-of-type'),prompt=document.querySelector('[data-decision-panel]:not([hidden]) .nubi-question-prompt'),column=document.querySelector('.nubi-followup-stack');return {noteX:note.getBoundingClientRect().x,progressX:progress.getBoundingClientRect().x,planX:plan.getBoundingClientRect().x,promptX:prompt.getBoundingClientRect().x,column:column.getBoundingClientRect().toJSON(),overflow:document.documentElement.scrollWidth>innerWidth+1};});
  assert(Math.abs(geometry.noteX-geometry.promptX)<=1,JSON.stringify(geometry));assert(Math.abs(geometry.noteX-geometry.planX)<=1,JSON.stringify(geometry));assert(Math.abs(geometry.noteX-geometry.progressX)<=1,JSON.stringify(geometry));assert(!geometry.overflow);assert.equal(await p.locator('.nubi-decision-pages output').innerText(),'1/3');
  await captureDesign(p,{path:path.join(dir,'question-'+width+'.png'),animations:'disabled'});
  await active.getByRole('button',{name:'답변 보내기',exact:true}).click();await p.locator('[data-question-receipt="sequence-question"]').waitFor();
  assert.equal(await p.locator('[data-question-receipt="sequence-question"]').getAttribute('open'),null,'answered question collapses immediately');
  assert.equal(await p.locator('.nubi-decision-pages output').innerText(),'1/3');
  assert((await order()).before,'answering leaves the plan in order');
  // The file proposal is first in source order. Its cancel action is never automatic.
  assert.equal(await p.evaluate(()=>window.decisionSequenceCalls.length),1);
  for(let index=0;index<3;index++){
   const panel=p.locator('[data-decision-panel]:not([hidden])');
   if(await panel.locator('.nubi-proposal-card').count()){
    await panel.getByRole('button',{name:'반영',exact:true}).click();
   }else{
    await panel.getByRole('button',{name:'승인',exact:true}).click();
   }
   if(index<2)await p.waitForFunction(count=>document.querySelectorAll('[data-decision-panel]').length===count,2-index);
  }
  await p.locator('.nubi-conversation-decisions').waitFor({state:'hidden'});
  assert.equal(await p.locator('.nubi-command-record[open]').count(),0,'approved command receipts start folded');
  assert((await order()).before,'approval never moves the plan below later text');
  assert.equal(await p.locator('.nubi-applied-trigger').getAttribute('aria-expanded'),'false');
  assert.equal(await p.locator('.nubi-applied-row').count(),0,'changed file rows remain collapsed');
  await captureDesign(p,{path:path.join(dir,'completed-'+width+'.png'),animations:'disabled'});
  await p.evaluate(()=>window.advanceSequenceWithChangePlan());
  const changePlan=p.getByText('작업 계획 (1개 파일)',{exact:true});await changePlan.waitFor();
  assert(await changePlan.evaluate(node=>!!(node.compareDocumentPosition(document.querySelector('[data-message-key="sequence-note"]'))&Node.DOCUMENT_POSITION_FOLLOWING)),'a later run cannot move the prior file plan to its own position');
  checks.push({width,glass,glassMode,...geometry,checks:['single pending form','pager and draft preservation','shared reading edge','no forms inside transcript','immediate collapse','stable plan position','folded command receipts']});
 }
 for(const width of [1280,440]){
  console.log('checking',width);await resize(width);await p.goto(origin+'/?integrated&toolbar&modals&review-failure=review_schema_invalid');
  const reveal=p.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await reveal.count())await reveal.click();
  await p.locator('.nubi-session-select').filter({hasText:'요구사항과 결과를 확인해 주세요.'}).click();
  const review=p.locator('.nubi-result-review');await review.waitFor();assert.equal(await review.getAttribute('data-state'),'failed');
  assert.equal(await review.locator('.nubi-review-fold').getAttribute('open'),null,'failed review starts folded');
  const color=await review.locator('.nubi-document-progress-heading').evaluate(node=>{const probe=document.createElement('span');probe.style.color='var(--nubi-text-secondary)';node.append(probe);const same=getComputedStyle(node).color===getComputedStyle(probe).color;probe.remove();return same;});assert(color,'review summary is neutral');
  await review.locator('.nubi-review-fold>summary').click();await review.getByText(/AI의 검토 항목과 근거가 맞지 않아요/).waitFor();
  await review.locator('.nubi-review-detail>summary').click();await review.getByText('review_schema_invalid',{exact:true}).waitFor();
  await review.locator('.nubi-review-fold>summary').click();await captureDesign(p,{path:path.join(dir,'quiet-error-'+width+'.png'),animations:'disabled'});
  checks.push({width,checks:['failed review folded','neutral summary','original failure detail and code preserved']});
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({scope:(electronMode?'Actual Electron renderer':'Chrome rendering')+' of production Workbench and final CSS with synthetic requests. No live provider, actual command execution or installed host claim.',checks,errors},null,2));console.log(JSON.stringify({cases:checks.length,checks,errors}));
}catch(error){await p?.screenshot({path:path.join(dir,'failure.png')});console.error(errors);console.error((await p?.locator('body').innerText())?.slice(-5500));throw error;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));if(temporary)await rm(temporary,{recursive:true,force:true});}
