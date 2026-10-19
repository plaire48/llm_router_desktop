import {build,stop} from 'esbuild';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {auditSurfaceTokens} from './surface-token-audit.mjs';

const label=process.argv[2]||'after',baseline=label==='before';
const dir=path.resolve('../../artifacts/workspace-codex-chat-2',label);await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.webp':'file','.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><title>누비 채팅 화면 검토</title><link rel="stylesheet" href="app.css"><body class="nubi-desktop-host"><div class="desktop-shell" data-toolbar="true" data-platform="darwin" data-layout="split"><div id="toolbar" class="desktop-titlebar"></div><div class="desktop-workspace-body"><div id="root" class="desktop-agent"></div></div></div><script type="module" src="app.js"></script></body></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[],records=[];
try{
 for(const {width,touch=false} of [...[1920,1280,760,440,360].map(width=>({width})),...(!baseline?[{width:760,touch:true}]:[])]){
  const page=await browser.newPage({viewport:{width,height:1000},hasTouch:touch});page.on('pageerror',e=>errors.push(e.message));await page.emulateMedia({reducedMotion:'reduce'});
  await page.goto(`http://127.0.0.1:${server.address().port}/?integrated&toolbar&modals&context&codex-chat`);
  const reveal=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await reveal.count())await reveal.click();
  await page.getByRole('button',{name:'대화 검색',exact:true}).click();await page.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').first().click();
  await page.locator('[data-message-key="codex-answer-2"]').waitFor();await page.evaluate(()=>document.fonts.ready);
  await page.locator('.nubi-conversation-scroll').evaluate(el=>{el.scrollTop=0;el.dispatchEvent(new Event('scroll',{bubbles:true}));});
  await auditSurfaceTokens(page,'codex-chat-'+width);
  const metrics=await page.evaluate(()=>{
   const rect=selector=>document.querySelector(selector).getBoundingClientRect().toJSON(),reading=rect('.nubi-conversation-wrap'),composer=rect('.nubi-followup-stack'),answer=document.querySelector('[data-message-key="codex-answer-2"]'),body=answer.querySelector('.message-body'),model=answer.querySelector('.answer-model'),input=document.querySelector('.nubi-composer-surface');
   return {reading,composer,body:body.getBoundingClientRect().toJSON(),model:model.getBoundingClientRect().toJSON(),modelSize:getComputedStyle(model).fontSize,inputBackground:getComputedStyle(input).backgroundColor,answerBackground:getComputedStyle(answer).backgroundColor,overflow:document.documentElement.scrollWidth>innerWidth+1,controls:[...document.querySelectorAll('.composer-bottom button')].filter(e=>e.checkVisibility()).map(e=>({name:e.getAttribute('aria-label'),...e.getBoundingClientRect().toJSON()}))};
  });
  assert(!metrics.overflow);assert(Math.abs(metrics.reading.x-metrics.composer.x)<2);assert(Math.abs(metrics.reading.width-metrics.composer.width)<2);assert(metrics.controls.every(c=>c.x>=metrics.composer.x-1&&c.right<=metrics.composer.right+1));
  if(!baseline){assert.equal(await page.locator('.nubi-answer-mark').evaluateAll(marks=>marks.every(mark=>mark.querySelectorAll('img').length===1&&!mark.querySelector('svg'))),true,'static transcript marks mount one frame, not animated mascot layers');assert(metrics.reading.width<=801);assert(metrics.model.top>=metrics.body.bottom-1,'model metadata follows the answer');assert.equal(metrics.answerBackground,'rgba(0, 0, 0, 0)');}
  if(!baseline){
   await page.getByRole('textbox',{name:'추가 요청',exact:true}).focus();await page.mouse.move(0,0);
   const fine=await page.evaluate(()=>matchMedia('(hover:hover) and (pointer:fine)').matches);
   assert.equal(fine,!touch,'exercise the intended pointer mode');
   if(fine){
    await page.waitForFunction(()=>[...document.querySelectorAll('.nubi-task .message .message-actions')].every(e=>getComputedStyle(e).opacity==='0'));
    const answer=page.locator('[data-message-key="codex-answer-2"]');await answer.hover();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-message-key="codex-answer-2"] .message-actions')).opacity==='1');
    await answer.locator('.copy-control button').focus();await page.mouse.move(0,0);
    assert.equal(await answer.locator('.message-actions').evaluate(e=>getComputedStyle(e).opacity),'1','keyboard focus keeps message tools visible');
    await page.getByRole('textbox',{name:'추가 요청',exact:true}).focus();await page.mouse.move(0,0);
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('[data-message-key="codex-answer-2"] .message-actions')).opacity==='0');
   }else{assert(await page.locator('.nubi-task .message .message-actions').evaluateAll(rows=>rows.every(e=>getComputedStyle(e).opacity==='1')),'touch message tools remain visible');}
  }
  await page.screenshot({path:path.join(dir,`chat-${width}${touch?'-touch':''}.png`),animations:'disabled'});
  if(width===1280)await page.locator('.nubi-conversation-wrap').screenshot({path:path.join(dir,'conversation.png'),animations:'disabled'});
  if(width===440){await page.evaluate(()=>document.documentElement.style.fontSize='200%');const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);assert(!overflow);await page.screenshot({path:path.join(dir,'chat-440-large-text.png'),animations:'disabled'});}
  if(!baseline&&width===1280){
   const answer=page.locator('[data-message-key="codex-answer-2"]');
   await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{}}}));
   await answer.locator('.copy-control button').click();await answer.locator('[data-copy-state="copied"]').waitFor();
   await page.getByRole('textbox',{name:'추가 요청',exact:true}).focus();await page.mouse.move(0,0);
   assert.equal(await answer.locator('.message-actions').evaluate(e=>getComputedStyle(e).opacity),'1','copy success stays visible outside hover');
   await answer.locator('[data-copy-state="idle"]').waitFor();
   await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('fixture copy failure');}}}));
   await answer.locator('.copy-control button').click();await answer.locator('[data-copy-state="error"]').waitFor();
   await page.getByRole('textbox',{name:'추가 요청',exact:true}).focus();await page.mouse.move(0,0);
   assert.equal(await answer.locator('.message-actions').evaluate(e=>getComputedStyle(e).opacity),'1','copy failure remains visible for retry');
  }
  records.push({width,touch,...metrics});await page.close();
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({label,records,errors,boundary:'Production Workbench and final Electron styles in Chrome, synthetic conversation. No live provider, installed Codex measurement, Windows or Office proof.'},null,2));console.log(JSON.stringify({label,cases:records.length,errors}));
}finally{await browser.close();await new Promise(r=>server.close(r));stop();}
