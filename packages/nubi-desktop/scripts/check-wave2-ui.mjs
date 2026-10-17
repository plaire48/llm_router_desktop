import {build} from 'esbuild';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/wave2');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.webp':'file','.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nubi Wave 2</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

let browser;const errors=[],checks=[];
try {
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const width of [1280,440]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?integrated&chapters');
  const opener=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();
  const projectRow=page.locator('.nubi-saved-project[data-current="true"]>.nubi-sidebar-project-row');
  assert(await projectRow.evaluate(row=>{const clear=n=>getComputedStyle(n).backgroundColor==='rgba(0, 0, 0, 0)';return !clear(row)&&clear(row.querySelector('.nubi-sidebar-project'))&&clear(row.querySelector('summary'));}),'project name and more action must share one row background');
  await page.getByRole('button',{name:'대화 검색',exact:true}).click();await page.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').first().click();
  const nav=page.getByRole('navigation',{name:'챕터 목차'});await nav.waitFor({timeout:10000});
  assert.equal(await page.locator('.nubi-chapter[role="separator"]').count(),3);
  assert.equal(await nav.getByRole('button').count(),3);
  const assertSeparated=async()=>assert(await nav.evaluate(node=>{const a=node.getBoundingClientRect(),b=node.closest('.nubi-conversation-wrap').querySelector('.nubi-conversation-scroll').getBoundingClientRect();return a.right<=b.left+1||a.left>=b.right-1||a.bottom<=b.top+1||a.top>=b.bottom-1;}),'chapter navigation must have its own space outside the transcript');
  await assertSeparated();
  const before=await page.locator('.message').allTextContents();
  for(const index of [2,0,1]){
   await nav.getByRole('button').nth(index).click();
   await page.waitForFunction(id=>{const node=document.getElementById(id),box=node?.getBoundingClientRect(),scroll=node?.closest('.nubi-conversation-scroll')?.getBoundingClientRect();return box&&scroll&&box.top>=scroll.top-1&&box.bottom<=scroll.bottom+1;},'chapter-fixture-chapter-'+index);
  }
  await assertSeparated();
  assert.deepEqual(await page.locator('.message').allTextContents(),before);
  assert(await nav.evaluate(node=>{const box=node.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth;}));
  await page.screenshot({path:path.join(dir,'chapters-'+width+'.png'),animations:'disabled'});
  checks.push({scene:'chapters',width,dividers:3,buttons:3,historyPreserved:true});await page.close();
 }
 for(const many of [false,true]){
 const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/?integrated&chapters&chapters-long'+(many?'&chapters-many':''));
 const opener=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();
 await page.getByRole('button',{name:'대화 검색',exact:true}).click();await page.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').first().click();
 const nav=page.getByRole('navigation',{name:'챕터 목차'});await nav.waitFor();
 if(many)assert(await nav.evaluate(node=>node.getBoundingClientRect().height<=innerHeight/2),'chapter contents must leave room for the conversation');
 await nav.getByRole('button').first().click();
 await page.waitForFunction(()=>{const node=document.getElementById('chapter-fixture-chapter-0'),box=node?.getBoundingClientRect(),scroll=node?.closest('.nubi-conversation-scroll')?.getBoundingClientRect();return box&&scroll&&box.top>=scroll.top-1&&box.bottom<=scroll.bottom+1;});
 assert.equal(await page.locator('.message').count(),87);
 checks.push({scene:many?'chapters-many':'chapters-long',messages:86,historyRevealed:true});await page.close();
 }
 assert.deepEqual(errors,[]);
 await writeFile(path.join(dir,'result.json'),JSON.stringify({checks,errors,scope:'Synthetic Workbench fixture on macOS; no live model or Windows verification.'},null,2));
 console.log('PASS: chapters');
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
