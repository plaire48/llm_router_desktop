import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import {desktopTestWindow} from './electron-test-window.mjs';
const require=createRequire(import.meta.url),temp=await mkdtemp(path.join(os.tmpdir(),'nubi-switch-check-')),storage=path.join(temp,'state'),out=path.resolve('verification/project-switch-cover');
await mkdir(storage);await mkdir(out,{recursive:true});
const roots=['project-alpha','project-beta'].map(name=>path.join(temp,name));
for(const root of roots){await mkdir(root);await writeFile(path.join(root,'note.txt'),path.basename(root));const git=args=>execFileSync('git',['-C',root,...args],{stdio:'ignore'});git(['init']);git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgSign=false','commit','-m','Fixture']);}
await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root:roots[0]}));let app,page;const errors=[];
try{
 app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}});
 page=await desktopTestWindow(app);page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.locator('.desktop-shell[data-startup-ready="true"]').waitFor({timeout:60000});await page.keyboard.press('Escape');
 await page.locator('.nubi-window-toolbar button[aria-label^="사이드바"]').waitFor();
 if(await page.getByRole('button',{name:'사이드바 펼치기',exact:true}).count())await page.getByRole('button',{name:'사이드바 펼치기',exact:true}).click();
 await page.getByRole('button',{name:'project-alpha 대화 접기',exact:true}).waitFor();
 await app.evaluate(({dialog},root)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root]});},roots[1]);
 const second=await page.evaluate(()=>window.nubi.request('chooseFolder',{}));assert(second.projectId,JSON.stringify(second));
 await page.reload();await page.locator('.desktop-shell[data-startup-ready="true"]').waitFor();await page.keyboard.press('Escape');
 await page.locator('.nubi-window-toolbar button[aria-label^="사이드바"]').waitFor();
 if(await page.getByRole('button',{name:'사이드바 펼치기',exact:true}).count())await page.getByRole('button',{name:'사이드바 펼치기',exact:true}).click();
 await page.getByRole('button',{name:'project-beta 대화 접기',exact:true}).waitFor();
 // Delay only the project-switch response, preserving real project services and rendering.
 await app.evaluate(({ipcMain})=>{const original=ipcMain._invokeHandlers.get('nubi:request');globalThis.failSwitch=false;ipcMain.removeHandler('nubi:request');ipcMain.handle('nubi:request',async(event,method,args)=>{if(method==='switchProject'){await new Promise(r=>setTimeout(r,2400));if(globalThis.failSwitch)return {__nubiError:'project_missing'};}return original(event,method,args);});});
 await page.evaluate(()=>{window.switchProgressEvents=[];window.nubi.onHostEvent(event=>{if(event.type==='project_open_progress')window.switchProgressEvents.push(event);});window.switchFrames=[];const track=()=>{const body=document.querySelector('.desktop-workspace-body'),switching=document.documentElement.hasAttribute('data-project-switching'),active=document.querySelector('.nubi-saved-project[data-current="true"] .nubi-sidebar-project-name')?.textContent;window.switchFrames.push({switching,active,opacity:body?getComputedStyle(body).opacity:null});window.trackFrame=requestAnimationFrame(track);};track();});
 await page.getByRole('button',{name:'project-alpha 대화 펼치기',exact:true}).click();
 await page.locator('html[data-project-switching]').waitFor();
 assert.equal(await page.locator('.desktop-workspace-body').evaluate(el=>getComputedStyle(el).opacity),'0');
 assert.equal(await page.locator('.desktop-workspace-body').evaluate(el=>el.inert),true);
 await page.getByRole('status',{name:'프로젝트 여는 중',exact:true}).waitFor();
 const progress=page.getByRole('region',{name:'프로젝트 이동 진행'});await progress.getByText('project-alpha',{exact:true}).waitFor();await page.waitForFunction(()=>/^[1-9]\d*초 경과$/.test(document.querySelector('.nubi-project-open-progress time')?.textContent||''));assert.equal(await progress.getByRole('progressbar').getAttribute('value'),null);await page.screenshot({path:path.join(out,'switching.png')});
 await page.locator('html[data-project-switching]').waitFor({state:'detached'});
 await page.getByRole('button',{name:'project-alpha 대화 접기',exact:true}).waitFor();
 const frames=await page.evaluate(()=>{cancelAnimationFrame(window.trackFrame);return window.switchFrames;});
 const start=frames.findIndex(row=>row.switching);assert(start>=0);assert(frames.slice(start).filter(row=>row.switching).every(row=>row.opacity==='0'));
 assert(frames.slice(start).filter(row=>!row.switching).every(row=>row.active==='project-alpha'));
 assert.equal(await page.locator('.desktop-workspace-body').evaluate(el=>el.inert),false);
 const events=await page.evaluate(()=>window.switchProgressEvents);assert(events.some(event=>event.stage==='opening'));assert(events.some(event=>event.stage==='saving'));assert(events.every(event=>Object.keys(event).every(key=>['type','requestId','stage'].includes(key))));
 await page.screenshot({path:path.join(out,'ready.png')});
 await app.evaluate(()=>{globalThis.failSwitch=true;});
 await page.getByRole('button',{name:'project-beta 대화 펼치기',exact:true}).click();await page.locator('html[data-project-switching]').waitFor();await page.locator('html[data-project-switching]').waitFor({state:'detached'});
 assert.equal(await page.locator('.nubi-saved-project[data-current="true"] .nubi-sidebar-project-name').innerText(),'project-alpha');
 assert.equal(await page.locator('.desktop-workspace-body').evaluate(el=>el.inert),false);assert.deepEqual(errors,[]);
 await writeFile(path.join(out,'result.json'),JSON.stringify({passed:true,frames,errors,failureRestoresOriginal:true,elapsedSeconds:true,projectName:true,realHostStages:true,boundary:'Actual macOS Electron with temporary local projects, delayed switch response. Windows installer not tested.'},null,2));console.log('Project switch cover passed');
}catch(error){if(page)await page.screenshot({path:path.join(out,'failure.png')});throw error;}finally{await app?.close();await rm(temp,{recursive:true,force:true});}
