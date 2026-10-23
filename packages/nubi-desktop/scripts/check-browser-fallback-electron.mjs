import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,realpath,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {desktopTestWindow,killProcessTree} from './electron-test-window.mjs';
import {captureDesign,assertDesignRules} from './design-rules.mjs';
const require=createRequire(import.meta.url),tmp=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-browser-fallback-'))),storage=path.join(tmp,'state'),root=path.join(tmp,'project'),output=path.resolve('verification/browser-mode-2026-10-23');
await Promise.all([mkdir(storage),mkdir(root),mkdir(output,{recursive:true})]);await writeFile(path.join(root,'example.txt'),'Browser fallback fixture\n');execFileSync('git',['init',root],{stdio:'ignore'});await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
// Reproduce the user's existing preference: integration ON, no imported window.
await writeFile(path.join(storage,'browser-preference.json'),JSON.stringify({mode:'external',executable:null}));
const site=createServer((_req,res)=>res.writeHead(200,{'content-type':'text/html;charset=utf-8'}).end('<title>내부 브라우저 검증</title><style>body{font:18px sans-serif;padding:32px;color:#191f28;background:#f1f7fe}input{font:inherit;padding:12px}</style><h1>내부 브라우저가 정상적으로 열렸어요</h1><label>페이지 초안 <input id="draft"></label>'));await new Promise(resolve=>site.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+site.address().port;
let app,page,child;const checks=[],errors=[];
async function start(){
 app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,OPENWIKI_CONFIG_DIR:path.join(tmp,'openwiki-state'),NUBI_WEB_PORT:undefined,ELECTRON_RUN_AS_NODE:undefined}});child=app.process();page=await desktopTestWindow(app);page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await (await app.browserWindow(page)).evaluate(win=>{win.setIgnoreMouseEvents(true);win.setBounds({...win.getBounds(),width:1280,height:860});});
 await app.evaluate(({shell,BrowserWindow})=>{const win=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL()==='app://bundle/index.html');win.testExternalLaunches=0;shell.openExternal=async()=>{win.testExternalLaunches++;throw Error('unexpected_external_launch');};});
 await page.locator('.desktop-shell[data-startup-ready=true]').waitFor({timeout:60000});await page.locator('.nubi-intro').waitFor({state:'detached',timeout:15000});
}
async function openBrowser(){await page.locator('.nubi-workspace-rail').getByRole('button',{name:'파일',exact:true}).click();await page.getByRole('button',{name:'새 탭',exact:true}).click();await page.getByRole('menuitem',{name:'웹',exact:true}).click();await page.getByRole('region',{name:'인터넷 브라우저',exact:true}).waitFor();}
async function nativeFacts(){return app.evaluate(async({webContents,BrowserWindow},url)=>{const contents=webContents.getAllWebContents().find(wc=>wc.getURL().startsWith(url));if(!contents)return null;const win=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL()==='app://bundle/index.html'),view=win.contentView.children.find(view=>view.webContents?.id===contents.id);return {id:contents.id,title:await contents.executeJavaScript('document.querySelector("h1")?.textContent'),draft:await contents.executeJavaScript('document.querySelector("#draft")?.value'),bounds:view?.getBounds(),visible:view?.getVisible(),externalLaunches:win.testExternalLaunches};},url);}
async function waitNative(){let value;for(let attempt=0;attempt<100;attempt++){value=await nativeFacts();if(value?.visible&&value.bounds.height>300&&value.title)break;await page.waitForTimeout(50);}assert(value?.visible&&value.bounds.height>300,JSON.stringify(value));return value;}
async function closeApp(){await app?.close().catch(()=>{});killProcessTree(child);app=null;}
try{
 await start();await openBrowser();const address=page.getByRole('textbox',{name:'인터넷 주소 또는 검색어'});await address.fill(url);await address.press('Enter');const initial=await waitNative();assert.match(initial.title,/정상적으로/);assert.equal(initial.externalLaunches,0);checks.push({name:'외부 연동 ON과 미가져오기 상태에서 실제 내부 페이지 표시',initial});
 await app.evaluate(async({webContents},url)=>{const wc=webContents.getAllWebContents().find(wc=>wc.getURL().startsWith(url));await wc.executeJavaScript('document.querySelector("#draft").value="보존할 페이지 초안"');},url);
 await page.getByRole('button',{name:'설정',exact:true}).click();let dialog=page.getByRole('dialog',{name:'설정',exact:true});await dialog.waitFor();const toggle=dialog.getByRole('switch',{name:'외부 브라우저 연동',exact:true});assert.equal(await toggle.getAttribute('aria-checked'),'true');await toggle.click();await page.waitForFunction(()=>document.querySelector('[role=dialog] [role=switch][aria-label="외부 브라우저 연동"]')?.getAttribute('aria-checked')==='false');await captureDesign(page,{path:output+'/electron-setting-off.png'});await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 const off=await waitNative();assert.equal(off.id,initial.id);assert.equal(off.draft,'보존할 페이지 초안');checks.push({name:'설정에서 OFF 뒤 같은 WebContents와 페이지 초안 유지',off});
 await page.getByRole('button',{name:'설정',exact:true}).click();dialog=page.getByRole('dialog',{name:'설정',exact:true});await dialog.getByRole('switch',{name:'외부 브라우저 연동',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[role=dialog] [role=switch][aria-label="외부 브라우저 연동"]')?.getAttribute('aria-checked')==='true');await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});const on=await waitNative();assert.equal(on.id,initial.id);assert.equal(on.draft,'보존할 페이지 초안');assert.equal(on.externalLaunches,0);checks.push({name:'다시 ON으로 바꿔도 가져오지 않은 외부 화면이 내부를 대체하지 않음',on});
 await page.getByRole('tab',{name:'파일 탐색기',exact:true}).click();await page.getByRole('tab',{name:'내부 브라우저 검증',exact:true}).click();const reentry=await waitNative();assert.equal(reentry.id,initial.id);assert.equal(reentry.draft,'보존할 페이지 초안');checks.push({name:'기존 내부 탭 재선택 시 실제 페이지와 입력 보존'});
 await assertDesignRules(page);await captureDesign(page,{path:output+'/electron-internal-shell.png'});
 const bitmap=await (await app.browserWindow(page)).evaluate(async win=>[...(await win.capturePage()).toPNG()]);await writeFile(output+'/electron-internal-page.png',Buffer.from(bitmap));
 // BrowserWindow.capturePage contains the shell, not a child WebContentsView.
 // Preserve a separate, uncomposited capture of the actual browser surface.
 const content=await app.evaluate(async({webContents},url)=>[...(await webContents.getAllWebContents().find(wc=>wc.getURL().startsWith(url)).capturePage()).toPNG()],url);await writeFile(output+'/electron-internal-content.png',Buffer.from(content));assert(content.length>1000);
 // Exercise the actual worker-to-main capture route and product composition.
 const captured=await page.evaluate(()=>window.nubi.request('captureWorkspace',{target:'page',maxWidth:1000}));assert.equal(captured.__nubiError,undefined,JSON.stringify(captured));assert(captured.image);await writeFile(output+'/electron-agent-page.png',Buffer.from(captured.image,'base64'));
 const composed=await page.evaluate(()=>window.nubi.request('captureWorkspace',{target:'window',maxWidth:1600}));assert.equal(composed.__nubiError,undefined,JSON.stringify(composed));await writeFile(output+'/electron-internal-composed.png',Buffer.from(composed.image,'base64'));checks.push({name:'연동 ON과 미가져오기 상태에서 에이전트의 내부 페이지 및 창 캡처 성공'});
 assert.equal(JSON.parse(await readFile(path.join(storage,'browser-preference.json'),'utf8')).mode,'external');await closeApp();await start();const restored=await page.evaluate(()=>window.nubi.request('browserConnection',{action:'status'}));assert.equal(restored.mode,'external');assert.equal(restored.showInternal,true);await openBrowser();checks.push({name:'재시작 후 ON 설정을 유지하면서 미가져오기 상태는 내부 화면으로 시작'});assert.deepEqual(errors,[]);
}catch(error){await page?.screenshot({path:output+'/electron-failure.png'}).catch(()=>{});throw error;}
finally{await writeFile(output+'/electron-checks.json',JSON.stringify({checks,errors,scope:'macOS actual Electron with synthetic local page; no Windows window imported'},null,2));await closeApp();site.closeAllConnections();await new Promise(resolve=>site.close(resolve));await rm(tmp,{recursive:true,force:true});}
console.log(JSON.stringify({passed:checks.length,output}));
