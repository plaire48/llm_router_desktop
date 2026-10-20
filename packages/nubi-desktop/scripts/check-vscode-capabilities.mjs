import {captureDesign} from './design-rules.mjs';
import {assertDialogIdentity} from './identity-browser.mjs';
import {build} from 'esbuild';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/vscode-capabilities');await mkdir(dir,{recursive:true});
await build({entryPoints:['../nubi-vscode/tests/host-capabilities-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.webp':'file','.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nubi Wave 2</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/?integrated&sidebar-archive');
 try{await page.getByRole('button',{name:'새로운 결과',exact:true}).click();}catch(error){console.error({errors,text:await page.locator('body').innerText(),unsupported:await page.evaluate(()=>window.unsupportedCalls)});throw error;}
 await page.waitForTimeout(500);
 assert.deepEqual(await page.evaluate(()=>window.unsupportedCalls),[]);
 assert.equal(await page.getByLabel('읽지 않음',{exact:true}).count(),0);assert.equal(await page.getByRole('group',{name:'다음 작업 제안'}).count(),0);
 await page.locator('[data-session-id="unread"] summary').click();await page.getByRole('button',{name:'새로운 결과 고정',exact:true}).click();assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('nubi-pinned-tasks:fixture'))),['unread','pinned']);
 for(const label of ['새로운 결과 사용량','새로운 결과 Markdown으로 내보내기','새로운 결과 보관'])assert.equal(await page.getByRole('button',{name:label,exact:true}).count(),0,label);
 assert.equal(await page.getByRole('button',{name:/^보관함/}).count(),0);
 await page.getByRole('button',{name:'설정',exact:true}).click();
 assert.equal(await page.getByText('자동 보관',{exact:true}).count(),0);assert.equal(await page.getByLabel('편집 뒤 검사',{exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'루틴',exact:true}).count(),0);
 assert.equal(await page.getByText('method_invalid',{exact:false}).count(),0);assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.unsupportedCalls),[]);
 await captureDesign(page,{path:path.join(dir,'vscode-settings.png')});
 console.log('PASS: actual VS Code webview capabilities hide unsupported controls and issue no unsupported RPCs');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
