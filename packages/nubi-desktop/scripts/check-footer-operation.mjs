import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {desktopTestWindow} from './electron-test-window.mjs';
import {captureDesign} from './design-rules.mjs';

const temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-footer-operation-')),storage=path.join(temporary,'state'),root=path.join(temporary,'project'),out=path.resolve('verification/footer-operation-2026-10-23');
for(const directory of [storage,root,out])await mkdir(directory,{recursive:true});
await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));await writeFile(path.join(root,'example.js'),'const value=1;\n');await writeFile(path.join(root,'other.js'),'const other=2;\n');
const app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}}),checks=[],errors=[];let page;
try{
 page=await desktopTestWindow(app);page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 const win=await app.browserWindow(page),resize=async width=>{await win.evaluate((window,width)=>{window.setMinimumSize(1,1);window.setContentSize(width,900);},width);await page.setViewportSize({width,height:900});await page.waitForFunction(width=>innerWidth===width,width);};await resize(1280);
 await page.locator('.desktop-shell[data-startup-ready=true]').waitFor({timeout:60000});await page.waitForFunction(()=>!document.querySelector('.nubi-intro')&&!document.querySelector('.desktop-shell')?.inert,null,{timeout:60000});await page.keyboard.press('Escape');
 await app.evaluate(({ipcMain})=>{
  const original=ipcMain._invokeHandlers.get('nubi:request');globalThis.footerProbe={calls:[],pending:new Map()};ipcMain.removeHandler('nubi:request');
  ipcMain.handle('nubi:request',(event,method,args)=>{
   if(!['editorSource','saveSource'].includes(method))return original(event,method,args);
   const probe=globalThis.footerProbe;probe.calls.push(method);
   return new Promise(resolve=>probe.pending.set(method,{finish:()=>{probe.pending.delete(method);resolve(original(event,method,args));},reject:()=>{probe.pending.delete(method);resolve({__nubiError:'source_unavailable'});}}));
  });
 });
 const operation=page.locator('.desktop-mail-progress [data-workspace-operation]');
 const noTopBar=async()=>assert(await page.evaluate(()=>!document.documentElement.hasAttribute('data-host-busy')&&['none','normal'].includes(getComputedStyle(document.querySelector('.desktop-shell'),'::after').content)),'no anonymous toolbar progress line');
 await page.getByRole('button',{name:'파일',exact:true}).click();await page.getByRole('treeitem',{name:'example.js',exact:true}).dblclick();await operation.getByText('파일 읽는 중',{exact:true}).waitFor();await noTopBar();
 let box=await operation.boundingBox();assert(box.y>await page.evaluate(()=>innerHeight)-60);await captureDesign(page,{path:path.join(out,'reading-1280.png')});checks.push('delayed real file read is named in the footer');
 await app.evaluate(()=>globalThis.footerProbe.pending.get('editorSource').finish());await page.locator('.monaco-editor').first().waitFor();await operation.waitFor({state:'hidden'});
 await page.locator('.monaco-editor textarea').first().focus();await page.keyboard.type('// FOOTER_PROBE\n');await page.keyboard.press(process.platform==='darwin'?'Meta+s':'Control+s');await operation.getByText('파일 저장 중',{exact:true}).waitFor();await noTopBar();
 await resize(440);
 box=await operation.boundingBox();assert(box.x>=0&&box.x+box.width<=440);assert(await operation.evaluate(node=>{const text=node.querySelector('span:not(.status-spinner)');return text.scrollWidth<=text.clientWidth+1;}));await captureDesign(page,{path:path.join(out,'saving-440.png')});checks.push('save remains named and readable in a narrow window');
 await page.emulateMedia({reducedMotion:'reduce'});await resize(440);await page.waitForFunction(()=>{const style=getComputedStyle(document.querySelector('[data-workspace-operation] .status-spinner'));return style.animationName==='none'||style.animationPlayState==='paused';});await operation.getByText('파일 저장 중',{exact:true}).waitFor();await captureDesign(page,{path:path.join(out,'saving-440-reduced.png')});assert.equal(await page.evaluate(()=>innerWidth),440);checks.push('reduced motion retains readable work status without a moving indicator');
 await app.evaluate(()=>globalThis.footerProbe.pending.get('saveSource').finish());await operation.waitFor({state:'hidden'});assert.match(await readFile(path.join(root,'example.js'),'utf8'),/FOOTER_PROBE/);checks.push('actual save completes once and removes its busy status');
 await page.getByRole('button',{name:'파일',exact:true}).click();await page.getByRole('treeitem',{name:'other.js',exact:true}).dblclick();await operation.getByText('파일 읽는 중',{exact:true}).waitFor();await app.evaluate(()=>globalThis.footerProbe.pending.get('editorSource').reject());await operation.waitFor({state:'hidden'});await page.locator('.nubi-feedback-toast').waitFor();checks.push('failed read clears the status and retains the error');
 const calls=await app.evaluate(()=>globalThis.footerProbe.calls);assert.deepEqual(calls,['editorSource','saveSource','editorSource']);assert.deepEqual(errors,[]);
 await writeFile(path.join(out,'report.json'),JSON.stringify({checks,calls,errors,scope:'built Electron app; deferred IPC file reads and real local save in a temporary project; no provider, Windows or account validation'},null,2));console.log(JSON.stringify({checks,calls,errors}));
}catch(error){await page?.screenshot({path:path.join(out,'failure.png')});await writeFile(path.join(out,'failure.txt'),String(error.stack)+'\n'+JSON.stringify(errors)+'\n'+await page?.locator('body').innerText());throw error;}
finally{await app.close();await rm(temporary,{recursive:true,force:true});}
