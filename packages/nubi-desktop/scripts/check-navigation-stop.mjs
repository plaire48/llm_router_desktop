// Actual Electron/PTY, isolated projects and a deliberately held local model.
// No Windows, company account or real model quality claim.
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import {ProjectService} from '../runtime/project-service.mjs';
import {desktopTestWindow,killProcessTree} from './electron-test-window.mjs';
import {captureDesign} from './design-rules.mjs';
const require=createRequire(import.meta.url),temp=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-navigation-stop-'))),storage=path.join(temp,'state'),a=path.join(temp,'project-a'),b=path.join(temp,'project-b'),out=path.resolve(process.env.NUBI_NAVIGATION_OUTPUT||'verification/navigation-stop-2026-10-24/electron');
await mkdir(out,{recursive:true});
for(const root of [a,b]){await mkdir(path.join(root,'openwiki'),{recursive:true});await writeFile(path.join(root,'openwiki/home.md'),'# Local navigation fixture');await writeFile(path.join(root,'notes.md'),'# Original notes\n');}
await writeFile(path.join(a,'busy.cjs'),"require('node:fs').writeFileSync('busy.pid',String(process.pid));console.log('navigation-child-started');setInterval(()=>{},1000);\n");
const service=new ProjectService({storageRoot:storage});const projectA=await service.open(a,{initializeWiki:false}),task=await service.createTask({request:'프로젝트 이동 확인'});
service.store.set('task:'+task.id,{...task,state:'review',messages:[{id:'preserved-answer',role:'assistant',content:'보존할 기존 답변입니다.'}]});service.dispose();service.store.close();
const catalog=new (require('../electron-app/project-catalog.cjs').ProjectCatalog)(storage);await catalog.remember(projectA);const other=new ProjectService({storageRoot:storage}),projectB=await other.open(b,{initializeWiki:false});await catalog.remember(projectB);other.dispose();other.store.close();await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root:a}));
let held=0,disconnected=0;const responses=new Set();
const model=createServer((request,response)=>{request.resume();request.on('end',()=>{held++;responses.add(response);response.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});response.flushHeaders();response.on('close',()=>{responses.delete(response);disconnected++;});});});
await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
let app,page,childPid;const errors=[],checks=[];
const row=name=>page.locator('.nubi-saved-project').filter({has:page.locator('.nubi-sidebar-project-name',{hasText:name})});
async function waitForProject(name){await page.waitForFunction(name=>document.querySelector('.nubi-saved-project[data-current=true] .nubi-sidebar-project-name')?.textContent===name,name);await page.locator('html[data-project-switching]').waitFor({state:'detached'});await page.locator('.nubi-project-switch-cover').waitFor({state:'hidden'});}
try{
 app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,OPENWIKI_CONFIG_DIR:path.join(temp,'wiki-state'),ELECTRON_RUN_AS_NODE:undefined}});
 page=await desktopTestWindow(app);page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));await (await app.browserWindow(page)).evaluate(win=>{win.setIgnoreMouseEvents(true);win.setContentSize(1280,950);});
 await page.locator('.desktop-shell[data-startup-ready=true]').waitFor({timeout:60000});await page.locator('.nubi-intro').waitFor({state:'detached'});
 await page.evaluate(connection=>window.nubi.request('provider',{action:'connect',input:connection}),{provider:'compatible',baseUrl:`http://127.0.0.1:${model.address().port}/v1`,token:'navigation-fixture',model:'navigation-fixture'});
 await page.getByRole('button',{name:task.request,exact:true}).click();const input=page.getByRole('textbox',{name:'추가 요청',exact:true});await input.waitFor();
 await page.getByRole('button',{name:'파일',exact:true}).click();await page.getByRole('button',{name:'새 탭',exact:true}).click();await page.getByRole('menuitem',{name:'터미널',exact:true}).click();await page.locator('.desktop-terminal[data-terminal-state=running]').waitFor();
 await page.locator('.desktop-terminal .xterm-helper-textarea').focus();await page.keyboard.type('node ./busy.cjs');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelector('.desktop-terminal .xterm-rows')?.textContent.includes('navigation-child-started'));
 childPid=Number(await readFile(path.join(a,'busy.pid'),'utf8'));assert(childPid>0);process.kill(childPid,0);
 await page.evaluate(taskId=>window.nubi.request('startAgent',{taskId}),task.id);
 await page.waitForFunction(async taskId=>(await window.nubi.request('state')).tasks.some(task=>task.id===taskId&&task.state==='running'),task.id);
 for(const deadline=Date.now()+15000;held===0&&Date.now()<deadline;)await new Promise(resolve=>setTimeout(resolve,10));assert(held>0,'the model request is actually in flight');await input.fill('이동 후에도 남겨 둘 초안');
 // Cancelling the folder picker does not stop a model or a terminal.
 await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});});
 await page.getByRole('button',{name:'프로젝트 추가',exact:true}).click();await page.getByRole('button',{name:/폴더 열기/}).click();
 await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-project-switching'));
 assert.equal((await page.evaluate(()=>window.nubi.request('state'))).tasks.find(item=>item.id===task.id).state,'running');process.kill(childPid,0);checks.push('cancelled folder picker preserves the running model, PTY and draft');
 await page.keyboard.press('Escape');await page.getByRole('dialog',{name:'프로젝트 연결',exact:true}).waitFor({state:'hidden'});
 await page.evaluate(()=>{window.navigationStages=[];window.navigationTerminalExits=[];window.nubi.onHostEvent(event=>{if(event.type==='project_open_progress')window.navigationStages.push(event.stage);});window.nubi.onTerminalEvent(event=>{if(event.type==='exit')window.navigationTerminalExits.push(event.id);});});
 await captureDesign(page,{path:path.join(out,'running-before.png')});const started=Date.now();await row('project-b').locator('.nubi-sidebar-project').click();await waitForProject('project-b');const navigationMs=Date.now()-started;
 const stages=await page.evaluate(()=>window.navigationStages),exits=await page.evaluate(()=>window.navigationTerminalExits);
 assert(stages.includes('stopping')&&stages.indexOf('opening')>stages.indexOf('stopping'));assert(exits.length>0,'navigation waits for the actual PTY exit event');
 assert(disconnected>0,'the pending model HTTP stream was aborted');assert.throws(()=>process.kill(childPid,0),error=>error.code==='ESRCH','the terminal child no longer exists');childPid=null;
 assert.equal(await page.getByText('진행 중인 작업을 마친 뒤 프로젝트를 바꿔 주세요.',{exact:true}).count(),0);assert(navigationMs<10000);await captureDesign(page,{path:path.join(out,'project-b.png')});checks.push('one click aborts the current model and PTY, then opens the target without a finish-work warning');
 await row('project-a').locator('.nubi-sidebar-project').click();await waitForProject('project-a');await page.getByRole('textbox',{name:'추가 요청',exact:true}).waitFor();
 const restored=await page.evaluate(()=>window.nubi.request('state')),original=restored.tasks.find(item=>item.id===task.id);
 assert.equal(original.state,'cancelled');assert(original.messages.some(message=>message.content==='보존할 기존 답변입니다.'));assert.equal(await page.getByRole('textbox',{name:'추가 요청',exact:true}).inputValue(),'이동 후에도 남겨 둘 초안');
 assert.equal(await readFile(path.join(a,'notes.md'),'utf8'),'# Original notes\n');checks.push('returning restores the cancelled conversation, prior answer, unsent draft and original file');
 await captureDesign(page,{path:path.join(out,'returned-to-a.png')});assert.deepEqual(errors,[]);
 await writeFile(path.join(out,'result.json'),JSON.stringify({ok:true,checks,errors,navigationMs,stages,exits,held,disconnected,scope:'Actual macOS Electron and PTY, synthetic held local provider, isolated storage. No Windows/SSO/live model/installer validation.'},null,2));console.log('PASS',JSON.stringify({checks,navigationMs}));
}catch(error){await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});if(page)await writeFile(path.join(out,'failure-state.json'),JSON.stringify(await page.evaluate(async()=>{const state=await window.nubi.request('state');return {provider:await window.nubi.request('provider',{action:'status'}),tasks:state.tasks.map(task=>({id:task.id,state:task.state,error:task.error,trace:task.trace,request:task.request})),agent:state.agent,alerts:[...document.querySelectorAll('[role=alert]')].map(node=>node.textContent)};}),null,2)).catch(()=>{});throw error;}
finally{const child=app?.process();if(app)await Promise.race([app.close().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,8000))]);killProcessTree(child);if(childPid)try{process.kill(childPid,'SIGTERM');}catch{}for(const response of responses)response.destroy();model.closeAllConnections();await new Promise(resolve=>model.close(resolve));await rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:250});}
