// Native Electron with isolated folders and a saved answer, no external model.
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import {ProjectService} from '../runtime/project-service.mjs';
import {hash} from '../runtime/files.mjs';
const require=createRequire(import.meta.url),temporary=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-projects-check-'))),storage=path.join(temporary,'state'),a=path.join(temporary,'project-a'),b=path.join(temporary,'project-b');
for(const root of [a,b]){await mkdir(path.join(root,'openwiki'),{recursive:true});await writeFile(path.join(root,'openwiki/home.md'),'# Project wiki\n');await writeFile(path.join(root,'notes.md'),root===a?'# Project A\nOriginal evidence.\n':'# Project B\nDifferent evidence.\n');}
const service=new ProjectService({storageRoot:storage});const overview=await service.open(a,{initializeWiki:false});const task=await service.createTask({request:'원본 출처와 프로젝트 관리 확인'}),runId='8c33a908-b6f0-4712-b126-2314458135f3';
service.store.set('task:'+task.id,{...task,state:'review',checkpoint:{runId},responseTiming:{runId,state:'completed',durationMs:1234,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString()},workPlan:{runId,steps:[{text:'원본 확인',status:'completed',expected_outcome:'원문 확인'}]},trace:[{id:runId+':0:0',runId,tool:'read_source',status:'done',label:'소스 읽기',at:Date.now()}],messages:[{role:'assistant',runId,content:'원본에서 내용을 확인했어요.',sourceReferences:[{citationId:'source-one',number:1,kind:'source',path:'notes.md',title:'notes.md',hash:hash(await readFile(path.join(a,'notes.md'))),start:2,end:2}],consultedSources:[{citationId:'consulted-wiki',kind:'wiki',path:'openwiki/home.md',title:'참고한 위키',hash:hash(await readFile(path.join(a,'openwiki/home.md'))),start:1,end:1}]}]});
service.dispose();service.store.close();await rm(path.join(b,'openwiki'),{recursive:true});await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root:a}));
const checks=[],errors=[];let app,page;
async function launch(){app=await electron.launch({executablePath:process.env.NUBI_TEST_EXECUTABLE||require('electron'),args:process.env.NUBI_TEST_EXECUTABLE?[]:[process.env.NUBI_TEST_APP||'electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}});page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.locator('.desktop-shell[data-startup-ready="true"]').waitFor({timeout:60000});if(await page.getByText('메일을 연결해 주세요').count())await page.keyboard.press('Escape');await page.locator('.nubi-sidebar-project').first().waitFor({timeout:60000});}
const row=name=>page.locator('.nubi-saved-project').filter({has:page.locator('.nubi-sidebar-project-name',{hasText:name})});
try {
 await launch();
 await page.getByRole('button',{name:task.request,exact:true}).click();
 await page.getByRole('textbox',{name:'추가 요청',exact:true}).fill('A 프로젝트에 남겨 둔 초안');
 await app.evaluate(({dialog},root)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root]});},b);
 await page.getByRole('button',{name:'프로젝트 추가',exact:true}).click();
 await page.getByRole('button',{name:/폴더 열기/}).click();
 await page.waitForFunction(()=>document.querySelector('.nubi-saved-project[data-current="true"] .nubi-sidebar-project-name')?.textContent==='project-b');
 assert.equal(await page.locator('.nubi-project-start').count(),0,'opened project without Wiki never returns to setup');
 await page.evaluate(()=>{window.switchScreens=[];window.switchObserver=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes){if(node.nodeType!==1)continue;if(node.matches('.nubi-project-start')||node.querySelector('.nubi-project-start'))window.switchScreens.push('connection');}});window.switchObserver.observe(document.querySelector('.desktop-shell'),{childList:true,subtree:true});});
 for(let attempt=0;attempt<3;attempt++){
  await row('project-a').locator('.nubi-sidebar-project').click();
  await page.getByRole('textbox',{name:'추가 요청',exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'추가 요청',exact:true}).inputValue(),'A 프로젝트에 남겨 둔 초안');
  await page.locator('.nubi-cited-sources .nubi-answer-source').waitFor();
  assert.equal(await row('project-a').getAttribute('data-current'),'true');
  if(attempt<2){await row('project-b').locator('.nubi-sidebar-project').click();await page.waitForFunction(()=>document.querySelector('.nubi-saved-project[data-current="true"] .nubi-sidebar-project-name')?.textContent==='project-b');assert.equal(await page.locator('.nubi-project-start').count(),0);}
 }
 assert.deepEqual(await page.evaluate(()=>{window.switchObserver.disconnect();return window.switchScreens;}),[]);
 checks.push('three single-click round trips restore the selected conversation and draft without a connection screen');
 checks.push('an opened project without Wiki does not enter folder/Git setup');
 await rm(b,{recursive:true});await row('project-b').locator('.nubi-sidebar-project').click();
 await page.locator('.nubi-feedback-toast').waitFor();assert.equal(await row('project-a').getAttribute('data-current'),'true');assert.equal(await page.getByRole('textbox',{name:'추가 요청',exact:true}).inputValue(),'A 프로젝트에 남겨 둔 초안');
 checks.push('failed project opening retains the current conversation and draft');
 assert.deepEqual(errors,[]);
 await mkdir('verification',{recursive:true});await page.screenshot({path:'verification/project-direct-navigation.png'});await writeFile('verification/project-direct-navigation.json',JSON.stringify({checks,errors,platform:process.platform,boundary:'Isolated local Electron and saved response. No Windows or live model verification.'},null,2));console.log(JSON.stringify({checks,errors}));
} finally {await app?.close();await rm(temporary,{recursive:true,force:true});}
