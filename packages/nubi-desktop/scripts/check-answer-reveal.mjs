import {build,stop as stopBuildService} from 'esbuild';
import {assertDesktopDialog,desktopDialogScale} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/answer-reveal-2026-10-15');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/answer-reveal-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

let browser;
try {
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1000,height:940}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.waitForFunction(()=>!!window.deliverAnswer);
 assert.equal(await page.locator('.nubi-answer-piece').count(),0);
 await page.evaluate(()=>window.deliverAnswer());
 await page.locator('[data-id="new"] .nubi-answer-piece').first().waitFor({state:'attached'});
 const check=await page.evaluate(()=>{
   const nodes=[...document.querySelectorAll('[data-id="new"] .nubi-answer-piece')];
   const animations=nodes.map(node=>node.getAnimations()[0]);
   animations.forEach(animation=>{animation.pause();animation.currentTime=260;});
   return {count:nodes.length,first:Number(getComputedStyle(nodes[0]).opacity),last:Number(getComputedStyle(nodes.at(-1)).opacity),height:document.querySelector('[data-id="new"]').getBoundingClientRect().height,text:document.querySelector('[data-id="new"]').textContent};
 });
 assert(check.count>1&&check.count<=160);assert(check.first>check.last);
 await page.screenshot({path:path.join(dir,'answer-revealing.png')});
 await page.evaluate(()=>document.querySelectorAll('.nubi-answer-piece').forEach(node=>node.getAnimations().forEach(animation=>animation.finish())));
 assert.equal(await page.locator('[data-id="new"]').evaluate(n=>n.getBoundingClientRect().height),check.height);
 assert.equal(await page.locator('[data-id="new"]').textContent(),check.text);
 assert.equal(await page.locator('.code-source').textContent(),'console.log("검증 완료");');
 await page.getByRole('button',{name:'출처 1: 메일 원문'}).click();assert.equal(await page.evaluate(()=>window.sourceOpened),true);
 await page.screenshot({path:path.join(dir,'answer-complete.png')});
 await page.waitForTimeout(1200);assert.equal(await page.locator('.nubi-answer-piece').count(),0);
 await page.evaluate(()=>window.rerenderAnswer());assert.equal(await page.locator('.nubi-answer-piece').count(),0);
 await page.evaluate(()=>window.switchConversation());assert.equal(await page.locator('.nubi-answer-piece').count(),0);
 await page.evaluate(()=>window.questionAnswer());assert.equal(await page.locator('.nubi-answer-piece').count(),0);
 await page.evaluate(()=>window.clearTask());await page.waitForTimeout(50);
 // Hiding process details must not disable newly delivered answer presentation.
 await page.reload();await page.getByRole('switch',{name:'진행 과정 표시'}).click();
 assert.equal(await page.getByRole('switch').getAttribute('aria-checked'),'false');
 await page.evaluate(()=>window.deliverAnswer());
 await page.locator('[data-id="new"] .nubi-answer-piece').first().waitFor({state:'attached'});
 assert(await page.locator('[data-id="new"] .nubi-answer-piece').evaluateAll(nodes=>nodes.some(node=>node.getAnimations().length>0)));
 await page.emulateMedia({reducedMotion:'reduce'});await page.reload();await page.waitForFunction(()=>!!window.deliverAnswer);await page.evaluate(()=>window.deliverAnswer());
 await page.locator('[data-id="new"]').waitFor();assert.equal(await page.locator('.nubi-answer-piece').evaluateAll(nodes=>nodes.reduce((n,node)=>n+node.getAnimations().length,0)),0);
 await page.setViewportSize({width:440,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({passed:true,...check,errors},null,2));
 console.log('Answer reveal passed: reading order, stable layout, text/code/citation fidelity, old answers, navigation, questions, empty task, reduced motion, narrow viewport.');
} finally {await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));stopBuildService();}
