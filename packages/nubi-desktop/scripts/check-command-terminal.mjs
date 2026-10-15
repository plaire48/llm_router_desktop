// Actual Electron + PTY; local scripted model only creates a command approval.
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import {startFixtureModel} from './fixture-model.mjs';
import {desktopTestWindow} from './electron-test-window.mjs';
const require=createRequire(import.meta.url),temporary=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-terminal-flow-'))),root=path.join(temporary,'project'),storage=path.join(temporary,'state'),out=path.resolve('verification/command-terminal-2026-10-15');
await mkdir(root);await mkdir(storage);await mkdir(out,{recursive:true});await mkdir(path.join(root,'openwiki'));await writeFile(path.join(root,'openwiki/home.md'),'# Fixture');await writeFile(path.join(root,'guide.txt'),'A local terminal test project.');
const git=args=>execFileSync('git',['-C',root,...args],{stdio:'ignore'});git(['init']);git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgSign=false','commit','-m','Fixture']);await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
const windows=process.platform==='win32';let round=0;
const fixture=await startFixtureModel({respond({results,call,text}){
 if(round++===0)return call('read_source',{path:'guide.txt'});
 if(round===2){const source=results.at(-1);return call('propose_setup_action',{title:'명령 결과 확인',kind:'configure',profile:windows?'powershell':'bash',script:windows?"Add-Content -LiteralPath execution.txt -Value once -Encoding utf8":"printf 'once\\n' >> execution.txt",reason:'실행 후 터미널 연결 확인',effects:'프로젝트 안에 확인 파일 생성',verification:'확인 파일의 한 줄 읽기',references:[{path:source.path,hash:source.hash}]});}
 return text('명령 기록을 확인했습니다.');
}});
let app,page;const errors=[],checks=[];
try{
 app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}});
 page=await desktopTestWindow(app);page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.locator('.desktop-shell[data-startup-ready="true"]').waitFor({timeout:60000});await page.keyboard.press('Escape');
 const request=(method,args={})=>page.evaluate(({method,args})=>window.nubi.request(method,args),{method,args});
 // The tools menu is available even before connecting a model.
 const composer=()=>page.getByRole('textbox',{name:/^(작업 요청|추가 요청)$/});
 await page.getByRole('button',{name:'파일',exact:true}).click();await page.getByRole('button',{name:'새 탭',exact:true}).click();await page.getByRole('menuitem',{name:'터미널',exact:true}).click();
 let terminal=page.locator('.desktop-terminal:visible');await terminal.locator('.xterm-helper-textarea').waitFor({state:'attached'});await page.locator('.desktop-terminal[data-terminal-state=running]:visible').waitFor();
 const input=()=>terminal.locator('.xterm-helper-textarea');
 const enter=async command=>{await input().focus();await page.keyboard.insertText(command);await page.keyboard.press('Enter');};
 const waitLine=async line=>page.waitForFunction(expected=>[...document.querySelectorAll('.desktop-terminal:not([hidden]) .xterm-rows>div')].some(row=>row.textContent.trim()===expected),line);
 const waitPath=()=>page.waitForFunction(expected=>[...document.querySelectorAll('.desktop-terminal:not([hidden]) .xterm-rows>div')].map(row=>row.textContent.trimEnd()).join('').includes(expected),root);
 await enter(windows?"$nubiProbe='한글 입력 확인'":"nubiProbe='한글 입력 확인'");await enter(windows?'Write-Output $nubiProbe':'printf "%s\\n" "$nubiProbe"');await waitLine('한글 입력 확인');
 await enter(windows?'(Get-Location).Path':'pwd');await waitPath();checks.push('tools menu opens real interactive terminal without AI login; Korean input, cwd and variables persist');
 // Settings apply to new terminals, and old sessions stay intact.
 const overview=await request('overview');const expected=overview.defaultShell;
 await request('provider',{action:'connect',input:fixture.connection});await composer().fill('/terminal');await page.getByRole('option',{name:/터미널.*직접 입력/}).click();await page.locator('.desktop-terminal[data-terminal-state=running]:visible').waitFor();assert.equal(fixture.calls.length,0);checks.push('slash opens a terminal directly without a model call');
 await composer().fill('명령 확인 파일을 만든 뒤 결과를 확인해 주세요');await page.getByRole('button',{name:'전송',exact:true}).click();
 await page.getByRole('button',{name:'실행 승인',exact:true}).waitFor({timeout:60000});await page.getByRole('button',{name:'실행 승인',exact:true}).click();
 const open=page.getByRole('button',{name:'기본 터미널에서 직접 입력',exact:true}).last();await open.waitFor({timeout:60000});
 await page.waitForFunction(()=>document.querySelector('.nubi-setup-summary')?.textContent.includes('명령 종료')||document.querySelector('.nubi-setup-summary')?.textContent.includes('결과 확인됨'));
 const before=await readFile(path.join(root,'execution.txt'),'utf8');assert.equal(before.trim(),'once');
 await open.click();await page.locator('.desktop-terminal[data-terminal-state=running]:visible').waitFor();terminal=page.locator('.desktop-terminal:visible');assert(await terminal.locator('.desktop-terminal-heading').innerText().then(t=>t.includes(overview.profiles.find(p=>p.id===expected).label)));
 await enter(windows?'(Get-Location).Path':'pwd');await waitPath();
 const count=await page.locator('.desktop-terminal').count();await open.click();assert.equal(await page.locator('.desktop-terminal').count(),count);assert.equal(await readFile(path.join(root,'execution.txt'),'utf8'),before);checks.push('command result opens selected default shell in its cwd; repeated open reuses terminal and never replays command');
 await enter(windows?"Write-Output 'terminal-active'; Start-Sleep 30":"printf 'terminal-active\\n'; sleep 30");await waitLine('terminal-active');await page.keyboard.press('Control+c');await enter(windows?"Write-Output 'after-interrupt'":"printf 'after-interrupt\\n'");await waitLine('after-interrupt');checks.push('Ctrl+C interrupts and terminal accepts the next command');
 await page.screenshot({path:path.join(out,'terminal.png')});assert.deepEqual(errors,[]);
 await writeFile(path.join(out,'result.json'),JSON.stringify({passed:true,checks,errors,platform:process.platform,shell:expected,boundary:'Actual Electron and native PTY; scripted model. Windows PowerShell/CMD/Git Bash runtime only verified when platform is win32.'},null,2));console.log(JSON.stringify({checks,shell:expected}));
}catch(error){await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}
finally{await app?.close();fixture.close();await rm(temporary,{recursive:true,force:true});}
