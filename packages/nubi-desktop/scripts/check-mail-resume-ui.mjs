import {build} from 'esbuild';
import {assertDesktopDialog} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/mail-storage-resume/import');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/mail-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{'process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>누비 메일 검증</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(dir+path.sep))throw Error();const data=await readFile(file);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;const errors=[];
try{
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});const p=await browser.newPage({viewport:{width:700,height:700}});p.on('pageerror',e=>errors.push(e.message));await p.goto('http://127.0.0.1:'+server.address().port);
 await p.evaluate(()=>window.setMailImportFixture({directory:'C:\\Mail export',state:'interrupted',total:11,completed:5,imported:5,duplicates:0,failures:[],startedAt:new Date().toISOString()}));
 const card=p.getByRole('region',{name:'파일에서 가져오기'});const resume=card.getByRole('button',{name:'이어 가져오기',exact:true});await resume.waitFor({timeout:10000});
 assert(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1));await p.screenshot({path:path.join(dir,'resume.png'),fullPage:true});
 await resume.click();await card.getByRole('progressbar').waitFor();assert.equal(await card.getByRole('progressbar').getAttribute('aria-valuenow'),String(5/11*100));assert.equal(await card.getByRole('progressbar').getAttribute('aria-valuemax'),'100');
 assert.equal(await p.evaluate(()=>window.mailCalls.filter(call=>call.action==='resumeImport').length),1);
 assert(await p.getByRole('button',{name:'포털 로그인',exact:true}).isDisabled());
 assert(await card.getByRole('button',{name:'폴더 선택',exact:true}).isDisabled());
 assert(await card.getByRole('button',{name:'파일 가져오기 중지'}).isEnabled());
 await card.getByRole('button',{name:'파일 가져오기 중지'}).click();await resume.waitFor();assert.equal(await p.evaluate(()=>window.mailCalls.filter(call=>call.action==='cancelImport').length),1);
 assert(await p.getByRole('button',{name:'포털 로그인',exact:true}).isEnabled());
 await p.evaluate(()=>window.setMailImportFixture({state:'scanning',total:123,completed:0,startedAt:new Date().toISOString(),failures:[]}));const scanning=card.getByRole('progressbar',{name:'메일 파일 탐색'});await scanning.waitFor();assert.equal(await scanning.getAttribute('aria-valuenow'),null);await card.getByText('123개 파일 발견').waitFor();await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await scanning.locator('span').evaluate(el=>getComputedStyle(el).animationName),'none');assert(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 assert.deepEqual(errors,[]);console.log('Passed: interrupted import, resume action, real progress counters, cancel and resume action, narrow layout. UI state is a fixture.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
