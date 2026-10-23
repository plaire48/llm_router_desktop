import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {desktopTestWindow} from './electron-test-window.mjs';
import {captureDesign} from './design-rules.mjs';

// Actual packaged renderer -> worker -> main -> host-event -> Workbench. This
// creates only a local draft in a temporary project, without invoking a model.
const temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-realtime-shell-')),storage=path.join(temporary,'state'),root=path.join(temporary,'project'),out=path.resolve('verification/realtime-shell-2026-10-23');
for(const directory of [storage,root,out])await mkdir(directory,{recursive:true});
await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
const app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}}),errors=[];let page;
try{
 page=await desktopTestWindow(app);page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.locator('.desktop-shell[data-startup-ready=true]').waitFor({timeout:60000});await page.waitForFunction(()=>!document.querySelector('.nubi-intro')&&!document.querySelector('.desktop-shell')?.inert,null,{timeout:60000});
 await page.keyboard.press('Escape');await page.locator('.nubi-workbench').waitFor();
 await page.evaluate(()=>{window.realtimeEvents=[];window.nubi.onHostEvent(event=>{if(event.type==='workspace_activity')window.realtimeEvents.push(event);});});
 const start=Date.now(),task=await page.evaluate(()=>window.nubi.request('createTask',{request:'IPC 실시간 갱신 확인'}));
 const reveal=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await reveal.count())await reveal.click();
 const row=page.locator('.nubi-session-select').filter({hasText:'IPC 실시간 갱신 확인'});await row.waitFor();
 const elapsedMs=Date.now()-start,events=await page.evaluate(()=>window.realtimeEvents);
 const streamProbe=await page.evaluate(taskId=>window.nubi.request('state',{taskId,streamOnly:true}),task.id);assert.deepEqual(streamProbe,{stream:null},'an idle stream read returns no transcripts or background state');
 assert(events.length>0);for(const event of events)assert.deepEqual(Object.keys(event).sort(),['projectId','type']);
 await row.click();await page.getByLabel('내 메시지',{exact:true}).filter({hasText:'IPC 실시간 갱신 확인'}).waitFor();assert.deepEqual(errors,[]);
 await captureDesign(page,{path:path.join(out,'draft-created-live.png')});
 const result={taskId:task.id,elapsedMs,eventCount:events.length,streamProbe,errors,scope:'built Electron app with actual worker and IPC, temporary draft only; no real provider or Windows'};
 await writeFile(path.join(out,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){await page?.screenshot({path:path.join(out,'failure.png')});await writeFile(path.join(out,'failure.txt'),String(error.stack)+'\n'+JSON.stringify(errors)+'\n'+await page?.locator('body').innerText());throw error;}
finally{await app.close();await rm(temporary,{recursive:true,force:true});}
