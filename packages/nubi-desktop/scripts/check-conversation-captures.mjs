import {build} from 'esbuild';
import {assertDesktopDialog,assertDialogChrome} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/conversation-captures-2026-10-15');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file','.svg':'dataurl'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

let browser;const errors=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));
 const url='http://127.0.0.1:'+server.address().port+'/?integrated&toolbar&capture-gallery';
 for(const width of [1280,440]){
  await p.setViewportSize({width,height:950});await p.goto(url);
  const reveal=p.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await reveal.count())await reveal.click();
  await p.locator('.nubi-session-select').filter({hasText:'두 화면을 확인해 주세요.'}).click();
  const activity=p.locator('.nubi-activity-record');await activity.locator('summary').first().click();await activity.locator('.nubi-capture-record>summary').click();await activity.locator('.nubi-capture-thumb img').waitFor();assert.equal(await activity.locator('.nubi-capture-caption').count(),1);await activity.locator('summary').first().click();
  const answer=p.locator('.message-assistant');const fold=answer.locator('.nubi-capture-record');assert.equal(await fold.getAttribute('open'),null);assert.equal(await answer.locator('.nubi-capture-thumb').count(),0);await p.screenshot({path:path.join(dir,'collapsed-'+width+'.png')});await fold.locator('summary').click();const thumbs=answer.locator('.nubi-capture-chips');await thumbs.waitFor();await thumbs.scrollIntoViewIfNeeded();
  await p.waitForFunction(()=>[...document.querySelectorAll('.message-assistant .nubi-capture-thumb img')].filter(img=>img.complete&&img.naturalWidth===800).length===2);
  await answer.getByText('캡처 확인 불가',{exact:true}).waitFor();
  const retry=answer.getByRole('button',{name:'웹 캡처: 삭제된 이미지 다시 불러오기',exact:true});
  const reads=await p.evaluate(()=>window.captureReads.filter(id=>id==='missing').length);await p.evaluate(()=>{window.captureRecords.missing={image:'iVBORw0KGgoAAAA'};});await retry.click();await p.waitForFunction(count=>window.captureReads.filter(id=>id==='missing').length>count,reads);await retry.waitFor({state:'visible'});assert.equal(await p.getByRole('dialog').count(),0);
  await p.evaluate(()=>{window.captureRecords.missing=window.captureRecords.before;});await retry.click();await answer.getByRole('button',{name:'웹 캡처: 삭제된 이미지 크게 보기',exact:true}).waitFor();
  await p.waitForFunction(()=>document.querySelectorAll('.message-assistant .nubi-capture-thumb img').length===3);
  const open=answer.getByRole('button',{name:'웹 캡처: 수정 후 주문 화면 크게 보기',exact:true});await open.click();
  const modal=p.getByRole('dialog');await assertDesktopDialog(modal);await assertDialogChrome(modal);
  assert.match(await modal.textContent(),/800 × 450 선택 영역/);assert.equal(await modal.locator('img').getAttribute('src'),await open.locator('img').getAttribute('src'));
  assert(await modal.locator('img').evaluate(img=>{const r=img.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}));
  await p.screenshot({path:path.join(dir,'preview-'+width+'.png')});await p.keyboard.press('Escape');await modal.waitFor({state:'hidden'});
  await p.screenshot({path:path.join(dir,'conversation-'+width+'.png')});
  await fold.locator('summary').click();await p.waitForFunction(()=>!document.querySelector('.message-assistant .nubi-capture-thumb'));await p.reload();await p.locator('.message-assistant .nubi-capture-record>summary').click();await p.locator('.message-assistant .nubi-capture-chips').waitFor();
  assert.equal(await p.locator('.message-assistant .nubi-capture-caption').count(),3);
 }
 await p.goto(url.replace('capture-gallery','command-order'));
 const reveal=p.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await reveal.count())await reveal.click();
 await p.locator('.nubi-session-select').filter({hasText:'명령 순서 확인'}).click();
 const commands=p.locator('.nubi-command-record');assert.equal(await commands.count(),2);
 assert.equal(await commands.first().getAttribute('open'),null);assert.equal(await commands.first().locator('.nubi-terminal').count(),0);
 await p.getByRole('button',{name:'승인',exact:true}).waitFor();
 await commands.first().locator('summary').click();await commands.first().locator('.nubi-terminal-output').waitFor();
 assert.equal(await commands.first().locator('.nubi-terminal-output').textContent(),'first');
 assert.match(await commands.first().locator('[data-terminal-part=command]').textContent(),/node --version/);
 await commands.first().getByRole('button',{name:'터미널 열기',exact:true}).click();assert.equal(await p.evaluate(()=>window.openedTerminal.processId),'process-first');
 await commands.first().scrollIntoViewIfNeeded();await p.screenshot({path:path.join(dir,'terminal-expanded-440.png')});
 await commands.first().locator('summary').click();await p.waitForFunction(()=>!document.querySelector('.nubi-command-record .nubi-terminal'));
 assert.deepEqual(errors,[]);console.log('PASS conversation captures: exact image, label, missing state, common preview modal, reload, 1280/440px');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
