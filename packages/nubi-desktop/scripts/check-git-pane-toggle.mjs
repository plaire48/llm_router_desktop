import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import {desktopTestWindow} from './electron-test-window.mjs';
const require=createRequire(import.meta.url),temp=await mkdtemp(path.join(os.tmpdir(),'nubi-git-toggle-')),root=path.join(temp,'project'),storage=path.join(temp,'state');
await mkdir(root);await mkdir(storage);await writeFile(path.join(root,'note.txt'),'fixture\n');
const git=args=>execFileSync('git',['-C',root,...args],{stdio:'ignore'});git(['init']);git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgSign=false','commit','-m','Fixture']);
await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));let app;const errors=[];
try{
 app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}});
 const p=await desktopTestWindow(app);p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));await p.locator('.desktop-shell[data-startup-ready="true"]').waitFor({timeout:60000});await p.keyboard.press('Escape');
 const rail=p.getByRole('navigation',{name:'프로젝트 도구'}),toggle=rail.getByRole('button',{name:'Git 변경',exact:true}),home=rail.getByRole('button',{name:'홈',exact:true});await toggle.waitFor();await p.waitForFunction(()=>!document.querySelector('button[aria-label="Git 변경"]').disabled);
 // Hold one read-only IPC response to reproduce a genuinely slow Git request.
 await app.evaluate(({ipcMain})=>{const original=ipcMain._invokeHandlers.get('nubi:request');globalThis.holdGit=true;ipcMain.removeHandler('nubi:request');ipcMain.handle('nubi:request',(event,method,args)=>{if(method==='workspaceChanges'&&globalThis.holdGit){globalThis.holdGit=false;return new Promise(resolve=>globalThis.finishGit=()=>resolve({__nubiError:'git_timeout'}));}return original(event,method,args);});});
 await toggle.click();await p.getByText('변경 내용 불러오는 중',{exact:true}).waitFor();assert(await home.isEnabled());
 let start=Date.now();await toggle.click();await p.locator('.desktop-change-list').waitFor({state:'hidden'});assert(Date.now()-start<1200,'close must not wait for Git');
 await app.evaluate(()=>globalThis.finishGit());await p.waitForTimeout(250);assert.equal(await p.locator('.nubi-feedback-toast').filter({hasText:'git_timeout'}).count(),0);
 await toggle.click();await p.getByRole('button',{name:'커밋 이력 보기',exact:true}).click();await p.locator('.desktop-git-history').waitFor();await toggle.click();await p.locator('.desktop-git-history').waitFor({state:'hidden'});assert.equal(await p.locator('.desktop-change-list').count(),0,'Git button closes history instead of switching views');
 await toggle.click();await p.getByRole('button',{name:'보조 영역 넓게 보기',exact:true}).click();await p.locator('.desktop-pane[data-expanded="true"]').waitFor();await home.click();await p.locator('.desktop-pane[data-expanded="true"]').waitFor({state:'hidden'});assert(await p.locator('.nubi-workbench-content').evaluate(el=>!el.inert));assert.equal(await toggle.getAttribute('aria-pressed'),'false');assert.deepEqual(errors,[]);
 console.log('Passed: immediate close during pending Git, ignored late error, history toggle, home closes expanded pane and restores interaction.');
}finally{await app?.close();await rm(temp,{recursive:true,force:true});}
