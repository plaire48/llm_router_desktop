import {build,stop as stopBuildService} from 'esbuild';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/applied-files-2026-10-15');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/applied-file-changes-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.webp':'file','.svg':'file','.woff2':'file','.woff':'file','.ttf':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await build({entryPoints:['node_modules/monaco-editor/esm/vs/editor/editor.worker.js'],outfile:path.join(dir,'editor.worker.js'),bundle:true,format:'esm',platform:'browser'});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1280,height:800}});const errors=[];page.on('pageerror',e=>errors.push(e.message));const origin='http://127.0.0.1:'+server.address().port;
 for(const width of [1280,440,360]){
  await page.setViewportSize({width,height:800});await page.goto(origin);await page.locator('.nubi-applied-trigger').waitFor();assert.equal(await page.locator('.nubi-applied-trigger').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('.nubi-applied-row').count(),0);await page.locator('.nubi-applied-trigger').click();await page.locator('.nubi-applied-row').first().waitFor();
  assert.equal(await page.locator('.nubi-applied-row').count(),3);assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.method==='appliedFileSummary').length),1);
  assert(await page.locator('.nubi-applied-trigger').innerText().then(t=>t.includes('+45')&&t.includes('−9')));
  await page.screenshot({path:path.join(dir,`summary-${width}.png`)});
  await page.getByRole('button',{name:'파일 6개 더 보기'}).click();assert.equal(await page.locator('.nubi-applied-row').count(),9);
  assert(await page.locator('.nubi-applied-files').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'card fits');
  assert(await page.locator('.nubi-applied-row').evaluateAll(rows=>rows.every(el=>el.scrollWidth<=el.clientWidth+1)),'rows fit');
  await page.locator('.nubi-applied-trigger').click();assert.equal(await page.locator('.nubi-applied-row').count(),0);await page.locator('.nubi-applied-trigger').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.nubi-applied-row').count(),9);assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.method==='appliedFileSummary').length),1,'collapse does not refetch');
 }
 await page.setViewportSize({width:1280,height:800});await page.goto(origin);await page.locator('.nubi-applied-trigger').click();await page.locator('.nubi-applied-row').first().click();
 await page.locator('.desktop-applied-diff .line-insert').first().waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('.desktop-applied-diff .view-line')].some(n=>n.textContent.includes('value70')));
 assert.deepEqual(await page.evaluate(()=>window.opened),['design/workspace-density.css']);
 await page.screenshot({path:path.join(dir,'comparison-1280.png')});
 await page.goto(origin);await page.locator('.nubi-applied-trigger').click();await page.evaluate(()=>{window.delayOpen=500;});await page.locator('.nubi-applied-row').first().click();await page.evaluate(()=>window.changeTask('two'));await page.waitForTimeout(600);assert.equal(await page.locator('.desktop-applied-diff').count(),0,'late open cannot replace the new conversation');
 await page.goto(origin);await page.evaluate(()=>{window.failSummary=true;window.changeTask('retry');});await page.locator('.nubi-applied-trigger').click();await page.getByRole('button',{name:'다시 불러오기'}).waitFor();await page.evaluate(()=>window.failSummary=false);await page.getByRole('button',{name:'다시 불러오기'}).click();await page.locator('.nubi-applied-row').first().waitFor();
 // Revert to a checkpoint (opencode session revert, 2026-10-23): the oldest point is chosen first, and the revert can be undone.
 await page.goto(origin);await page.locator('.nubi-applied-trigger').click();await page.getByRole('button',{name:'변경 전으로 되돌리기'}).click();
 const dialog=page.getByRole('alertdialog',{name:'변경 전으로 되돌리기'});await dialog.waitFor();
 assert.equal(await dialog.getByRole('radio').count(),2);assert.equal(await dialog.getByRole('radio',{name:/수정 적용 전/}).isChecked(),true);
 await page.screenshot({path:path.join(dir,'revert-1280.png')});
 await dialog.getByRole('button',{name:'되돌리기',exact:true}).click();await page.getByRole('button',{name:'되돌리기 취소'}).waitFor();
 assert.equal(await page.evaluate(()=>window.calls.find(c=>c.method==='revertCheckpoint')?.checkpointId),'c1');
 await page.getByRole('button',{name:'되돌리기 취소'}).click();await page.getByRole('button',{name:'변경 전으로 되돌리기'}).waitFor();
 assert.equal(await page.evaluate(()=>window.calls.filter(c=>c.method==='undoRevert').length),1);
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({passed:true,checks:['3 initial rows','revert to the oldest checkpoint and undo','expand nine','collapse and keyboard','360/440/1280 no overflow','no refetch on toggle','real Monaco diff at changed line','stale task open ignored','summary retry'],errors},null,2));console.log('Applied file summary and Monaco comparison passed.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));stopBuildService();}
