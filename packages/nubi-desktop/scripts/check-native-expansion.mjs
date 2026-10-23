import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,realpath,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {desktopTestWindow,killProcessTree} from './electron-test-window.mjs';
const require=createRequire(import.meta.url),tmp=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-window-expansion-'))),storage=path.join(tmp,'state'),project=path.join(tmp,'project'),output=path.resolve('verification/interaction-atlas-2026-10-23');
await Promise.all([mkdir(storage),mkdir(project),mkdir(output,{recursive:true})]);await writeFile(path.join(project,'example.txt'),'보존할 파일\n');
execFileSync('git',['init',project],{stdio:'ignore'});await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root:project}));await writeFile(path.join(storage,'window-state.json'),JSON.stringify({bounds:{x:80,y:60,width:900,height:700},width:900,height:700,x:80,y:60,maximized:false}));
const app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,OPENWIKI_CONFIG_DIR:path.join(tmp,'openwiki-state'),NUBI_WEB_PORT:undefined,ELECTRON_RUN_AS_NODE:undefined}}),child=app.process(),checks=[],errors=[];let page;
try{
 page=await desktopTestWindow(app);page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));await page.locator('.desktop-shell[data-startup-ready=true]').waitFor({timeout:60000});await page.locator('.nubi-intro').waitFor({state:'detached',timeout:15000});
 const native=await app.browserWindow(page);await native.evaluate(win=>{win.setIgnoreMouseEvents(true);win.unmaximize();win.setBounds({x:80,y:60,width:900,height:700});win.expansionSamples=[];win.nativeEvents=[];for(const name of ['resize','move','will-move','will-resize'])win.on(name,()=>{win.nativeEvents.push({name,bounds:win.getBounds()});if(name==='resize')win.expansionSamples.push(win.getBounds().width);});});
 await page.waitForTimeout(300);
 const before=await native.evaluate(win=>win.getBounds());
 await page.locator('.nubi-workspace-rail').getByRole('button',{name:'파일',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.desktop-pane:not([hidden])'));
 await page.waitForTimeout(400);const expanded=await native.evaluate(win=>({bounds:win.getBounds(),samples:win.expansionSamples}));
 assert(expanded.bounds.width>before.width,JSON.stringify({before,expanded}));assert(new Set(expanded.samples).size>2);checks.push({name:'실제 macOS Electron 창: 보조 영역 열기와 연속 너비 확장',before,expanded});
 await page.screenshot({path:output+'/electron-expanded.png'});
 await page.getByRole('button',{name:'오른쪽 사이드바 닫기',exact:true}).click();await page.waitForTimeout(400);assert.deepEqual(await native.evaluate(win=>win.getBounds()),before);checks.push({name:'보조 영역 닫기: 자동 확장한 원래 창 크기로 복귀'});
 await page.locator('.nubi-workspace-rail').getByRole('button',{name:'파일',exact:true}).click();await page.waitForTimeout(350);
 const manuallyChosen=await native.evaluate(win=>{const b=win.getBounds();win.setBounds({...b,width:b.width-30,x:b.x+10});return win.getBounds();});
 await page.getByRole('button',{name:'오른쪽 사이드바 닫기',exact:true}).click();await page.waitForTimeout(350);assert.deepEqual(await native.evaluate(win=>win.getBounds()),manuallyChosen);checks.push({name:'사용자가 바꾼 창 위치와 너비 보존'});
 await page.emulateMedia({reducedMotion:'reduce'});await native.evaluate(win=>{win.setBounds({x:80,y:60,width:700,height:700});win.expansionSamples=[];});await page.waitForFunction(()=>innerWidth===700);await page.locator('.nubi-workspace-rail').getByRole('button',{name:'파일',exact:true}).click();await page.waitForTimeout(150);
 const reduced=await native.evaluate(win=>({bounds:win.getBounds(),samples:win.expansionSamples}));assert(reduced.bounds.width>700);assert(new Set(reduced.samples).size<=1);checks.push({name:'실제 창 모션 감소: 중간 프레임 없이 한 번에 확장',reduced});
 assert.equal(errors.length,0,JSON.stringify(errors));checks.push({name:'실제 Electron 렌더링 오류 없음'});
}catch(error){await page?.screenshot({path:output+'/native-failure.png'}).catch(()=>{});await writeFile(output+'/native-events.json',JSON.stringify(await (await app.browserWindow(page)).evaluate(win=>win.nativeEvents),null,2));throw error;}
finally{await writeFile(output+'/native-checks.json',JSON.stringify({checks,errors,scope:process.platform+' local Electron, Windows docking not executed'},null,2));await app.close().catch(()=>{});killProcessTree(child);await rm(tmp,{recursive:true,force:true});}
console.log(JSON.stringify({passed:checks.length,output}));
