import {captureDesign} from './design-rules.mjs';
import {startFixtureModel} from './fixture-model.mjs';
// The lifecycle of the real Electron host (2026-10-05): the worker restarts after it is killed, a second start leaves the first window running,
// and the window comes back at its last bounds. Run from the package dir after scripts/build-electron.mjs:
// node scripts/check-electron-lifecycle.mjs. The single-instance lock is per userData: close the running Workspace first.
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const temporary=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-lifecycle-check-'))),root=path.join(temporary,'project'),storage=path.join(temporary,'state');
await mkdir(root);await mkdir(storage);await mkdir(path.join(root,'openwiki'));await writeFile(path.join(root,'openwiki/home.md'),'# Fixture wiki\n');
const git=args=>execFileSync('git',['-C',root,...args]);git(['init']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.invalid']);
await writeFile(path.join(root,'example.js'),'export const value = 1;\n');git(['add','.']);git(['commit','-m','Initial fixture']);
await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
const env={...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined};
const launch=()=>electron.launch({executablePath:require('electron'),args:['electron-app'],env});
const result={};
// Startup connection guidance is shown for disconnected mail on every launch.
async function dismissStartup(page){await page.locator('.desktop-shell[data-startup-ready="true"]').waitFor({timeout:60000});if(await page.getByText('메일을 연결해 주세요').count())await page.keyboard.press('Escape');}
{
  const first=await launch();
  try{const page=await first.firstWindow();await page.getByRole('navigation',{name:'프로젝트 도구'}).waitFor({timeout:30000});await new Promise(resolve=>setTimeout(resolve,1500));
    /* Nothing mail-related opens by itself at startup (user decision 2026-10-15: the prompt collided with the AI sign-in). */
    result.promptOnFreshStore=await page.getByText(/메일을 연결해 주세요|사내 메일 로그인/).count();assert.equal(result.promptOnFreshStore,0,'no mail prompt opens at startup');}
  finally{await first.close();}
  const {DatabaseSync}=await import('node:sqlite');await mkdir(path.join(storage,'personal-mail'),{recursive:true});
  const db=new DatabaseSync(path.join(storage,'personal-mail','workspace.db'));
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO records VALUES ('setting:auto-wiki','true') ON CONFLICT(key) DO UPDATE SET value=excluded.value;");db.close();
  const second=await launch();
  try{const page=await second.firstWindow();await page.getByRole('navigation',{name:'프로젝트 도구'}).waitFor({timeout:30000});await new Promise(resolve=>setTimeout(resolve,1500));result.promptWithSummariesOn=await page.getByText(/메일을 연결해 주세요|사내 메일 로그인/).count();assert.equal(result.promptWithSummariesOn,0,'no mail prompt even with summaries on');}
  finally{await second.close();}
}
const app=await launch();let routineFixture;
try{
  const page=await app.firstWindow();page.setDefaultTimeout(15000);
  await page.getByRole('navigation',{name:'프로젝트 도구'}).waitFor({timeout:30000});
  await dismissStartup(page);
  // The renderer opens the last project itself; openCurrent returns that project once it is open.
  await page.waitForFunction(()=>document.querySelector('button[aria-label="파일"]')?.disabled===false,null,{timeout:60000,polling:100});
  const overview=await page.evaluate(()=>window.nubi.request('overview',{}));assert.equal(overview?.root,root,JSON.stringify(overview));
  routineFixture=await startFixtureModel({respond:({call})=>call('ask_user',{question:'루틴에서 확인할 범위를 알려 주세요.'})});
  const connected=await page.evaluate(input=>window.nubi.request('provider',{action:'connect',input}),routineFixture.connection);assert.equal(connected.connected,true);
  await page.getByRole('button',{name:'설정',exact:true}).click();await page.getByRole('button',{name:'루틴',exact:true}).click();await page.getByRole('button',{name:'루틴 추가',exact:true}).click();
  const form=page.getByRole('dialog',{name:'루틴 설정',exact:true});await form.getByLabel('이름',{exact:true}).fill('매일 자료 점검');await form.getByLabel('요청',{exact:true}).fill('루틴 실행 범위를 확인해 주세요');await form.getByRole('switch',{name:'예약 실행',exact:true}).click();await form.getByRole('button',{name:'저장',exact:true}).click();
  const routines=page.getByRole('dialog',{name:'루틴',exact:true});await routines.getByRole('switch',{name:'매일 자료 점검'}).waitFor();assert.equal(await routines.getByRole('switch',{name:'매일 자료 점검'}).getAttribute('aria-checked'),'false');
  // Trigger the host entry directly: no onStarted callback or renderer refresh.
  // Deterministic scheduler clock/tick coverage belongs to routines.test.mjs.
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  const configured=(await page.evaluate(()=>window.nubi.request('listRoutines'))).items[0];
  await page.evaluate(id=>window.nubi.request('runRoutineNow',{id}),configured.id);
  const saved=(await page.evaluate(()=>window.nubi.request('listRoutines'))).items[0];result.routineId=saved.id;result.routineTaskId=saved.lastTaskId;assert(saved.lastTaskId);
  await page.waitForFunction(async id=>(await window.nubi.request('state',{taskId:id})).tasks.some(t=>t.id===id&&t.state==='waiting_input'),saved.lastTaskId,{timeout:30000});
  await mkdir('verification/wave2',{recursive:true});await captureDesign(page,{path:'verification/wave2/task12-routines.png'});
  const showSidebar=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await showSidebar.count())await showSidebar.click();await page.locator(`[data-session-id="${saved.lastTaskId}"] .nubi-session-select`).waitFor();assert.match(await page.locator(`[data-session-id="${saved.lastTaskId}"] .nubi-session-select`).innerText(),/루틴 실행 범위를 확인해 주세요/);
  result.routineStartedAndWaiting=true;result.idleRoutineDiscoveredWithoutRefresh=true;
  await page.getByRole('button',{name:/^알림/}).first().click();
  await page.getByText('답변 요청: 루틴에서 확인할 범위를 알려 주세요.',{exact:true}).waitFor();
  await page.keyboard.press('Escape');result.routineQuestionNoticeVisible=true;
  // 1. The worker is killed: a child of the Electron process this check started.
  const mainPid=app.process().pid;
  // Windows has no pgrep/ps: the children of the main process and their command lines come from Win32_Process.
  const childProcesses=()=>process.platform==='win32'
    ?execFileSync('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',`Get-CimInstance Win32_Process -Filter 'ParentProcessId=${Number(mainPid)}' | ForEach-Object { [string]$_.ProcessId + [char]9 + [string]$_.CommandLine }`],{encoding:'utf8'}).split(/\r?\n/).filter(Boolean).map(line=>{const [pid,...rest]=line.split('\t');return {pid:pid.trim(),command:rest.join('\t')};})
    :execFileSync('pgrep',['-P',String(mainPid)]).toString().trim().split('\n').filter(Boolean).map(pid=>{try{return {pid,command:execFileSync('ps',['-o','command=','-p',pid]).toString()};}catch{return {pid,command:''};}});
  const worker=childProcesses().find(row=>row.command.includes('service-entry.mjs'))?.pid;
  assert.ok(worker,'the worker is a child of the main process');
  await page.evaluate(()=>{window.__hostEvents=[];window.nubi.onHostEvent(event=>window.__hostEvents.push(event));});
  process.kill(Number(worker),'SIGKILL');
  await page.waitForFunction(()=>window.__hostEvents.some(event=>event.type==='worker_restarted'),null,{timeout:20000});
  // The renderer tells the user (renderer.jsx onHostEvent → toast).
  await page.getByText('누비 실행기를 다시 시작했어요').waitFor({timeout:5000});result.restartToast=true;
  const after=await page.evaluate(()=>window.nubi.request('overview',{}));assert.equal(after.root,root,'the project is open in the new worker');
  const restoredRoutines=await page.evaluate(()=>window.nubi.request('listRoutines'));assert.equal(restoredRoutines.items[0].lastTaskId,result.routineTaskId);assert.equal(restoredRoutines.items[0].enabled,false);result.routineRetainedAfterWorkerRestart=true;
  result.hostEvents=await page.evaluate(()=>window.__hostEvents.map(event=>event.type));
  const fault=JSON.parse(await readFile(path.join(storage,'last-host-fault.json'),'utf8'));assert.equal(fault.component,'worker');assert.equal(fault.reason,'killed');result.fault=fault;
  result.workerPids=[worker,childProcesses().find(row=>row.command.includes('service-entry.mjs'))?.pid];
  assert.notEqual(result.workerPids[0],result.workerPids[1]);
  // 2. A second start leaves at once; the first still answers.
  const second=spawn(require('electron'),['electron-app'],{env,stdio:'ignore'});
  result.secondInstanceExit=await new Promise(resolve=>{const timer=setTimeout(()=>{second.kill();resolve('timeout');},20000);second.on('exit',code=>{clearTimeout(timer);resolve(code);});});
  assert.equal(result.secondInstanceExit,0);
  assert.equal((await page.evaluate(()=>window.nubi.request('overview',{}))).root,root,'the first instance still answers');
  // 3. The window is moved and resized, closed, and comes back there.
  result.requested=await app.evaluate(({BrowserWindow,screen})=>{const area=screen.getPrimaryDisplay().workArea;const bounds={x:area.x+20,y:area.y+20,width:Math.min(1000,area.width-40),height:Math.min(700,area.height-40)};/* portal authentication owns hidden windows (2026-10-14): resize the visible workspace window */(BrowserWindow.getAllWindows().find(w=>w.isVisible())||BrowserWindow.getAllWindows()[0]).setBounds(bounds);return bounds;});
  await new Promise(resolve=>setTimeout(resolve,900));
}finally{await app.close();routineFixture?.close();}
result.saved=JSON.parse(await readFile(path.join(storage,'window-state.json'),'utf8'));await writeFile('verification/lifecycle-window-state.json',JSON.stringify(result,null,2));assert.equal(result.saved.width,result.requested.width);assert.equal(result.saved.height,result.requested.height);assert.equal(result.saved.x,result.requested.x,'the requested x was saved before relaunch');
const again=await launch();
try{
  const page=await again.firstWindow();await page.getByRole('navigation',{name:'프로젝트 도구'}).waitFor({timeout:30000});
  result.bounds=await again.evaluate(({BrowserWindow})=>(BrowserWindow.getAllWindows().find(w=>w.isVisible())||BrowserWindow.getAllWindows()[0]).getBounds());
  result.displays=await again.evaluate(({screen})=>screen.getAllDisplays().map(display=>({id:display.id,bounds:display.bounds,workArea:display.workArea})));await writeFile('verification/lifecycle-window-state.json',JSON.stringify(result,null,2));
  assert.equal(result.bounds.width,result.requested.width);assert.equal(result.bounds.height,result.requested.height);assert.equal(result.bounds.x,result.requested.x);
  result.workerLog=(await readFile(path.join(storage,'worker.log'),'utf8').catch(()=>'')).length;
}finally{await again.close();}
// 6. A last project whose folder is gone: the start screen opens and the stale pointer is cleared (2026-10-07).
{
  await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root:path.join(temporary,'gone-project')}));
  const app=await launch();
  try{const page=await app.firstWindow();await dismissStartup(page);await page.getByRole('navigation',{name:'프로젝트 도구'}).waitFor();await captureDesign(page,{path:'verification/lifecycle-missing-project.png'});await writeFile('verification/lifecycle-missing-project.txt',await page.locator('body').innerText());assert.equal(await page.getByRole('button',{name:'파일',exact:true}).isDisabled(),true,'missing project leaves file tools disabled');/* without a model the start screen is the provider chooser */result.missingProjectStartScreen=true;
    await new Promise(resolve=>setTimeout(resolve,500));result.stalePointerCleared=await readFile(path.join(storage,'last-project.json'),'utf8').then(()=>false,()=>true);assert.equal(result.stalePointerCleared,true,'the stale pointer is removed');}
  finally{await app.close();}
}
// 7. A busy local web port: the window still loads and the fault is recorded (2026-10-07; the app hung before).
{
  const {createServer}=await import('node:net');const blocker=createServer();await new Promise(resolve=>blocker.listen(0,'127.0.0.1',resolve));const port=blocker.address().port;
  await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));await rm(path.join(storage,'last-host-fault.json'),{force:true});
  const app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...env,NUBI_WEB_PORT:String(port)}});
  try{const page=await app.firstWindow();await page.getByRole('navigation',{name:'프로젝트 도구'}).waitFor({timeout:30000});
    const fault=JSON.parse(await readFile(path.join(storage,'last-host-fault.json'),'utf8'));assert.equal(fault.component,'web-host');assert.equal(fault.reason,'launch-failed');result.busyWebPort={windowLoaded:true,fault:fault.reason};}
  finally{await app.close();await new Promise(resolve=>blocker.close(resolve));}
}
await rm(temporary,{recursive:true,force:true});
console.log(JSON.stringify(result));
