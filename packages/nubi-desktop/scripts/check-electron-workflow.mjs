import {seedRoutineScenes,checkRoutineScenes} from './workflow-routine-scenes.mjs';
import {captureDesign} from './design-rules.mjs';
// Actual desktop host + scripted loopback model + synthetic package only.
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {cp,mkdir,mkdtemp,readFile,writeFile,rm,realpath,access} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import {parse,stringify} from 'yaml';
import {startFixtureModel} from './fixture-model.mjs';
import {killProcessTree,desktopTestWindow} from './electron-test-window.mjs';
import {hash} from '../runtime/files.mjs';
const tag=process.env.WORKFLOW_TAG||'after';assert.match(tag,/^[a-z0-9-]+$/);
const require=createRequire(import.meta.url),dir=path.resolve('verification/workflow-pilot/'+tag);await mkdir(dir,{recursive:true});
const content=await readFile('tests/workflow-pilot-expected.md','utf8'),checks=[],errors=[];let app,page,temporary,activeStorage,draftTurns=0,reportTurns=0;
const fixture=await startFixtureModel({respond({messages,results,call}){
 const evidence=results.flatMap(r=>r.workflowEvidence||[]).map(r=>r.id);
 if(messages.some(m=>m.role==='user'&&String(m.content).includes('티켓 원문은'))){
  switch(draftTurns++){
   case 0:return call('wiki_query',{query:'합성 변경 절차'});
   case 1:return call('read_source',{path:'openwiki/pilot-change-policy.md'});
   case 2:return call('inspect_path',{path:'out/change-request.md'});
   case 3:return call('record_change_plan',{summary:'합성 정의서 작성',requirements:[{id:'R1',text:'합성 정의서 작성'}],targets:[{path:'out/change-request.md',action:'create',reason:'합성 요청',requirementIds:['R1']}],checks:[{requirementId:'R1',method:'inspection',description:'원문과 파일 대조'}],assumptions:[]});
   case 4:return call('propose_new_file',{path:'out/change-request.md',content,reason:'합성 요청'});
   default:return call('submit_step_output',{output:{summary:'합성 정의서 작성',evidence}});
  }
 }
 if(reportTurns++===0)return call('read_source',{path:'out/change-request.md'});
 return call('submit_step_output',{output:{summary:'로컬 작성만 완료했습니다. 실제 JSM은 미검증입니다.',evidence}});
}});
const request=async(method,args={})=>{const result=await page.evaluate(({method,args})=>window.nubi.request(method,args),{method,args});assert.equal(result?.__nubiError,undefined,JSON.stringify(result));return result;};
async function launch(storage,width){
 activeStorage=storage;
 app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined},timeout:30000});page=await desktopTestWindow(app);page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));await page.locator('.desktop-shell[data-startup-ready="true"]').waitFor();await page.waitForFunction(()=>!document.querySelector('.nubi-intro')&&!document.querySelector('.desktop-shell')?.inert);
 await (await app.browserWindow(page)).evaluate((win,width)=>win.setContentSize(width,900),width);await page.setViewportSize({width,height:900});const startup=page.getByText('메일을 연결해 주세요',{exact:true});if(await startup.count())await page.keyboard.press('Escape');await page.locator('.nubi-workbench').waitFor({timeout:30000});await request('provider',{action:'connect',input:fixture.connection});const warning=page.locator('.nubi-feedback-toast[data-error="true"]');if(await warning.count())await warning.getByRole('button',{name:'알림 닫기',exact:true}).click();
}
async function openCatalog(){const collapse=page.getByRole('button',{name:'사이드바 접기',exact:true});if(await collapse.count())await collapse.click();await page.getByRole('button',{name:'워크플로우',exact:true}).click();await page.getByRole('button',{name:'합성 변경 요청 정의서 작성',exact:true}).waitFor();}
async function poll(observe,ready,timeout=30000){const deadline=Date.now()+timeout;let last;do{last=await observe();if(ready(last))return last;await delay(50);}while(Date.now()<deadline);assert.fail('workflow poll timed out: '+JSON.stringify(last));}
async function waitRun(runId,stepId,phase){return poll(()=>request('workflowRun',{runId}),view=>view.run.cursor===stepId&&view.run.status==='waiting'&&(!phase||view.task?.question?.workflow?.phase===phase));}

async function approve(runId,stepId,phase='supervision',label='진행'){
 await waitRun(runId,stepId,phase);const question=page.locator(`[data-step-id="${stepId}"]`).getByRole('region',{name:'답변이 필요한 질문',exact:true});await question.waitFor();await question.locator('.question-option').filter({hasText:label}).click();await question.getByRole('button',{name:/답변 보내기|^보내기$/}).click();
}
// Electron's helper processes can still hold their data files (state/app/DIPS) for a moment after close on Windows;
// rm retries busy files (Windows gates 2026-10-21).
async function close(){if(app){const instance=app;app=null;await instance.close();}}
try{
 for(const width of [1280,440]){
  draftTurns=0;reportTurns=0;temporary=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-workflow-pilot-')));const root=path.join(temporary,'project'),storage=path.join(temporary,'state');await cp('tests/workflow-fixture-project',root,{recursive:true});await mkdir(storage);await mkdir(path.join(root,'out'));await writeFile(path.join(root,'openwiki/home.md'),'# 합성 시범\n\n[pilot-change-policy](pilot-change-policy.md)\n');
  const stopDir=path.join(root,'.nubi/workflows/stop-pilot');await cp(path.join(root,'.nubi/workflows/change-request-definition'),stopDir,{recursive:true});const definition=parse(await readFile(path.join(stopDir,'workflow.yaml'),'utf8'));definition.name='합성 중단 확인';await writeFile(path.join(stopDir,'workflow.yaml'),stringify(definition));
  await seedRoutineScenes(root,storage);
  const git=args=>execFileSync('git',['-C',root,...args],{stdio:'ignore'});git(['init','-q']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.invalid']);git(['add','.']);git(['commit','-qm','Synthetic workflow pilot']);await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
  await launch(storage,width);await openCatalog();await checkRoutineScenes({page,request,width,dir,checks});if(process.env.WORKFLOW_ROUTINES_ONLY==='1'){await close();await rm(temporary,{recursive:true,force:true,maxRetries:20,retryDelay:250});temporary=null;continue;}await page.getByRole('button',{name:'합성 변경 요청 정의서 작성',exact:true}).click();await page.getByRole('button',{name:'검증',exact:true}).click();await page.getByText('합성 검증 통과',{exact:true}).waitFor();await assert.rejects(access(path.join(root,'out/change-request.md')));assert.equal((await request('state')).proposals.length,0);checks.push({width,scene:'dry-run',effects:0});
  await page.getByRole('button',{name:'실행',exact:true}).click();await page.getByRole('dialog',{name:'워크플로우 실행',exact:true}).getByRole('button',{name:'실행',exact:true}).click();await page.locator('.nubi-workflow-run').waitFor();
  const row=(await request('listWorkflows')).find(r=>r.slug==='change-request-definition');const runId=row.lastRun.id;await approve(runId,'read-ticket');await approve(runId,'draft');
  const card=page.getByRole('article',{name:'change-request.md 변경 제안',exact:true});await card.waitFor({timeout:60000});await assert.rejects(access(path.join(root,'out/change-request.md')));await captureDesign(page,{path:path.join(dir,`proposal-${width}.png`)});await card.getByRole('button',{name:'반영',exact:true}).click();
  const waiting=await waitRun(runId,'approve','human');assert.equal(await readFile(path.join(root,'out/change-request.md'),'utf8'),content);assert.equal((await request('state',{taskId:waiting.task.id})).proposals.filter(p=>p.state==='applied').length,1);const receipt=structuredClone(waiting.run.steps.draft.receipts),readFinished=waiting.run.steps['read-ticket'].finishedAt;await page.locator('[data-step-id="approve"]').getByRole('region',{name:'답변이 필요한 질문'}).waitFor();
  if(width===440)assert.equal(await page.locator('.nubi-workflow-minimap-body').getAttribute('hidden'),'');await page.locator('[data-step-id="approve"]').getByRole('region',{name:'답변이 필요한 질문'}).scrollIntoViewIfNeeded();const geometry=await page.locator('[data-step-id="approve"]').getByRole('region',{name:'답변이 필요한 질문'}).evaluate(el=>{const rect=x=>{const r=x.getBoundingClientRect(),s=getComputedStyle(x);return {left:r.left,right:r.right,width:r.width,boxSizing:s.boxSizing,minWidth:s.minWidth,padding:s.padding};};return {card:rect(el),column:rect(el.closest('.nubi-workflow-stage')),decision:rect(el.parentElement)};});await writeFile(path.join(dir,`question-geometry-${width}.json`),JSON.stringify(geometry,null,2));assert.ok(geometry.card.right<=geometry.column.right+1,JSON.stringify(geometry));await captureDesign(page,{path:path.join(dir,`waiting-${width}.png`)});checks.push({width,scene:'approved-once',receipts:receipt.length});
  // Kill the owned fixture host at a durable human checkpoint, never replay a write.
  const nativeProcess=app.process();const exited=new Promise(resolve=>nativeProcess.once('exit',resolve));killProcessTree(nativeProcess);await exited;app=null;await launch(storage,width);const restored=await waitRun(runId,'approve','human');assert.equal(restored.task.id,waiting.task.id);assert.equal(restored.task.question.id,waiting.task.question.id);assert.deepEqual(restored.run.steps.draft.receipts,receipt);assert.equal(restored.run.steps['read-ticket'].finishedAt,readFinished);assert.equal(hash(await readFile(path.join(root,'out/change-request.md'))),hash(content));
  await openCatalog();const item=page.getByRole('button',{name:'합성 변경 요청 정의서 작성',exact:true}).locator('xpath=ancestor::div[contains(@class,"nubi-session-row")]');await item.getByRole('button',{name:'최근 실행',exact:true}).click();await page.locator('[data-step-id="approve"]').waitFor();checks.push({width,scene:'same-checkpoint-after-kill'});
  if(width===440)await page.getByRole('button',{name:'단계 지도 펼치기',exact:true}).click();await page.getByRole('complementary',{name:'단계 지도',exact:true}).getByRole('button',{name:'정의서 작성',exact:true}).click();await page.locator('[data-step-id="draft"][aria-current="step"]').waitFor();
  await approve(runId,'approve','human');await approve(runId,'verify');await approve(runId,'report');await poll(()=>request('workflowRun',{runId}),view=>view.run.status==='complete',60000);const completed=await request('workflowRun',{runId});assert.notEqual(completed.run.steps.draft.taskId,completed.run.steps.report.taskId);assert.ok(completed.run.steps.verify.receipts.length>0);assert.equal((await request('read',{taskId:completed.task.id,path:'out/change-request.md'})).hash,hash(content));assert.equal(Object.values(completed.run.steps).filter(s=>s.status==='complete').length,5);await page.getByRole('article',{name:'실행 보고서',exact:true}).waitFor();await page.getByRole('article',{name:'실행 보고서',exact:true}).scrollIntoViewIfNeeded();await captureDesign(page,{path:path.join(dir,`complete-${width}.png`)});checks.push({width,scene:'complete-report-and-hash'});
  const beforeStop=fixture.calls.length;await openCatalog();await page.getByRole('button',{name:'합성 중단 확인',exact:true}).click();await page.getByRole('button',{name:'실행',exact:true}).click();await page.getByRole('dialog',{name:'워크플로우 실행',exact:true}).getByRole('button',{name:'실행',exact:true}).click();await poll(()=>request('listWorkflows'),rows=>rows.find(r=>r.slug==='stop-pilot')?.lastRun?.mode==='execute');const stopId=(await request('listWorkflows')).find(r=>r.slug==='stop-pilot').lastRun.id;await approve(stopId,'read-ticket','supervision','중단');await poll(()=>request('workflowRun',{runId:stopId}),view=>view.run.status==='partial');assert.equal(fixture.calls.length,beforeStop);assert.equal(hash(await readFile(path.join(root,'out/change-request.md'))),hash(content));checks.push({width,scene:'stop-before-model-or-effect'});
  await close();await rm(temporary,{recursive:true,force:true,maxRetries:20,retryDelay:250});temporary=null;
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({checks,errors,modelRequests:fixture.requests,boundary:'Actual local Electron host, synthetic package and scripted loopback provider. No real model quality, company JSM, SSO, Windows or Office claims.'},null,2));console.log('PASS: workflow pilot',JSON.stringify(checks));
}catch(error){await page?.screenshot({path:path.join(dir,'failure.png')}).catch(()=>{});await writeFile(path.join(dir,'failure.json'),JSON.stringify({message:error.message,checks,errors,calls:fixture.calls,requests:fixture.requests,savedProject:await readFile(path.join(activeStorage,'last-project.json'),'utf8').catch(()=>null),restore:await readFile(path.join(activeStorage,'last-project-restore.json'),'utf8').catch(()=>null),workerLog:(await readFile(path.join(activeStorage,'worker.log'),'utf8').catch(()=>'')).slice(-6000).replaceAll(fixture.token,'[redacted]').replace(/Bearer\s+\S+/g,'Bearer [redacted]')},null,2));throw error;}
finally{await close().catch(()=>{});fixture.close();if(temporary)await rm(temporary,{recursive:true,force:true,maxRetries:20,retryDelay:250});}
