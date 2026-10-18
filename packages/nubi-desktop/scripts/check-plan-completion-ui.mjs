import {build} from 'esbuild';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/plan-completion-2026-10-16');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/plan-completion-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file','.webp':'file'},define:{'process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(dir+path.sep))throw Error();res.setHeader('content-type',({'.css':'text/css','.js':'text/javascript','.woff2':'font/woff2','.svg':'image/svg+xml'})[path.extname(file)]||'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;const errors=[];
try{
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 for(const width of [1100,440,360])for(const partial of [false,true]){
  await page.setViewportSize({width,height:600});await page.goto(`http://127.0.0.1:${server.address().port}/?${partial?'partial':''}`);
  const plan=page.getByRole('region',{name:'작업 계획',exact:true});await plan.waitFor();
  assert.equal(await plan.locator('.task-plan-count').innerText(),partial?'2/3':'3/3');
  assert.equal(await plan.getAttribute('data-status'),partial?'paused':'done');
  assert.equal(await plan.locator('[data-plan-overview]').getAttribute('open'),null);
  if(partial)await plan.getByText('1단계 확인 필요',{exact:true}).waitFor();
  await plan.locator('[data-plan-overview]>summary').click();
  assert.equal(await plan.locator('li[data-verified="true"]').count(),partial?2:3);
  assert(await plan.evaluate(el=>el.scrollWidth<=el.clientWidth));
  await page.screenshot({path:path.join(dir,`${partial?'unverified':'completed'}-${width}.png`)});
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({passed:true,widths:[1100,440,360],checks:['verified 3/3','unknown step remains 2/3 with clear status','collapsed on answer','expand preserves evidence marks','no overflow'],liveModelVerified:false},null,2));console.log('Plan completion and unverified-step UI passed at 1100/440/360px');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
