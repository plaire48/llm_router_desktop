import {build} from 'esbuild';
import {assertDesktopDialog,assertDialogChrome} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/chat-rendering-2026-10-15');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

let browser;const label=process.argv[2]||'candidate',runs=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(let iteration=0;iteration<(label==='verify'?0:3);iteration++){
  const p=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
  const cdp=await p.context().newCDPSession(p);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await cdp.send('Performance.enable');
  await p.goto('http://127.0.0.1:'+server.address().port+'/?integrated&toolbar&long-chat=240');
  const reveal=p.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await reveal.count())await reveal.click();
  const started=performance.now();await p.locator('.nubi-session-select').filter({hasText:'긴 대화 성능 확인'}).click();await p.locator('[data-message-key="perf-239"]').waitFor();const openMs=performance.now()-started;
  const input=p.getByRole('textbox',{name:'추가 요청',exact:true});await input.fill('준비');await p.waitForTimeout(400);
  const metric=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(v=>[v.name,v.value]));const before=await metric();
  const durations=await p.evaluate(async()=>{const input=document.querySelector('#followup'),set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set,frames=[];input.focus();for(let i=0;i<30;i++){const start=performance.now();set.call(input,'입력 성능 확인 '+i);input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));frames.push(performance.now()-start);}return frames;});
  const after=await metric();assert.equal(await input.inputValue(),'입력 성능 확인 29');
  // Reading older messages while typing must not pull the viewport back down.
  const reading=await p.evaluate(()=>{const el=document.querySelector('.nubi-conversation-scroll');el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-100}));el.scrollTop=el.scrollHeight/2;el.dispatchEvent(new Event('scroll',{bubbles:true}));return el.scrollTop;});await input.fill('이전 내용을 읽는 중');await p.waitForTimeout(100);assert(Math.abs(await p.locator('.nubi-conversation-scroll').evaluate(e=>e.scrollTop)-reading)<3);
  for(let batch=0;batch<6&&await p.locator('.nubi-history-more').count();batch++){await p.locator('.nubi-history-more button').evaluate(el=>el.click());await p.waitForTimeout(100);}
  await p.locator('[data-message-key="perf-0"]').scrollIntoViewIfNeeded();await p.locator('[data-message-key="perf-0"]').getByRole('button',{name:'내 메시지 복사'}).waitFor();assert.deepEqual(errors,[]);
  durations.sort((a,b)=>a-b);runs.push({openMs,inputMedianMs:durations[15],inputP95Ms:durations[28],scriptMs:(after.ScriptDuration-before.ScriptDuration)*1000,taskMs:(after.TaskDuration-before.TaskDuration)*1000,layoutMs:(after.LayoutDuration-before.LayoutDuration)*1000,styleMs:(after.RecalcStyleDuration-before.RecalcStyleDuration)*1000,domNodes:after.Nodes,messages:await p.locator('.nubi-message').count()});await p.close();
 }
 const verify=await browser.newPage({viewport:{width:440,height:900}});await verify.goto('http://127.0.0.1:'+server.address().port+'/?integrated&toolbar&long-chat=80&long-chat-live');
 const reveal=verify.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await reveal.count())await reveal.click();await verify.locator('.nubi-session-select').filter({hasText:'긴 대화 성능 확인'}).click();
 await verify.locator('[data-message-key="perf-79"]').waitFor();
 await verify.locator('.nubi-history-more button').evaluate(el=>el.click());
 await verify.locator('[data-message-key="perf-79"]').scrollIntoViewIfNeeded();
 await verify.waitForFunction(()=>document.querySelectorAll('.nubi-message[data-message-offscreen]').length>60);
 assert.equal(await verify.locator('[data-message-key="perf-1"] .nubi-answer-mark').evaluate(e=>getComputedStyle(e).animationPlayState),'paused');
 await verify.locator('[data-message-key="perf-1"]').scrollIntoViewIfNeeded();await verify.waitForFunction(()=>!document.querySelector('[data-message-key="perf-1"]').hasAttribute('data-message-offscreen'));
 assert.equal(await verify.locator('[data-message-key="perf-1"] .nubi-answer-mark').evaluate(e=>getComputedStyle(e).animationPlayState),'running');
 await verify.evaluate(()=>window.updateLongChat());await verify.waitForFunction(()=>document.querySelector('[data-message-key="perf-79"] .message-body')?.textContent==='갱신된 마지막 답변입니다.');
 await verify.locator('[data-message-key="perf-79"]').scrollIntoViewIfNeeded();assert.equal(await verify.locator('.nubi-message').count(),80);await verify.close();
 await writeFile(path.join(dir,label+'.json'),JSON.stringify({label,runs,boundary:'Chrome production fixture, 240 messages, 4x CPU throttling, 30 controlled input updates, 3 runs. Not Windows or live model timing.'},null,2));console.log(JSON.stringify({label,runs}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
