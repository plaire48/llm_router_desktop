import {build} from 'esbuild';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/chat-cold-open-2026-10-15');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.webp':'file','.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

let browser;const errors=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:440,height:900}});page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)});const origin='http://127.0.0.1:'+server.address().port;
 await page.goto(origin+'/?integrated&toolbar&long-chat=160&long-chat-live');const reveal=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await reveal.count())await reveal.click();await page.locator('.nubi-session-select').filter({hasText:'긴 대화 성능 확인'}).click();
 await page.locator('[data-message-key="perf-159"]').waitFor();await page.waitForFunction(()=>document.querySelector('.nubi-conversation-scroll')?.getAttribute('aria-busy')!=='true');assert.equal(await page.locator('.nubi-message').count(),40);
 // Prepend while reading: existing node identity and its viewport position survive.
 const before=await page.evaluate(()=>{const list=document.querySelector('.nubi-conversation-scroll'),node=document.querySelector('[data-message-key="perf-125"]');list.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-100}));list.scrollTop+=node.getBoundingClientRect().top-list.getBoundingClientRect().top;list.dispatchEvent(new Event('scroll',{bubbles:true}));window.retainedMessage=node;const top=node.getBoundingClientRect().top;document.querySelector('.nubi-history-more button').click();return top;});
 await page.waitForFunction(()=>document.querySelectorAll('.nubi-message').length===80);await page.waitForTimeout(150);
 const after=await page.locator('[data-message-key="perf-125"]').evaluate(node=>({top:node.getBoundingClientRect().top,same:node===window.retainedMessage}));assert(after.same);assert(Math.abs(after.top-before)<4,`anchor moved ${after.top-before}`);
 // Reaching the top loads the next batch automatically.
 await page.locator('.nubi-conversation-scroll').evaluate(el=>{el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-100}));el.scrollTop=0;el.dispatchEvent(new Event('scroll',{bubbles:true}));});await page.waitForFunction(()=>document.querySelectorAll('.nubi-message').length>=120);
 for(let batch=0;batch<5&&await page.locator('.nubi-history-more').count();batch++){await page.locator('.nubi-conversation-scroll').evaluate(el=>{el.dispatchEvent(new WheelEvent('wheel',{bubbles:true,deltaY:-100}));el.scrollTop=0;el.dispatchEvent(new Event('scroll',{bubbles:true}));});await page.waitForTimeout(150);}
 assert.equal(await page.locator('.nubi-message').count(),160);await page.locator('[data-message-key="perf-0"]').scrollIntoViewIfNeeded();await page.locator('[data-message-key="perf-0"]').getByRole('button',{name:'내 메시지 복사'}).waitFor();
 // The jump control keeps its DOM identity when its visibility changes. Removing
 // it invalidates root :has() rules across the entire loaded transcript.
 await page.locator('.nubi-jump-latest').evaluate(node=>{window.retainedJump=node;});
 await page.getByRole('button',{name:'최신 메시지로 이동',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.nubi-jump-latest')||document.querySelector('.nubi-jump-latest').hidden);
 assert.ok(await page.evaluate(()=>document.querySelector('.nubi-jump-latest')===window.retainedJump&&window.retainedJump.hidden),'jump control hides without removing its DOM');
 await page.locator('[data-message-key="perf-0"]').scrollIntoViewIfNeeded();
 await page.getByRole('button',{name:'최신 메시지로 이동',exact:true}).waitFor();
 assert.ok(await page.locator('.nubi-jump-latest').evaluate(node=>node===window.retainedJump),'same jump control returns while reading history');
 await page.evaluate(()=>window.updateLongChat());await page.waitForFunction(()=>document.querySelector('[data-message-key="perf-159"] .message-body')?.textContent==='갱신된 마지막 답변입니다.');assert.equal(await page.locator('.nubi-message').count(),160);
 await page.locator('[data-message-key="perf-159"]').scrollIntoViewIfNeeded();await page.getByRole('textbox',{name:'추가 요청',exact:true}).fill('이전 기록 유지 확인');assert.equal(await page.locator('.nubi-message').count(),160);
 await page.reload();const opener=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();await page.locator('.nubi-session-select').filter({hasText:'긴 대화 성능 확인'}).click();await page.locator('[data-message-key="perf-159"]').waitFor();await page.waitForFunction(()=>document.querySelector('.nubi-conversation-scroll')?.getAttribute('aria-busy')!=='true');assert.equal(await page.locator('.nubi-message').count(),40);
 await page.evaluate(()=>window.appendLongChat());await page.locator('[data-message-key="appended"]').waitFor();assert.equal(await page.locator('.nubi-message').count(),41);
 await page.goto(origin+'/?integrated&toolbar&long-chat=160&long-chat-question');const sidebar=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await sidebar.count())await sidebar.click();await page.locator('.nubi-session-select').filter({hasText:'긴 대화 성능 확인'}).click();await page.locator('[data-message-key="perf-5"]').waitFor();assert(await page.locator('[data-message-key="perf-5"]').textContent().then(text=>text.includes('이전 질문')));
 assert.equal(await page.locator('.nubi-message').count(),155);
 assert.deepEqual(errors,[]);await page.screenshot({path:path.join(dir,'recent-440.png')});await writeFile(path.join(dir,'regression.json'),JSON.stringify({passed:true,checks:['recent 40','anchor and DOM identity preserved','automatic prepend','all 160 reachable','latest update','input preserves loaded rows','reload starts recent','append preserves loaded history','pending question outside recent batch stays mounted'],errors},null,2));console.log('Chat history window passed.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
