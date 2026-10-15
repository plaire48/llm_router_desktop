import {build,stop as stopBuildService} from 'esbuild';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/mail-body-images-2026-10-15');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/mail-body-images-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:900,height:700}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://fixture.invalid/**',async route=>{const data=await page.evaluate(()=>window.fixtureImage);await route.fulfill({contentType:'image/png',body:Buffer.from(data.split(',')[1],'base64')});});
 await page.goto('http://127.0.0.1:'+server.address().port);
 const frame=page.frameLocator('iframe[title="메일 본문"]');
 await frame.getByRole('img',{name:'월별 매출 그래프'}).waitFor();
 await page.waitForFunction(()=>{const doc=document.querySelector('iframe').contentDocument;return [...doc.images].filter(img=>img.complete&&img.naturalWidth===640).length===2;});
 assert.equal(await page.evaluate(()=>window.mailUnsafe),undefined);
 assert.equal(await frame.locator('script').count(),0);
 assert.equal(await frame.locator('img[src^="file:"]').count(),0);
 assert.equal(await frame.getByText('지원하지 않는 이미지',{exact:true}).count(),1);
 await page.screenshot({path:path.join(dir,'body-images.png')});
 await page.setViewportSize({width:420,height:900});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert(await frame.getByRole('img',{name:'월별 매출 그래프'}).evaluate(el=>el.getBoundingClientRect().width<=el.ownerDocument.documentElement.clientWidth));
 await page.screenshot({path:path.join(dir,'body-images-narrow.png')});assert.deepEqual(errors,[]);
 await writeFile(path.join(dir,'result.json'),JSON.stringify({passed:true,checks:['CID at body position','HTTP image rendered','no executable mail content','blocked filesystem URLs','responsive image width'],errors},null,2));console.log('Mail body images passed.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));stopBuildService();}
