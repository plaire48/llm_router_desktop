import {build} from 'esbuild';
import {assertDesktopDialog} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/mail');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/mail-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{'process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>누비 메일 검증</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(dir+path.sep))throw Error();const data=await readFile(file);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;const errors=[],checks=[];
try{
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});const p=await browser.newPage({viewport:{width:1000,height:1000}});p.on('pageerror',e=>errors.push(e.message));await p.goto('http://127.0.0.1:'+server.address().port);
 const dialog=p.locator('.cx-panel-backdrop.is-modal > .nubi-panel');await assertDesktopDialog(dialog);const ways=p.getByRole('group',{name:'메일 가져오는 방법'});await ways.waitFor();
 // Two ways in, as cards (2026-10-14): the portal (recommended, the one filled button) and a folder of files. Nothing asks for a password.
 assert.equal(await ways.getByRole('button',{name:/^(포털 로그인|다시 로그인)$/}).count(),1);assert.equal(await ways.getByRole('button',{name:'폴더 선택',exact:true}).count(),1);assert.equal(await ways.getByText('추천',{exact:true}).count(),0);
 assert.equal(await p.locator('input:not([type=checkbox])').count(),0);assert.equal(await p.getByRole('search').count(),0);assert.equal(await p.getByText(/마지막 확인/).count(),0);assert.equal(await p.evaluate(()=>window.mailCalls.length),0);
 await p.screenshot({path:path.join(dir,'cards.png'),fullPage:true});checks.push('two entry cards, no password field, no empty counters; opening does not connect');
 await p.evaluate(()=>window.mailFail='mail_portal_login');await ways.getByRole('button',{name:/^(포털 로그인|다시 로그인)$/}).click();
 const failure=p.locator('.nubi-mail-connection-error');await ways.getByRole('button',{name:'다시 로그인',exact:true}).waitFor();await failure.getByText('연결 정보',{exact:true}).waitFor();await p.screenshot({path:path.join(dir,'relogin.png'),fullPage:true});await failure.locator('summary').click();assert.match(await failure.innerText(),/mail_portal_login/);await ways.waitFor();checks.push('a failed portal login keeps both cards and reports through the persistent connection detail');
 await p.setViewportSize({width:440,height:950});await failure.locator('summary').click();await p.screenshot({path:path.join(dir,'relogin-narrow.png'),fullPage:true});assert(await ways.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
 for(const [code,title] of [['mail_portal_timeout','포털 응답이 늦어요'],['mail_portal_request','사내 포털에 연결하지 못했어요']]){
   await p.evaluate(code=>window.mailFail=code,code);await ways.getByRole('button',{name:/^(포털 로그인|다시 로그인)$/}).click();await failure.getByText(title,{exact:true}).waitFor();await failure.locator('summary').click();assert.match(await failure.innerText(),new RegExp(code));assert(await failure.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
   await p.screenshot({path:path.join(dir,code+'.png'),fullPage:true});
 }
 checks.push('persistent diagnostics distinguish timeout from request failures and fit 440px');
 await p.evaluate(()=>window.mailFail=false);await ways.getByRole('button',{name:/^(포털 로그인|다시 로그인)$/}).click();await p.getByText('사내 포털 연결됨').waitFor();await p.getByRole('img',{name:'메일 원문과 첨부 암호화 저장'}).waitFor();checks.push('the connected heading shows the encrypted-storage lock');assert.equal(await ways.count(),0);assert.equal((await p.evaluate(()=>window.mailCalls.filter(c=>c.action==='portalLogin'))).length,4);
 const files=p.getByRole('region',{name:'파일에서 가져오기'});await files.getByRole('button',{name:'폴더 선택',exact:true}).waitFor();checks.push('a successful login replaces the cards with the connected heading and keeps the file import');
 const autoWiki=p.getByRole('switch',{name:'메일 자동 정리'});await autoWiki.click();await p.waitForFunction(()=>document.querySelector('[role=switch][aria-label="메일 자동 정리"]')?.getAttribute('aria-checked')==='false');await autoWiki.click();await p.waitForFunction(()=>document.querySelector('[role=switch][aria-label="메일 자동 정리"]')?.getAttribute('aria-checked')==='true');assert.equal(await p.evaluate(()=>window.mailCalls.filter(c=>c.action==='setAutoWiki').length),2);checks.push('automatic organization ON/OFF uses the shared switch');
 await files.getByRole('button',{name:'폴더 선택',exact:true}).click();await files.getByText('가져오기 완료',{exact:true}).waitFor();await files.getByText(/추가 1 \/ 중복 제외 0/).waitFor();assert.equal(await p.evaluate(()=>window.mailCalls.filter(c=>c.action==='importMailFolder').length),1);checks.push('the folder import reports what it added and what it skipped');
 await p.screenshot({path:path.join(dir,'connected.png'),fullPage:true});await assertDesktopDialog(dialog);await p.screenshot({path:path.join(dir,'narrow.png'),fullPage:true});checks.push('shared identity and narrow layout');
 await p.getByRole('button',{name:'메일 로그아웃',exact:true}).click();await ways.waitFor();
 await p.evaluate(()=>window.mailSlow=true);await ways.getByRole('button',{name:/^(포털 로그인|다시 로그인)$/}).click();await p.waitForFunction(()=>window.mailCalls.at(-1).action==='portalLogin');const request=await p.evaluate(()=>window.mailCalls.at(-1).requestId);await p.getByText('포털 로그인 확인 중',{exact:true}).waitFor();assert((await p.locator('.nubi-mail-connection-overlay').boundingBox()).height<260);await p.screenshot({path:path.join(dir,'login-wait.png'),fullPage:true});await dialog.getByRole('button',{name:/닫기/}).first().click();await p.waitForTimeout(600);assert.equal(await p.evaluate(id=>window.mailCalls.some(c=>c.action==='cancelConnect'&&c.requestId===id),request),false);await p.evaluate(()=>window.releaseMail?.());checks.push('closing the dialog during a pending login keeps the login running (the in-app login page stays open, 2026-10-14)');
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({scope:'synthetic API + real Chrome UI, no internal server',checks},null,2));console.log(JSON.stringify({checks}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
