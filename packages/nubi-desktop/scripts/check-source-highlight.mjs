import {desktopTestWindow} from './electron-test-window.mjs';
// Native Electron with isolated folders and a saved answer, no external model.
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import {ProjectService} from '../runtime/project-service.mjs';
import {hash} from '../runtime/files.mjs';
const require=createRequire(import.meta.url),temporary=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-projects-check-'))),storage=path.join(temporary,'state'),a=path.join(temporary,'project-a'),b=path.join(temporary,'project-b');
for(const root of [a,b]){await mkdir(path.join(root,'openwiki'),{recursive:true});await writeFile(path.join(root,'openwiki/home.md'),'# Project wiki\n');await writeFile(path.join(root,'notes.md'),root===a?'# Project A\nOriginal evidence.\nSecond cited line.\n':'# Project B\nDifferent evidence.\n');}
const service=new ProjectService({storageRoot:storage});const overview=await service.open(a,{initializeWiki:false});const task=await service.createTask({request:'원본 출처와 프로젝트 관리 확인'}),runId='8c33a908-b6f0-4712-b126-2314458135f3';
service.store.set('task:'+task.id,{...task,state:'review',checkpoint:{runId},responseTiming:{runId,state:'completed',durationMs:1234,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString()},workPlan:{runId,steps:[{text:'원본 확인',status:'completed',expected_outcome:'원문 확인'}]},trace:[{id:runId+':0:0',runId,tool:'read_source',status:'done',label:'소스 읽기',at:Date.now()}],messages:[{role:'assistant',runId,content:'원본에서 내용을 확인했어요.',sourceReferences:[{citationId:'source-one',number:1,kind:'source',path:'notes.md',title:'notes.md',hash:hash(await readFile(path.join(a,'notes.md'))),start:2,end:3}],consultedSources:[{citationId:'consulted-wiki',kind:'wiki',path:'openwiki/home.md',title:'참고한 위키',hash:hash(await readFile(path.join(a,'openwiki/home.md'))),start:1,end:1}]}]});
service.dispose();service.store.close();await rm(path.join(b,'openwiki'),{recursive:true});await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root:a}));
const checks=[],errors=[];let app,page;
async function launch(){app=await electron.launch({executablePath:process.env.NUBI_TEST_EXECUTABLE||require('electron'),args:process.env.NUBI_TEST_EXECUTABLE?[]:[process.env.NUBI_TEST_APP||'electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}});page=await desktopTestWindow(app);page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.locator('.desktop-shell[data-startup-ready="true"]').waitFor({timeout:60000});if(await page.getByText('메일을 연결해 주세요').count())await page.keyboard.press('Escape');await page.locator('.nubi-sidebar-project').first().waitFor({timeout:60000});}
const row=name=>page.locator('.nubi-saved-project').filter({has:page.locator('.nubi-sidebar-project-name',{hasText:name})});
try {
 await launch();await page.getByRole('button',{name:task.request,exact:true}).click();
 assert.equal(await page.locator('.nubi-cited-disclosure').getAttribute('open'),null);await page.getByText('원문 출처',{exact:true}).click();
 assert.equal(await page.locator('.nubi-cited-sources .nubi-file-kind').textContent(),'MD');
 await page.locator('.nubi-cited-sources .nubi-answer-source').click();
 await page.waitForFunction(()=>document.querySelectorAll('.desktop-editor .nubi-source-highlight').length===2);
 assert.equal(await page.locator('.desktop-editor .nubi-source-line-number').allTextContents().then(x=>x.join(',')),'2,3');
 await mkdir('verification',{recursive:true});await page.screenshot({path:'verification/source-highlight.png'});
 if(await page.locator('.desktop-shell').getAttribute('data-layout')==='overlay')await page.getByRole('button',{name:'오른쪽 사이드바 닫기',exact:true}).click();
 await page.getByText('참고 자료 1개',{exact:true}).click();await page.locator('.nubi-consulted-sources .nubi-answer-source').click();
 await page.waitForFunction(()=>document.querySelectorAll('.desktop-editor .nubi-source-highlight').length===1);
 assert.equal(await page.locator('.desktop-editor .nubi-source-line-number').textContent(),'1');
 if(await page.locator('.desktop-shell').getAttribute('data-layout')==='overlay')await page.getByRole('button',{name:'오른쪽 사이드바 닫기',exact:true}).click();
 await page.locator('.nubi-cited-sources .nubi-answer-source').click();await page.waitForFunction(()=>document.querySelectorAll('.desktop-editor .nubi-source-highlight').length===2);
 await page.locator('.desktop-editor .inputarea').focus();await page.keyboard.type('changed');await page.waitForFunction(()=>!document.querySelector('.desktop-editor .nubi-source-highlight'));
 assert.deepEqual(errors,[]);console.log(JSON.stringify({checks:['cited lines 2–3 highlighted and scrolled into view','Wiki source switches highlight to line 1','reopening restores the citation range','editing clears stale citation highlight','Markdown citation uses MD file icon'],errors}));
}finally{await app?.close();await rm(temporary,{recursive:true,force:true});}
