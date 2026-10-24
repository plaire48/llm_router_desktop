// Actual macOS/Electron presentation and manual capture. The external app/UIA
// responses and model are synthetic; never count this as Windows acceptance.
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {AppScreenCapture} from '../runtime/app-screen-capture.mjs';
import {fixturePlan,fixtureReview} from '../tests/fixtures.mjs';
import {desktopTestWindow,killProcessTree} from './electron-test-window.mjs';
import {startFixtureModel} from './fixture-model.mjs';
import {captureDesign} from './design-rules.mjs';
installAgent(ProjectService);
const require=createRequire(import.meta.url),temp=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-app-capture-'))),storage=path.join(temp,'state'),root=path.join(temp,'project'),out=path.resolve(process.env.NUBI_CAPTURE_OUTPUT||'verification/app-screen-capture-2026-10-23/electron');
await mkdir(path.join(root,'openwiki'),{recursive:true});await writeFile(path.join(root,'openwiki/home.md'),'# Local capture fixture');await mkdir(out,{recursive:true});
const png=new PNG({width:400,height:200});
for(let y=0;y<200;y++)for(let x=0;x<400;x++){const i=(y*400+x)*4;png.data[i]=y<50?49:241;png.data[i+1]=y<50?130:247;png.data[i+2]=y<50?246:254;png.data[i+3]=255;}
const image=PNG.sync.write(png).toString('base64'),binding={hwnd:123,processId:456,started:'123456789',title:'합성 검토 화면',processName:'CaptureFixture',bounds:{x:0,y:0,width:400,height:200}};
const service=new ProjectService({storageRoot:storage}),initial=await service.open(root,{initializeWiki:false});
service.createAppScreenCapture=()=>new AppScreenCapture({platform:'win32',read:async request=>request.action==='discover'?{windows:[binding]}:{window:binding,image,width:400,height:200,passwordsMasked:false}});
let turn=0;
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
service.providers={status:()=>({connected:true,provider:'chatgpt',model:'fixture',models:[{id:'fixture',supportsImages:true,contextLength:32000,maxOutputTokens:4096}]}),dispose(){},async complete(messages){
 const scripted=fixturePlan(messages)||fixtureReview(messages);if(scripted)return scripted;
 if(messages.some(m=>Array.isArray(m.content)))return {content:'파란 제목 영역과 옅은 본문 영역의 합성 화면입니다.',calls:[]};
 if(turn++===0)return call('find_app_capture_targets',{windowQuery:'CaptureFixture'});
 if(turn===2){const result=JSON.parse(messages.filter(m=>m.role==='tool').at(-1).content);return call('inspect_app_window',{windowId:result.windows[0].windowId,question:'합성 화면을 확인해 주세요'});}
 return {content:'합성 검토 화면을 캡처해 확인했습니다.',calls:[]};
}};
const task=await service.createTask({request:'자동 캡처와 직접 캡처 검토'});await service.startAgent({taskId:task.id});await service.agent.promise;
const saved=service.task(task.id),reference=saved.messages.at(-1).captures[0];assert(reference);
const attachedTask=await service.createTask({request:'첨부한 캡처를 확인해 주세요.',captures:[{image,width:400,height:200}]});await service.startAgent({taskId:attachedTask.id});await service.agent.promise;
service.dispose();service.store.close();await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
const {ProjectCatalog}=require('../electron-app/project-catalog.cjs');await new ProjectCatalog(storage).remember(initial);
const model=await startFixtureModel({respond:({text})=>text('UI fixture only')});let app,page;const errors=[],checks=[],geometry=[];
async function openTask(target=task){const opener=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.isVisible())await opener.click();await page.getByRole('button',{name:target.request,exact:true}).click();await page.getByRole('textbox',{name:'추가 요청',exact:true}).waitFor();}
async function checkLayout(scene){
 const rows=await page.locator('.message .nubi-capture-record').evaluateAll(records=>records.map(record=>{
  const summary=record.querySelector('summary'),label=summary.querySelector('strong'),icon=summary.querySelector('svg'),body=record.closest('.message').querySelector('.message-body'),bubble=record.closest('.nubi-user-bubble');
  const rect=node=>node.getBoundingClientRect().toJSON(),style=getComputedStyle(label),bodyStyle=getComputedStyle(body);
  return {summary:rect(summary),icon:rect(icon),bubble:bubble&&rect(bubble),size:style.fontSize,leading:style.lineHeight,bodySize:bodyStyle.fontSize,bodyLeading:bodyStyle.lineHeight,overflow:record.scrollWidth>record.clientWidth+1};
 }));
 assert(rows.length>0);for(const row of rows){assert.equal(row.size,row.bodySize);assert.equal(row.leading,row.bodyLeading);assert(!row.overflow);assert(row.icon.x>=row.summary.x-1&&row.icon.right<=row.summary.right+1);if(row.bubble)assert(row.icon.x>=row.bubble.x&&row.summary.right<=row.bubble.right);}
 geometry.push({scene,rows});await captureDesign(page,{path:path.join(out,scene+'.png')});
}
try{
 app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,OPENWIKI_CONFIG_DIR:path.join(temp,'wiki-state'),ELECTRON_RUN_AS_NODE:undefined}});
 page=await desktopTestWindow(app);page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));await (await app.browserWindow(page)).evaluate(win=>{win.setIgnoreMouseEvents(true);win.setMinimumSize(360,600);win.setContentSize(1280,900);});
 await page.locator('.desktop-shell[data-startup-ready=true]').waitFor({timeout:60000});await page.locator('.nubi-intro').waitFor({state:'detached'});
 await page.evaluate(connection=>window.nubi.request('provider',{action:'connect',input:connection}),model.connection);
 for(const width of [1280,440]){
  await (await app.browserWindow(page)).evaluate((win,width)=>win.setContentSize(width,900),width);await page.waitForFunction(width=>innerWidth===width,width);
  await openTask(attachedTask);await checkLayout('user-bubble-'+width);
  if(width===440){const field=page.getByRole('textbox',{name:'추가 요청',exact:true});await field.fill('확대 뒤에도 보존할 초안');await page.evaluate(()=>document.documentElement.style.fontSize='200%');await checkLayout('user-bubble-large-text');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.evaluate(()=>document.documentElement.style.fontSize='');assert.equal(await field.inputValue(),'확대 뒤에도 보존할 초안');}
  await openTask();await checkLayout('answer-capture-'+width);
 }
 checks.push('user bubble and assistant capture share message scale at 1280/440px and 200% text, with contained icon hit targets and preserved draft');
 await (await app.browserWindow(page)).evaluate(win=>win.setContentSize(1280,900));await page.waitForFunction(()=>innerWidth===1280);
 const answer=page.locator('.message-assistant').filter({hasText:'합성 검토 화면을 캡처해 확인했습니다.'}),fold=answer.locator('.nubi-capture-record');await fold.locator('summary').click();
 const thumb=answer.getByRole('button',{name:'앱 화면 캡처: 합성 검토 화면 크게 보기',exact:true});await thumb.waitFor();await thumb.scrollIntoViewIfNeeded();
 assert.equal(await thumb.locator('img').getAttribute('src'),'data:image/png;base64,'+image);await captureDesign(page,{path:path.join(out,'automatic-capture.png')});checks.push('automatic capture uses exact stored PNG on the actual conversation');
 await thumb.click();const modal=page.getByRole('dialog');await modal.locator('img').waitFor();assert.equal(await modal.locator('img').getAttribute('src'),'data:image/png;base64,'+image);await captureDesign(page,{path:path.join(out,'automatic-preview.png')});await page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});checks.push('common image preview opens and closes to the conversation');
 const input=page.getByRole('textbox',{name:'추가 요청',exact:true});await input.fill('유지할 직접 캡처 요청');await page.getByRole('button',{name:'화면 캡처',exact:true}).click();await page.getByRole('dialog',{name:'캡처할 영역 선택',exact:true}).waitFor();await page.keyboard.press('Escape');assert.equal(await input.inputValue(),'유지할 직접 캡처 요청');checks.push('manual capture can be cancelled without losing the draft');
 await page.getByRole('button',{name:'화면 캡처',exact:true}).click();await page.getByRole('dialog',{name:'캡처할 영역 선택',exact:true}).waitFor();await page.getByAltText('캡처할 Workspace 화면').waitFor();
 await page.mouse.move(150,200);await page.mouse.down();await page.mouse.move(550,400,{steps:5});await page.mouse.up();await page.getByRole('dialog',{name:'캡처할 영역 선택',exact:true}).waitFor({state:'hidden'});await page.locator('[aria-label="첨부한 화면 캡처"] .nubi-capture-thumb img').waitFor();assert.equal(await input.inputValue(),'유지할 직접 캡처 요청');await captureDesign(page,{path:path.join(out,'manual-and-automatic.png')});checks.push('manual region capture stays available beside the previous automatic capture');
 await (await app.browserWindow(page)).evaluate(win=>win.setContentSize(700,900));await page.waitForFunction(()=>innerWidth===700);await captureDesign(page,{path:path.join(out,'narrow.png')});checks.push('700px actual Electron presentation');
 await page.reload();await page.locator('.desktop-shell[data-startup-ready=true]').waitFor({timeout:60000});await openTask();await page.locator('.message-assistant .nubi-capture-record>summary').click();await page.getByRole('button',{name:'앱 화면 캡처: 합성 검토 화면 크게 보기',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'앱 화면 캡처: 합성 검토 화면 크게 보기',exact:true}).locator('img').getAttribute('src'),'data:image/png;base64,'+image);checks.push('automatic capture reference survives renderer reload');
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'result.json'),JSON.stringify({checks,geometry,errors,modelRequests:model.requests.length,captureId:reference.id,scope:'Actual macOS Electron and manual capture, synthetic external-window/UIA responses and model. Windows native UIA/PrintWindow and live model are not verified.'},null,2));console.log('PASS',JSON.stringify(checks));
}catch(error){await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}
finally{const child=app?.process();if(app)await Promise.race([app.close().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,8000))]);killProcessTree(child);model.close();await rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:250});}
