import {desktopTestWindow} from './electron-test-window.mjs';
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-answer-notice-')),root=path.join(temporary,'project'),storage=path.join(temporary,'state');
await mkdir(root);await mkdir(storage);
const git=args=>execFileSync('git',['-C',root,...args],{stdio:'ignore'});
git(['init']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.invalid']);await writeFile(path.join(root,'README.md'),'Test');git(['add','.']);git(['commit','-m','Fixture']);await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
let app;const errors=[];
try{
 app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}});
 const page=await desktopTestWindow(app);page.on('pageerror',e=>errors.push(e.message));
 await page.locator('.desktop-shell[data-startup-ready="true"]').waitFor({timeout:60000});await page.keyboard.press('Escape');
 const first=await page.evaluate(async()=>{const project=await window.nubi.request('overview');const task=await window.nubi.request('createTask',{request:'첫 프로젝트 알림 대상'});return {projectId:project.projectId,taskId:task.id,workspaceKind:project.kind};});
 const send=async target=>app.evaluate(({BrowserWindow},target)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL()==='app://bundle/index.html').webContents.send('nubi:host-event',{type:'answer_open',runId:'fixture-run',...target}),target);
 await send(first);await page.locator('.nubi-request').filter({hasText:'첫 프로젝트 알림 대상'}).waitFor({timeout:15000});
 const second=await page.evaluate(async()=>{const project=await window.nubi.request('startConversation');const task=await window.nubi.request('createTask',{request:'다른 공간 알림 대상'});return {projectId:project.projectId,taskId:task.id,workspaceKind:project.kind};});
 await send(second);try{await page.locator('.nubi-request').filter({hasText:'다른 공간 알림 대상'}).waitFor({timeout:15000});}catch(error){console.log('errors',errors,'screen',await page.locator('body').innerText());throw error;}
 await send(first);await page.locator('.nubi-request').filter({hasText:'첫 프로젝트 알림 대상'}).waitFor({timeout:15000});
 assert.deepEqual(errors,[]);await mkdir('verification/answer-notification-2026-10-15',{recursive:true});
 await page.screenshot({path:'verification/answer-notification-2026-10-15/conversation.png'});
 await writeFile('verification/answer-notification-2026-10-15/result.json',JSON.stringify({passed:true,sameProject:true,crossProject:true,returnToProject:true,errors,windowsToastVerified:false,boundary:'Real Electron renderer, IPC and isolated project stores; simulated notification click, no live model.'},null,2));
 console.log('Electron notification routing passed: same project, other project, return, no renderer errors. Windows toast remains unverified.');
}finally{await app?.close();await rm(temporary,{recursive:true,force:true});}
