import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {desktopTestWindow,killProcessTree} from './electron-test-window.mjs';
import {startFixtureModel} from './fixture-model.mjs';
import {captureDesign} from './design-rules.mjs';

const temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-opencode-shell-')),root=path.join(temporary,'project'),storage=path.join(temporary,'state'),out=path.resolve('verification/opencode-coding-shell-2026-10-23');
for(const directory of [root,storage,out])await mkdir(directory,{recursive:true});
await mkdir(path.join(root,'openwiki'));await writeFile(path.join(root,'openwiki/home.md'),'# Local fixture\n');
const original='export function value() {\r\n    return 1;\r\n}\r\n';await writeFile(path.join(root,'app.ts'),original);await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
const fixture=await startFixtureModel({respond:({results,text,call})=>{
 const source=results.findLast(result=>result?.path==='app.ts'&&result.hash&&typeof result.content==='string');
 if(!source)return call('read_source',{path:'app.ts'});
 if(source.content.includes('return 2;'))return text('반영한 코드에서 반환값 2를 확인했습니다. 실행 검사는 아직 하지 않았습니다.');
 if(!results.some(result=>result?.id&&result.targets))return call('record_change_plan',{summary:'Change the observed return value',requirements:[{id:'R1',text:'Return two'}],targets:[{path:'app.ts',reason:'Observed return value is one',requirementIds:['R1']}],checks:[{requirementId:'R1',method:'inspection',description:'Inspect the applied source'}],assumptions:[]});
 if(!results.some(result=>result?.path==='app.ts'&&result.quality))return call('propose_edit',{path:'app.ts',expectedHash:source.hash,content:'export function value() {\n    return 2;\n}\n',reason:'Return two after review'});
 return text('반환값을 2로 바꾸는 변경안을 준비했습니다. 반영 전에 내용을 확인해 주세요.');
}});
let app,page,child;const errors=[],checks=[];
const request=(method,args={})=>page.evaluate(({method,args})=>window.nubi.request(method,args),{method,args});
try{
 app=await _electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,OPENWIKI_CONFIG_DIR:path.join(temporary,'wiki-state'),ELECTRON_RUN_AS_NODE:undefined}});child=app.process();page=await desktopTestWindow(app);page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
 const resize=async width=>{await (await app.browserWindow(page)).evaluate((win,width)=>{win.setMinimumSize(1,1);win.setContentSize(width,900);},width);await page.setViewportSize({width,height:900});};await resize(1280);
 await page.locator('.desktop-shell[data-startup-ready=true]').waitFor({timeout:60000});await page.locator('.nubi-intro').waitFor({state:'detached'});await request('provider',{action:'connect',input:fixture.connection});
 const task=await request('createTask',{request:'코드의 반환값을 2로 바꾸는 변경안을 준비해 주세요.'});
 const reveal=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await reveal.count())await reveal.click();await page.locator('.nubi-session-select').filter({hasText:'코드의 반환값을 2로 바꾸는 변경안을 준비해 주세요.'}).click();
 await request('startAgent',{taskId:task.id});
 const active=page.locator('[data-decision-panel]:not([hidden])');await active.getByRole('button',{name:'반영',exact:true}).waitFor({timeout:45000});
 const state=await request('state',{taskId:task.id}),current=state.tasks.find(item=>item.id===task.id);
 assert.equal(current.executionEngine.id,'opencode');assert.equal(current.executionEngine.version,'1.19.4');assert(current.executionEngine.sessionId);assert.equal(await readFile(path.join(root,'app.ts'),'utf8'),original);
 const proposal=state.proposals.find(item=>item.taskId===task.id);assert.equal(proposal.content,'export function value() {\r\n    return 2;\r\n}\r\n');checks.push('actual built renderer and worker use the bundled original OpenCode before host approval');
 const record=page.locator('.nubi-activity-record').last();if(!await record.evaluate(node=>node.open))await record.locator(':scope>summary').click();
 for(const summary of await record.locator('.agent-trace>summary').all())await summary.click();
 await record.locator('li[data-tool=read_source] .agent-step-status>svg[data-icon=file]').first().waitFor();
 assert(await record.locator('.agent-trace>summary>svg[data-icon-set=lucide]').count()>0);
 checks.push('actual OpenCode host tool records display semantic leading icons before applying the change');
 const dismiss=page.locator('.nubi-feedback-toast').getByRole('button',{name:'알림 닫기',exact:true});if(await dismiss.count())await dismiss.click();await captureDesign(page,{path:out+'/proposal-1280.png'});await resize(440);await captureDesign(page,{path:out+'/proposal-440.png'});
 await active.getByRole('button',{name:'반영',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-decision-panel]:not([hidden]) .nubi-proposal-card'));
 await new Promise((resolve,reject)=>{const deadline=Date.now()+10000;const poll=async()=>{if((await readFile(path.join(root,'app.ts'),'utf8')).includes('return 2;'))resolve();else if(Date.now()>deadline)reject(Error('apply_timeout'));else setTimeout(poll,50);};void poll();});
 checks.push('explicit apply writes the approved CRLF draft and removes the pending form');
 const composer=page.locator('.nubi-followup-stack textarea');await composer.fill('이어지는 요청 초안');assert.equal(await composer.inputValue(),'이어지는 요청 초안');
 await request('stopAgent',{taskId:task.id});await page.locator('.nubi-project-switch-cover').waitFor({state:'hidden'});await captureDesign(page,{path:out+'/applied-440.png'});assert.deepEqual(errors,[]);
 await writeFile(out+'/report.json',JSON.stringify({checks,executionEngine:current.executionEngine,errors,scope:'Built macOS Electron renderer -> IPC -> service worker -> original bundled OpenCode 1.19.4 -> authenticated loopback model fixture and host tools; explicit UI approval and real temporary source write. No real model or Windows proof.'},null,2));console.log(JSON.stringify({checks,errors}));
}catch(error){await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure-state.json',JSON.stringify({state:await request('state').catch(()=>null),fixtureCalls:fixture.calls},null,2));await writeFile(out+'/failure.txt',String(error.stack)+'\n'+JSON.stringify(errors)+'\n'+await page?.locator('body').innerText());throw error;}
finally{await app?.close().catch(()=>{});killProcessTree(child);fixture.close();await rm(temporary,{recursive:true,force:true,maxRetries:3});}
