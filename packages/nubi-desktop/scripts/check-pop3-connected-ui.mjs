import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {desktopTestWindow} from './electron-test-window.mjs';
import {captureDesign} from './design-rules.mjs';

// Built product UI, scripted IPC authentication boundary. Real TLS/PASS timing
// is covered separately by mail.test.mjs; this check contacts no mail service.
const require=createRequire(import.meta.url),temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-pop3-ui-')),storage=path.join(temporary,'state'),root=path.join(temporary,'project'),out=path.resolve('verification/pop3-connected-2026-10-23');
for(const directory of [storage,root,out])await mkdir(directory,{recursive:true});await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
const app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}}),checks=[],errors=[];let page;
try{
 page=await desktopTestWindow(app);page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.locator('.desktop-shell[data-startup-ready=true]').waitFor({timeout:60000});await page.waitForFunction(()=>!document.querySelector('.nubi-intro')&&!document.querySelector('.desktop-shell')?.inert,null,{timeout:60000});
 if(await page.getByText('메일을 연결해 주세요').count())await page.keyboard.press('Escape');
 const open=async()=>{await page.getByRole('button',{name:'메일 설정',exact:true}).first().click();const dialog=page.getByRole('dialog',{name:'메일 설정',exact:true});await dialog.waitFor();return dialog;};
 let dialog=await open();await dialog.getByRole('combobox',{name:'메일 연결 방식'}).click();await page.getByRole('option',{name:'POP3',exact:true}).click();await dialog.getByRole('textbox',{name:'메일 아이디'}).waitFor();
 const base=await page.evaluate(()=>window.nubi.request('mail',{action:'status',includeMessages:false}));
 await app.evaluate(({ipcMain},base)=>{
  const original=ipcMain._invokeHandlers.get('nubi:request');globalThis.pop3Probe={status:base,completed:false,cancels:0,mode:'waiting'};
  ipcMain.removeHandler('nubi:request');ipcMain.handle('nubi:request',(event,method,args)=>{
   const probe=globalThis.pop3Probe;if(method!=='mail')return original(event,method,args);
   if(args.action==='status')return {...probe.status};
   if(args.action==='connect'){
    probe.status={...probe.status,connected:false,connecting:true,checking:false,connectionRequestId:args.requestId};probe.requestId=args.requestId;probe.completed=false;
    if(probe.mode==='failure'){probe.status.connecting=false;return {__nubiError:'mail_auth_login_rejected'};}
    return new Promise(resolve=>{probe.finish=()=>{probe.completed=true;probe.status.checking=false;resolve({...probe.status});};probe.reject=()=>resolve({__nubiError:'mail_cancelled'});});
   }
   if(args.action==='cancelConnect'){probe.cancels++;probe.status={...probe.status,connected:false,connecting:false,checking:false};probe.reject?.();return {...probe.status};}
   return original(event,method,args);
  });
 },base);
 const submit=async()=>{await dialog.getByRole('textbox',{name:'메일 아이디'}).fill('fixture-user');await dialog.getByLabel('메일 비밀번호',{exact:true}).fill('fixture-password');await dialog.getByRole('button',{name:'POP3로 연결',exact:true}).click();};
 await submit();await page.getByText('POP3 연결 확인 중',{exact:true}).waitFor();await captureDesign(page,{path:path.join(out,'waiting.png')});
 const started=Date.now();await app.evaluate(({BrowserWindow})=>{const probe=globalThis.pop3Probe;Object.assign(probe.status,{connected:true,connecting:false,checking:true,progress:{...probe.status.progress,stage:'checking'}});BrowserWindow.getAllWindows()[0].webContents.send('nubi:host-event',{type:'mail_pop3_connected',requestId:probe.requestId});});
 await dialog.waitFor({state:'hidden'});await page.getByText('POP3에 연결됐어요. 메일은 백그라운드에서 가져와요.',{exact:true}).waitFor();const closeMs=Date.now()-started;
 assert(closeMs<2000);const waiting=await app.evaluate(()=>({completed:globalThis.pop3Probe.completed,cancels:globalThis.pop3Probe.cancels}));assert.deepEqual(waiting,{completed:false,cancels:0});
 await page.getByText('메일 연결 필요',{exact:true}).waitFor({state:'hidden'});
 checks.push({name:'confirmed POP3 authentication notifies and closes the form before mailbox work finishes',closeMs});await captureDesign(page,{path:path.join(out,'connected-closed.png')});
 await app.evaluate(({BrowserWindow})=>{const probe=globalThis.pop3Probe;BrowserWindow.getAllWindows()[0].webContents.send('nubi:host-event',{type:'mail_pop3_connected',requestId:probe.requestId});});
 dialog=await open();await dialog.getByText('POP3로 연결됨',{exact:true}).waitFor();assert.equal(await page.getByText('POP3에 연결됐어요. 메일은 백그라운드에서 가져와요.',{exact:true}).count(),1);await app.evaluate(()=>globalThis.pop3Probe.finish());checks.push({name:'duplicate confirmation is silent and re-entry keeps connected settings'});
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});await app.evaluate(()=>{globalThis.pop3Probe.status.connected=false;globalThis.pop3Probe.mode='failure';});
 if(await page.locator('.nubi-feedback-toast').count())await page.locator('.nubi-feedback-toast').getByRole('button',{name:'알림 닫기'}).click();
 dialog=await open();await submit();await dialog.locator('.nubi-mail-connection-error').waitFor();assert.equal(await dialog.isVisible(),true);checks.push({name:'rejected authentication keeps the form and its recovery information'});await captureDesign(page,{path:path.join(out,'rejected.png')});
 await app.evaluate(()=>globalThis.pop3Probe.mode='waiting');await submit();await page.getByRole('button',{name:'연결 취소',exact:true}).click();await page.getByText('POP3 연결 확인 중',{exact:true}).waitFor({state:'hidden'});
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('nubi:host-event',{type:'mail_pop3_connected',requestId:globalThis.pop3Probe.requestId}));
 assert.equal(await dialog.isVisible(),true);assert.equal(await page.getByText('POP3에 연결됐어요. 메일은 백그라운드에서 가져와요.',{exact:true}).count(),0);checks.push({name:'cancelled or stale confirmation never closes a disconnected form or reports success'});
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'report.json'),JSON.stringify({checks,errors,scope:'actual built Electron UI with scripted host authentication state; no real POP3 account or Windows verification'},null,2));console.log(JSON.stringify({checks,errors}));
}catch(error){await page?.screenshot({path:path.join(out,'failure.png')});await writeFile(path.join(out,'failure.txt'),String(error.stack)+'\n'+await page?.locator('body').innerText());throw error;}
finally{await app.close();await rm(temporary,{recursive:true,force:true});}
