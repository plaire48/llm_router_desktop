import {build} from 'esbuild';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/progress-estimate-2026-10-15');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/progress-estimate-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

let browser;const errors=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));
 for(const width of [1280,440]){
  await p.setViewportSize({width,height:900});await p.goto('http://127.0.0.1:'+server.address().port);
  await p.waitForFunction(()=>document.querySelectorAll('[data-estimate-state="measuring"]').length===3);
  await p.waitForTimeout(1100);await p.evaluate(()=>window.advance());
  await p.waitForFunction(()=>document.querySelectorAll('[data-estimate-state="estimated"]').length===3);
  for(const item of await p.locator('.nubi-progress-estimate').all())assert.match(await item.textContent(),/현재 단계 약 .*초 남음/);
  const dialog=p.getByRole('dialog');assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth));
  await p.screenshot({path:path.join(dir,'estimate-'+width+'.png'),animations:'disabled'});
  await p.evaluate(()=>window.phase());await p.waitForFunction(()=>document.querySelectorAll('[data-estimate-state="measuring"]').length>=2);
  await p.evaluate(()=>window.finish());await p.waitForFunction(()=>document.querySelectorAll('.nubi-progress-estimate').length===0);
 }
 assert.deepEqual(errors,[]);console.log('PASS: real mail/wiki/Git progress components show measured ETA, reset by phase, stop on completion, fit 1280/440px. Synthetic throughput.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
