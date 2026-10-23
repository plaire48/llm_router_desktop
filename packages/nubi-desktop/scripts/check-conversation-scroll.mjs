import {build} from 'esbuild';
import {assertDesktopDialog} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/conversation-scroll');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/conversation-scroll-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file','.svg':'dataurl'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

let browser;try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.message-user').first().waitFor();
 await page.evaluate(()=>window.scrollFixture.send());await page.locator('[data-message-key="new"]').waitFor();
 const offset=()=>page.locator('[data-message-key="new"]').evaluate(node=>node.getBoundingClientRect().top-document.querySelector('.viewport').getBoundingClientRect().top);
 // The sent turn stays in view at the bottom and the viewport keeps following as progress grows (2026-10-14).
 const atBottom=()=>page.locator('.viewport').evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop<2);
 await page.waitForFunction(()=>{const el=document.querySelector('.viewport');return el.scrollHeight-el.clientHeight-el.scrollTop<2;});assert((await offset())>0&&(await offset())<500);
 for(let i=0;i<4;i++){await page.evaluate(()=>window.scrollFixture.grow());await page.waitForFunction(count=>document.querySelectorAll('.viewport p').length===count,(i+1)*10);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert(await atBottom());}
 await page.evaluate(()=>window.scrollFixture.receipt());await page.getByText('이어서 요청 접수됨',{exact:true}).waitFor();assert(await atBottom());
 const bottom=await page.locator('.viewport').evaluate(el=>el.scrollTop);await page.locator('.viewport').hover();await page.mouse.wheel(0,-300);await page.waitForFunction(limit=>document.querySelector('.viewport').scrollTop<limit,bottom-100);const reading=await page.locator('.viewport').evaluate(el=>el.scrollTop);
 await page.evaluate(()=>window.scrollFixture.grow());await page.waitForFunction(()=>document.querySelectorAll('.viewport p').length===50);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));assert(Math.abs(await page.locator('.viewport').evaluate(el=>el.scrollTop)-reading)<2);
 await page.getByRole('button',{name:'최신으로'}).click();assert(await page.locator('.viewport').evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop<2));assert.deepEqual(errors,[]);console.log('PASS new turn follows the bottom through streaming and admission; manual reading stays put; explicit latest resumes.');
}finally{await browser?.close();server.close();}
