import {build} from 'esbuild';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/chat-cold-open-2026-10-15');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

let browser;const label=process.argv[2]||'candidate',runs=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const count of [240,1000])for(let iteration=0;iteration<3;iteration++){
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.goto('http://127.0.0.1:'+server.address().port+'/?integrated&toolbar&long-chat='+count);
  const reveal=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await reveal.count())await reveal.click();
  await page.locator('.nubi-session-select').filter({hasText:'긴 대화 성능 확인'}).waitFor();
  const openMs=await page.evaluate(async()=>{const button=[...document.querySelectorAll('.nubi-session-select')].find(e=>e.textContent.includes('긴 대화 성능 확인'));const start=performance.now();button.click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-start;});
  await page.locator('[data-message-key="perf-'+(count-1)+'"]').waitFor();assert(await page.getByRole('textbox',{name:'추가 요청',exact:true}).isVisible());assert.deepEqual(errors,[]);
  runs.push({count,iteration,openMs,mountedMessages:await page.locator('.nubi-message').count(),domNodes:await page.locator('*').count()});await page.close();
 }
 await writeFile(path.join(dir,label+'.json'),JSON.stringify({label,runs,boundary:'Mac Chrome production Workbench fixture, 4x CPU throttling, click to two animation frames; excludes app startup, IPC and real provider latency.'},null,2));console.log(JSON.stringify({label,runs}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
