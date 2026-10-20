import {captureDesign} from './design-rules.mjs';
// Built Electron main -> service IPC -> actual PTY/HTTP/compiler worker.
// Uses an isolated project and an explicit test approval, with no model/login.
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod,symlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {ProjectService} from '../runtime/project-service.mjs';
import {prepareSetupAction} from '../runtime/setup-actions.mjs';
import {desktopTestWindow} from './electron-test-window.mjs';

const require=createRequire(import.meta.url),temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-development-electron-'));
const root=path.join(temporary,'project'),storage=path.join(temporary,'state'),evidence=path.resolve('verification/development-execution-2026-10-16/electron');
await mkdir(root);await mkdir(storage);await mkdir(evidence,{recursive:true});
const git=args=>execFileSync('git',['-C',root,...args],{stdio:'ignore'});
git(['init','-q']);git(['config','user.email','fixture@example.invalid']);git(['config','user.name','Fixture']);
await mkdir(path.join(root,'openwiki'));await writeFile(path.join(root,'openwiki','home.md'),'# Development fixture\n');
await writeFile(path.join(root,'serve.cjs'),`#!/usr/bin/env node\nconsole.log('TTY:'+process.stdin.isTTY);const server=require('node:http').createServer((request,response)=>response.end('<title>Nubi actual preview</title><h1>Ready</h1>'));server.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port));`);
await writeFile(path.join(root,'package.json'),JSON.stringify({name:'nubi-isolated-development-fixture',version:'1.0.0',private:true}));
if(process.platform!=='win32'){
  await mkdir(path.join(root,'node_modules','.bin'),{recursive:true});await chmod(path.join(root,'serve.cjs'),0o755);
  await symlink('../../serve.cjs',path.join(root,'node_modules','.bin','nubi-development-fixture'));
}
await writeFile(path.join(root,'value.ts'),'export const amount: number = "wrong";\n');git(['add','.']);git(['commit','-qm','Development fixture']);
const service=new ProjectService({storageRoot:storage});
await service.open(root,{initializeWiki:false});
const task=await service.createTask({request:'개발 서버를 실행하고 실제 응답을 확인합니다.'});
service.store.set('task:'+task.id,{...task,state:'review'});
const source=await service.read({taskId:task.id,path:'serve.cjs'});
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const action=await prepareSetupAction(service,task.id,{title:'미리보기 서버 실행',kind:'start',interactive:true,script:process.platform==='win32'?'& '+quote(process.execPath)+' '+quote('serve.cjs'):'npx --offline --no -- nubi-development-fixture',reason:'실제 Electron 실행 경로 확인',effects:'격리된 로컬 서버 실행',verification:'TTY와 HTTP 응답 확인',references:[{path:'serve.cjs',hash:source.hash}]},{files:new Map([['serve.cjs',{hash:source.hash}]])});
service.dispose();service.store.close();
await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
let app;const errors=[],checks=[];
try{
  app=await electron.launch({executablePath:require('electron'),args:['electron-app'],timeout:30000,env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}});
  const page=await desktopTestWindow(app);page.on('pageerror',error=>errors.push(error.message));
  await page.locator('.desktop-shell[data-startup-ready="true"]').waitFor({timeout:60000});
  await page.waitForFunction(()=>!document.querySelector('.nubi-intro')&&!document.querySelector('.desktop-shell')?.inert,null,{timeout:60000});
  const request=async(method,args)=>{
    const result=await page.evaluate(({method,args})=>window.nubi.request(method,args),{method,args});
    assert.equal(result?.__nubiError,undefined,JSON.stringify(result));return result;
  };
  const approved=await request('decideSetupAction',{id:action.id,fingerprint:action.fingerprint,decision:'approve'});
  const id=approved.resultProcessId;assert(id);
  let record;
  for(let i=0;i<100;i++){record=await request('poll',{id});if(record.output.includes('http://'))break;await new Promise(resolve=>setTimeout(resolve,50));}
  assert.match(record.output,/TTY:true/);assert.equal(record.executionMode,'pty');assert.equal(record.state,'running');checks.push(process.platform==='win32'?'built service spawned an actual interactive PTY':'built service spawned the actual offline npx CLI with a local fixture bin in an interactive PTY');
  const response=await request('inspectDevServer',{taskId:task.id,processId:id});
  assert.equal(response.status,200);assert.equal(response.responding,true);assert.equal(response.title,'Nubi actual preview');assert.equal(response.functionalVerified,false);checks.push('built service checked the observed local HTTP response');
  const code=await request('inspectCode',{taskId:task.id,path:'value.ts',mode:'diagnostics'});
  assert(code.diagnostics.some(diagnostic=>diagnostic.code==='TS2322'));assert.equal(code.editObservation,false);checks.push('built compiler worker reported the actual type mismatch');
  await request('decideSetupAction',{id:action.id,fingerprint:action.fingerprint,decision:'approve'});
  assert.equal((await request('state',{taskId:task.id})).processes.length,1);checks.push('duplicate approval reused the process receipt');
  await request('stop',{id});
  for(let i=0;i<100;i++){record=await request('poll',{id});if(record.state==='cancelled')break;await new Promise(resolve=>setTimeout(resolve,50));}
  assert.equal(record.state,'cancelled');
  await assert.rejects(()=>fetch(response.url,{signal:AbortSignal.timeout(2000)}),'the actual preview endpoint must stop responding after process cancellation');
  checks.push('the owned server was cancelled and its actual HTTP endpoint stopped responding');
  assert.equal(await readFile(path.join(root,'value.ts'),'utf8'),'export const amount: number = "wrong";\n');
  // Configure through the actual settings surface, then exercise the built host
  // confirmation IPC. No provider is connected and no command runs before approval.
  const opener=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();
  await page.getByRole('button',{name:'대화 검색',exact:true}).click();
  await page.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').first().click();
  await page.setViewportSize({width:1280,height:900});
  await page.getByRole('button',{name:'설정',exact:true}).click();
  const setting=page.getByLabel('편집 뒤 자동 검사',{exact:true});await setting.fill('node --version');
  await setting.locator('xpath=ancestor::form').getByRole('button',{name:'저장',exact:true}).click();
  await page.waitForFunction(async()=>{const state=await window.nubi.request('state',{});return state.afterEditCheck?.script==='node --version';});
  const sidebarLabels=await page.locator('.nubi-sidebar-quick-actions button').evaluateAll(buttons=>buttons.map(button=>{const b=button.getBoundingClientRect(),span=button.querySelector('span'),r=span?.getBoundingClientRect();return {left:b.left,right:b.right,labelLeft:r?.left,labelRight:r?.right};}));
  assert(sidebarLabels.length>1&&sidebarLabels.every((b,i)=>!i||b.left>=sidebarLabels[i-1].right-1)&&sidebarLabels.every(b=>b.labelLeft===undefined||b.labelLeft>=b.left-1&&b.labelRight<=b.right+1),'actual1280 sidebar labels stay inside their own buttons under settings');
  await writeFile(path.join(evidence,'settings-sidebar-1280.json'),JSON.stringify(sidebarLabels,null,2));
  await captureDesign(page,{path:path.join(evidence,'after-edit-settings.png'),animations:'disabled'});
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'오른쪽 사이드바 닫기',exact:true}).click();
  const original=await request('read',{taskId:task.id,path:'value.ts'});
  const edit=await request('propose',{taskId:task.id,path:'value.ts',expectedHash:original.hash,content:'export const amount: number = 3;\n',reason:'타입 오류 수정'});
  await writeFile(path.join(root,'value.ts'),edit.content);
  await request('confirmProposal',{proposalId:edit.id});
  await request('confirmProposal',{proposalId:edit.id});
  const queued=(await request('state',{taskId:task.id})).setupActions.filter(a=>a.kind==='verify');
  assert.equal(queued.length,1);assert.equal(queued[0].state,'proposed');assert.equal(queued[0].script,'node --version');
  const card=page.getByRole('region',{name:'실행 준비 승인'}).filter({hasText:'편집 뒤 검사'});await card.waitFor({timeout:10000});
  assert((await card.innerText()).includes('편집 뒤 검사'));
  for(const width of [1280,440]){
    await page.setViewportSize({width,height:900});
    const expand=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(width===440||await expand.count())await expand.click();
    await page.locator('.nubi-sidebar[data-open="true"] .nubi-sidebar-history h3').first().waitFor({state:'visible'});
    const dates=await page.locator('.nubi-sidebar-history>section').evaluateAll(groups=>groups.map(group=>{
      const heading=group.querySelector('h3'),range=document.createRange();range.selectNodeContents(heading);
      return {label:heading.textContent,dateWidth:range.getBoundingClientRect().width,dateLeft:range.getBoundingClientRect().left,iconLeft:group.querySelector('.nubi-session-select>svg').getBoundingClientRect().left};
    }));
    await writeFile(path.join(evidence,`date-alignment-${width}.json`),JSON.stringify(dates,null,2));
    await captureDesign(page,{path:path.join(evidence,`date-alignment-${width}.png`),animations:'disabled'});
    assert(dates.length>0&&dates.every(row=>row.dateWidth>0&&Math.abs(row.dateLeft-row.iconLeft)<1),'visible sidebar dates share the list leading edge: '+JSON.stringify(dates));
  }
  for(const width of [1280,440]){
    const collapse=page.getByRole('button',{name:'사이드바 접기',exact:true});if(width===440&&await collapse.count())await collapse.click();
    await page.setViewportSize({width,height:900});
    await card.scrollIntoViewIfNeeded();
    const geometry=await card.evaluate(node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,viewport:innerWidth,scrollWidth:node.scrollWidth,clientWidth:node.clientWidth};});
    await writeFile(path.join(evidence,`after-edit-${width}-geometry.json`),JSON.stringify(geometry,null,2));
    await captureDesign(page,{path:path.join(evidence,`after-edit-${width}.png`),animations:'disabled'});
    assert(geometry.left>=0&&geometry.right<=geometry.viewport+1&&geometry.scrollWidth<=geometry.clientWidth+1,JSON.stringify(geometry));
    const fileAlignment=await page.evaluate(()=>{
      const files=document.querySelector('.nubi-applied-files'),approval=document.querySelector('.nubi-approval-form');
      const left=selector=>files.querySelector(selector).getBoundingClientRect().left;
      return {anchor:approval.querySelector('header>svg').getBoundingClientRect().left,
        heading:left('.nubi-applied-trigger>strong'),icons:[...files.querySelectorAll('.nubi-applied-row>.desktop-file-icon')].map(node=>node.getBoundingClientRect().left),
        cardLeft:files.getBoundingClientRect().left,cardRight:files.getBoundingClientRect().right,
        approvalLeft:approval.getBoundingClientRect().left,approvalRight:approval.getBoundingClientRect().right};
    });
    await writeFile(path.join(evidence,`file-alignment-${width}.json`),JSON.stringify(fileAlignment,null,2));
    assert(Math.abs(fileAlignment.heading-fileAlignment.anchor)<1&&fileAlignment.icons.length>0&&fileAlignment.icons.every(left=>Math.abs(left-fileAlignment.anchor)<1),'changed-file heading and file icons share the transcript reading edge: '+JSON.stringify(fileAlignment));
    assert(Math.abs(fileAlignment.cardLeft-fileAlignment.approvalLeft)<1&&Math.abs(fileAlignment.cardRight-fileAlignment.approvalRight)<1,'changed-file and approval cards share both edges: '+JSON.stringify(fileAlignment));
  }
  assert.equal((await request('state',{taskId:task.id})).processes.length,1);
  const verification=await request('decideSetupAction',{id:queued[0].id,fingerprint:queued[0].fingerprint,decision:'approve'});
  for(let i=0;i<100;i++){record=await request('poll',{id:verification.resultProcessId});if(record.state==='completed')break;await new Promise(resolve=>setTimeout(resolve,50));}
  assert.equal(record.exitCode,0);assert.match(record.output,/v\d+\./);
  await request('confirmProposal',{proposalId:edit.id});
  assert.equal((await request('state',{taskId:task.id})).processes.length,2);
  checks.push('saved after-edit setting queued one hash-bound approval; 1280/440 card fit; explicit approval ran once');
  // F13: the real host must not auto-certify a check using the manifest it just applied.
  const project=await request('overview',{});
  await request('setAfterEditCheck',{projectId:project.projectId,profile:queued[0].profile,script:'npm test'});
  const manifest=await request('read',{taskId:task.id,path:'package.json'});
  const changed=await request('propose',{taskId:task.id,path:'package.json',expectedHash:manifest.hash,content:JSON.stringify({name:'nubi-fixture',scripts:{test:'node --version'}}),reason:'검사 정의 변경'});
  await writeFile(path.join(root,'package.json'),changed.content);await request('confirmProposal',{proposalId:changed.id});
  await request('setApprovalMode',{mode:'commands'});
  const pending=(await request('state',{taskId:task.id})).setupActions.find(row=>row.script==='npm test');assert.equal(pending?.manifestChanged,true);assert.equal(pending.state,'proposed');
  assert.equal((await request('autoApprovals',{taskId:task.id})).command,null);
  const applied=await request('appliedFileSummary',{taskId:task.id});
  assert.equal(applied.files.length,2);assert(applied.files.every(row=>row.state==='verified'&&row.stats.state==='counted'));assert.deepEqual(applied.totals,{added:2,removed:2});
  const guarded=page.getByRole('region',{name:'실행 준비 승인'}).filter({hasText:'npm test'});await guarded.getByText('방금 반영한 변경이 package.json 또는 검사 실행 파일을 바꿔서 확인이 필요해요.',{exact:true}).waitFor();
  await page.setViewportSize({width:1280,height:900});
  const closeTerminal=page.getByRole('button',{name:'오른쪽 사이드바 닫기',exact:true});if(await closeTerminal.count())await closeTerminal.click();
  for(const width of [1280,440]){
    await page.setViewportSize({width,height:900});await guarded.scrollIntoViewIfNeeded();
    assert(await guarded.evaluate(node=>{const r=node.getBoundingClientRect();return node.contains(document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2));}),'approval card must not be covered by the terminal');
    assert(await guarded.evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&node.scrollWidth<=node.clientWidth+1;}));
    await captureDesign(page,{path:path.join(evidence,`manifest-approval-${width}.png`),animations:'disabled'});
  }
  assert.equal((await request('state',{taskId:task.id})).processes.length,2);
  checks.push('F13 changed manifest remains proposed in commands mode, with an explanation at 1280/440 and no new process');
  checks.push('applied changes verified against their original snapshots despite the macOS storage alias: 2 added and 2 removed lines');
  assert.equal(await guarded.getByRole('button',{name:'승인',exact:true}).count(),1);
  assert.equal(await guarded.getByRole('button',{name:'실행 승인',exact:true}).count(),0);
  await captureDesign(page,{path:path.join(evidence,'workspace.png'),animations:'disabled'});
  assert.deepEqual(errors,[]);
  await writeFile(path.join(evidence,'result.json'),JSON.stringify({kind:'electron-runtime-development-smoke',platform:process.platform,checks,errors,model:'not_run',windowsVerified:process.platform==='win32'},null,2));
  console.log(`PASS: ${checks.length} actual Electron development checks`);
}finally{await app?.close();await rm(temporary,{recursive:true,force:true});}
