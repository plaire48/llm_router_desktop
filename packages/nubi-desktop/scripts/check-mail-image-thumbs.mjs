import {build,stop as stopBuildService} from 'esbuild';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/mail-attachments-2026-10-15');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/mail-image-thumbs-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file','.svg':'dataurl'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:900,height:700}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);
 assert.equal(await page.locator('.nubi-mail-image-thumb').count(),0);assert.equal(await page.evaluate(()=>window.calls.length),0);await page.locator('.nubi-mail-image-record>summary').click();
 const preview=page.getByRole('button',{name:'출장비 영수증.png 크게 보기'});await preview.waitFor();await page.waitForFunction(()=>document.querySelector('.nubi-mail-image-thumb img')?.naturalWidth===480);
 assert.equal(await page.locator('.nubi-mail-image-thumb').count(),1);assert.equal(await page.evaluate(()=>window.calls.length),1);
 assert.equal(await page.evaluate(()=>window.calls[0].action),'previewImage');
 await page.screenshot({path:path.join(dir,'thumbnail.png')});await preview.click();await page.getByRole('button',{name:'출장비 영수증.png 접기'}).waitFor();
 const img=page.locator('.nubi-mail-image-thumb img');assert((await img.boundingBox()).width>156);await page.screenshot({path:path.join(dir,'expanded.png')});
 await page.setViewportSize({width:420,height:700});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(dir,'narrow.png')});
 await page.evaluate(()=>window.changeHash());await page.getByRole('button',{name:'출장비 영수증.png 원문 확인'}).waitFor();assert.equal(await page.locator('.nubi-mail-image-thumb img').count(),0);
 await page.getByRole('button',{name:'출장비 영수증.png 원문 확인'}).click();assert.equal(await page.evaluate(()=>window.opened.length),1);assert.deepEqual(errors,[]);
 await page.evaluate(()=>window.changeHash('broken'));await page.getByRole('button',{name:'출장비 영수증.png 원문 확인'}).waitFor();assert.equal(await page.locator('.nubi-mail-image-thumb img').count(),0);
 await page.getByRole('button',{name:'출장비 영수증.png 원문 확인'}).click();assert.equal(await page.evaluate(()=>window.opened.at(-1).attachmentHash),'broken');assert.deepEqual(errors,[]);
 await writeFile(path.join(dir,'result.json'),JSON.stringify({passed:true,checks:['verified lazy preview','duplicate source deduplication','inline expansion','narrow viewport','changed source clears image','source recovery','corrupt image offers source recovery'],errors},null,2));console.log('Mail image thumbnails passed.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));stopBuildService();}
