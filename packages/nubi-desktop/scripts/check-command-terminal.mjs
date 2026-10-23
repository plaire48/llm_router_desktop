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
 if(round===2){const source=results.at(-1);return call('propose_setup_action',{title:'명령 결과 확인',kind:'configure',profile:windows?'powershell':'bash',script:windows?"Write-Output agent-output; Write-Output (([char]27) + '[32mreceipt-color-ok' + ([char]27) + '[0m'); Add-Content -LiteralPath execution.txt -Value once -Encoding utf8":"printf 'agent-output\\n\\033[32mreceipt-color-ok\\033[0m\\n'; printf 'once\\n' >> execution.txt",reason:'실행 후 터미널 연결 확인',effects:'프로젝트 안에 확인 파일 생성',verification:'확인 파일의 한 줄 읽기',references:[{path:source.path,hash:source.hash}]});}
 return text('명령 기록을 확인했습니다.');
}});
let app,page,largeOutputMs;const errors=[],checks=[];
try{
 app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}});
 page=await desktopTestWindow(app);page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.locator('.desktop-shell[data-startup-ready="true"]').waitFor({timeout:60000});await page.keyboard.press('Escape');
 await page.evaluate(()=>{window.terminalProbe={chunks:0,characters:0,lastAt:null};window.nubi.onTerminalEvent(event=>{if(event.type==='data'){window.terminalProbe.chunks++;window.terminalProbe.characters+=event.data.length;window.terminalProbe.lastAt=Date.now();}});});
 const request=(method,args={})=>page.evaluate(({method,args})=>window.nubi.request(method,args),{method,args});
 // The tools menu is available even before connecting a model.
 const composer=()=>page.getByRole('textbox',{name:/^(작업 요청|추가 요청)$/});
 await page.getByRole('button',{name:'파일',exact:true}).click();await page.getByRole('button',{name:'새 탭',exact:true}).click();await page.getByRole('menuitem',{name:'터미널',exact:true}).click();
 let terminal=page.locator('.desktop-terminal:visible');await terminal.locator('.xterm-helper-textarea').waitFor({state:'attached'});await page.locator('.desktop-terminal[data-terminal-state=running]:visible').waitFor();
 const input=()=>terminal.locator('.xterm-helper-textarea');
 const enter=async command=>{await input().focus();await page.keyboard.insertText(command);await page.keyboard.press('Enter');};
 const waitLine=async (line,timeout=20000)=>page.waitForFunction(expected=>[...document.querySelectorAll('.desktop-terminal:not([hidden]) .xterm-rows>div')].some(row=>row.textContent.trim()===expected),line,{timeout});
 const waitPath=()=>page.waitForFunction(expected=>[...document.querySelectorAll('.desktop-terminal:not([hidden]) .xterm-rows>div')].map(row=>row.textContent.trimEnd()).join('').includes(expected),root);
 await enter(windows?"$nubiProbe='한글 입력 확인'":"nubiProbe='한글 입력 확인'");await enter(windows?'Write-Output $nubiProbe':'printf "%s\\n" "$nubiProbe"');await waitLine('한글 입력 확인');
 await enter(windows?'(Get-Location).Path':'pwd');await waitPath();checks.push('tools menu opens real interactive terminal without AI login; Korean input, cwd and variables persist');
 const unicode='한글 日本語 résumé Ελληνικά 😀 ┌──┐ ✓';
 await enter(windows?`Write-Output '${unicode}'`:`printf '%s\\n' '${unicode}'`);await waitLine(unicode);
 await enter(windows?"Write-Output (([char]27) + '[32mansi-color-ok' + ([char]27) + '[0m')":"printf '\\033[32mansi-color-ok\\033[0m\\n'");await waitLine('ansi-color-ok');checks.push('international characters, emoji, box drawing and ANSI render in the actual PTY');
 // Settings apply to new terminals, and old sessions stay intact.
 const overview=await request('overview');const expected=overview.defaultShell;
 await request('provider',{action:'connect',input:fixture.connection});await composer().fill('/terminal');await page.getByRole('option',{name:/터미널.*직접 입력/}).click();await page.locator('.desktop-terminal[data-terminal-state=running]:visible').waitFor();assert.equal(fixture.calls.length,0);checks.push('slash opens a terminal directly without a model call');
 await composer().fill('명령 확인 파일을 만든 뒤 결과를 확인해 주세요');await page.getByRole('button',{name:'전송',exact:true}).click();
 await page.getByRole('button',{name:'승인',exact:true}).waitFor({timeout:60000});assert.equal(await page.locator('.nubi-current-decisions, .nubi-conversation-decisions').getByRole('button',{name:'승인',exact:true}).count(),1);await page.getByRole('button',{name:'승인',exact:true}).click();
 await page.locator('.desktop-terminal[data-terminal-state=completed]:visible').waitFor({timeout:60000});
 terminal=page.locator('.desktop-terminal:visible');
 assert.match(await terminal.innerText(),/명령 종료/);await waitLine('agent-output');
 await page.screenshot({path:path.join(out,'agent-execution.png')});
 const before=await readFile(path.join(root,'execution.txt'),'utf8');assert.equal(before.trim(),'once');
 const record=page.locator('.nubi-command-record').last();await record.waitFor();assert.equal(await record.getAttribute('open'),null);
 assert.equal(await record.locator('.nubi-terminal').count(),0,'collapsed record defers output rendering');
 await record.locator('summary').click();const open=record.getByRole('button',{name:'터미널 열기',exact:true});
 await record.locator('.nubi-terminal-output').waitFor();assert.match(await record.locator('.nubi-terminal-output').innerText(),/agent-output/);
 await record.locator('.nubi-terminal-state[data-state=completed]').waitFor({timeout:4000});assert.equal(await record.locator('.nubi-terminal-state').getAttribute('data-state'),'completed','chat receipt reaches the same final state as its terminal');assert.equal(await record.locator('.nubi-terminal-exit').innerText(),'exit 0');assert.equal(await record.getByRole('button',{name:'명령 중지',exact:true}).count(),0);
 const receipt=await record.locator('.nubi-terminal-output').innerText();assert.match(receipt,/receipt-color-ok/);assert.doesNotMatch(receipt,/\x1b|\[32m|\[0m/);await waitLine('receipt-color-ok');
 const count=await page.locator('.desktop-terminal').count();await open.click();assert.equal(await page.locator('.desktop-terminal').count(),count);
 await record.locator('summary').click();await page.waitForTimeout(1200);assert.equal(await record.getAttribute('open'),null,'polling preserves collapsed record');
 assert.equal(await readFile(path.join(root,'execution.txt'),'utf8'),before);checks.push('approval automatically opens the same execution in internal terminal; collapsed chat receipt; reopen never replays');
 await terminal.getByRole('button',{name:'기본 터미널에서 직접 입력',exact:true}).click();
 await page.locator('.desktop-terminal[data-terminal-state=running]:visible').waitFor();terminal=page.locator('.desktop-terminal:visible');
 await enter(windows?'(Get-Location).Path':'pwd');await waitPath();
 assert.equal(await readFile(path.join(root,'execution.txt'),'utf8'),before);checks.push('direct input opens selected default shell without replaying agent command');
 const waitPrompt=()=>page.waitForFunction(win=>{const rows=[...document.querySelectorAll('.desktop-terminal:not([hidden]) .xterm-rows>div')].map(row=>row.textContent.trimEnd()).join('\n').trimEnd();return win?rows.endsWith('>'):/[$#]$/.test(rows);},windows);
 await enter(windows?"Write-Output 'terminal-active'; Start-Sleep 30":"printf 'terminal-active\\n'; sleep 30");await waitLine('terminal-active');await page.keyboard.press('Control+c');
 // ConPTY/PowerShell completes cancellation asynchronously and discards input
 // sent during that cancellation. Wait for the actual new prompt, not a delay.
 await waitPrompt();await enter(windows?"Write-Output 'after-interrupt'":"printf 'after-interrupt\\n'");await waitLine('after-interrupt');checks.push('Ctrl+C interrupts and terminal accepts the next command');
 // More than one flow-control window, not just a short prompt. A frame-sized ACK
 // must drain the entire parsed batch so the shell can print the final marker.
 const largeStarted=Date.now();
 await enter(windows?"1..12000 | ForEach-Object { Write-Output ('한글 출력 확인 ' + ('x' * 80)) }; Write-Output 'large-output-finished'":"for ((n=0;n<12000;n++)); do printf '한글 출력 확인 %080d\\n' 0; done; printf 'large-output-finished\\n'");
 await waitLine('large-output-finished',60000);largeOutputMs=Date.now()-largeStarted;console.log('large output completed',JSON.stringify({largeOutputMs,...await page.evaluate(()=>window.terminalProbe)}));await waitPrompt();
 const nativeWindow=await app.browserWindow(page);
 for(const width of [1100,1500,1100])await nativeWindow.evaluate((win,width)=>win.setContentSize(width,850),width);
 await enter(windows?"Write-Output 'resize-output-finished'":"printf 'resize-output-finished\\n'");await waitLine('resize-output-finished');
 checks.push('large Korean output drains past backpressure window and accepts input after native window resize');
 await enter(windows?"Write-Output 'last-output-before-exit'; exit 0":"printf 'last-output-before-exit\\n'; exit 0");
 await page.locator('.desktop-terminal[data-terminal-state=exited]:visible').waitFor();await waitLine('last-output-before-exit');await waitLine('[셸 종료 0]');
 const finalLines=await terminal.locator('.xterm-rows>div').allTextContents();assert(finalLines.findIndex(line=>line.trim()==='last-output-before-exit')<finalLines.findIndex(line=>line.trim()==='[셸 종료 0]'));
 checks.push('final PTY output remains before shell exit marker');
 await page.screenshot({path:path.join(out,'terminal.png')});assert.deepEqual(errors,[]);
 await writeFile(path.join(out,'result.json'),JSON.stringify({passed:true,checks,errors,largeOutputMs,platform:process.platform,shell:expected,boundary:'Actual Electron and native PTY; scripted model. Windows PowerShell/CMD/Git Bash runtime only verified when platform is win32.'},null,2));console.log(JSON.stringify({checks,shell:expected}));
}catch(error){for(const name of ['terminal.log','worker.log'])await writeFile(path.join(out,name),(await readFile(path.join(storage,name),'utf8').catch(()=>'' )).slice(-16000));if(page)await writeFile(path.join(out,'failure.json'),JSON.stringify({checks,errors,largeOutputMs,...await page.evaluate(()=>({probe:window.terminalProbe,now:Date.now(),terminalStates:[...document.querySelectorAll('.desktop-terminal')].map(e=>({state:e.dataset.terminalState,visible:e.checkVisibility()})),visibleTail:[...document.querySelectorAll('.desktop-terminal:not([hidden]) .xterm-rows>div')].slice(-5).map(e=>e.textContent)}))},null,2));await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}
finally{await app?.close();fixture.close();await rm(temporary,{recursive:true,force:true});}
