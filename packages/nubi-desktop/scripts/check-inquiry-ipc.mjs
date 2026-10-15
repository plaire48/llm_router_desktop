// Actual Electron senderFrame URL changes on hash routing. No GHES requests.
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),root=await mkdtemp(path.join(os.tmpdir(),'nubi-inquiry-ipc-'));
await writeFile(path.join(root,'preload.cjs'),`const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('fixture',{request:()=>ipcRenderer.invoke('nubi:request')});`);
await writeFile(path.join(root,'main.cjs'),`
const {app,BrowserWindow,protocol,ipcMain}=require('electron');
const {trustedRenderer}=require(${JSON.stringify(path.resolve('electron-app/renderer-scope.cjs'))});
app.setPath('userData',${JSON.stringify(path.join(root,'state'))});
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true}}]);
app.whenReady().then(async()=>{
 protocol.handle('app',()=>new Response('<!doctype html><meta charset="utf-8"><title>문의 IPC 검사</title>'));
 const window=new BrowserWindow({show:false,webPreferences:{preload:${JSON.stringify(path.join(root,'preload.cjs'))},contextIsolation:true,nodeIntegration:false,sandbox:true}});
 ipcMain.handle('nubi:request',event=>{trustedRenderer(event,window);return {ok:true};});await window.loadURL('app://bundle/index.html');
});
`);
let app;
try{
 app=await electron.launch({executablePath:require('electron'),args:[path.join(root,'main.cjs')],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});
 const page=await app.firstWindow();
 for(const hash of ['','#support','#support/42','']){const result=await page.evaluate(async hash=>{history.replaceState(null,'',location.pathname+hash);return window.fixture.request();},hash);assert.deepEqual(result,{ok:true});}
 await page.evaluate(()=>history.replaceState(null,'','/other.html#support'));await assert.rejects(page.evaluate(()=>window.fixture.request()),/ipc_scope/);
 console.log(JSON.stringify({passed:true,checks:['inquiry hash navigation','inquiry detail','profile IPC after inquiry','return to default','other document blocked'],boundary:'Actual Electron IPC with fixture responses; not company GHES verification.'}));
}finally{await app?.close();await rm(root,{recursive:true,force:true});}
