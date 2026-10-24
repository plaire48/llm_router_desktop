import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
const {interactiveShell,TerminalHost}=createRequire(import.meta.url)('../electron-app/terminal-host.cjs');
test('project navigation closes only its terminal sessions and awaits an opening session',async()=>{
 const host=new TerminalHost({notify:()=>{}}),calls=[];let finishOpen,finishClose;
 host.sessions.set('source','a');host.sessions.set('background','b');
 const opening=new Promise(resolve=>{finishOpen=()=>{host.sessions.set('opening','a');resolve({});};});opening.projectId='a';host.opens.set('opening',opening);
 host.call=async(action,args)=>{calls.push({action,...args});if(args.id==='source')await new Promise(resolve=>{finishClose=resolve;});return {closed:true};};
 const navigation=host.closeProject('a');
 await assert.rejects(host.request({action:'open',id:'late',projectId:'a'}),/project_navigation_stopping/);
 finishOpen();while(!finishClose)await new Promise(resolve=>setTimeout(resolve,1));
 assert(host.sessions.has('source'),'a close request is not an exit receipt');finishClose();await navigation;
 assert.deepEqual([...host.sessions.keys()],['background']);assert.deepEqual(calls.map(item=>item.id).sort(),['opening','source']);assert(calls.every(item=>item.action==='close'&&item.waitForExit===true));
});
test('terminal worker never inherits the app debugger arguments',()=>{
 let options;const worker=new EventEmitter();worker.connected=true;worker.disconnect=()=>{};
 const host=new TerminalHost({notify:()=>{},workerFile:'worker.cjs',spawnWorker:(file,args,config)=>{options=config;return worker;}});
 host.start();assert.deepEqual(options.execArgv,[]);assert.equal(options.env.ELECTRON_RUN_AS_NODE,'1');host.dispose();
});
test('interactive PowerShell prefers installed 7 and retains its real startup banner',async()=>{
 const shell=await interactiveShell('powershell',{platform:'win32',env:{ProgramFiles:'C:\\Program Files'},lookup:async()=>{throw Error();},exists:async file=>{assert.equal(file,'C:\\Program Files\\PowerShell\\7\\pwsh.exe');}});
 assert.match(shell.executable,/pwsh\.exe$/);assert(shell.argv.includes('-NoExit'));const startup=Buffer.from(shell.argv.at(-1),'base64').toString('utf16le');assert.match(startup,/Console.*OutputEncoding/);assert.match(startup,/PSVersionTable.PSVersion/);assert.match(startup,/Get-Content:Encoding/);assert.doesNotMatch(startup,/ExecutionPolicy|Set-Culture|Set-WinSystemLocale/);
});
test('PowerShell falls back to the installed Windows shell, never a fabricated version',async()=>{
 const shell=await interactiveShell('powershell',{platform:'win32',env:{SystemRoot:'C:\\Windows'},lookup:async()=>{throw Error();},exists:async file=>{if(file.includes('pwsh.exe'))throw Error();}});
 assert.equal(shell.executable,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');assert(shell.argv.includes('-NoExit'));const startup=Buffer.from(shell.argv.at(-1),'base64').toString('utf16le');assert.match(startup,/Console.*OutputEncoding/);assert.match(startup,/PSVersionTable.PSVersion/);assert.match(startup,/Get-Content:Encoding/);assert.doesNotMatch(startup,/ExecutionPolicy|Set-Culture|Set-WinSystemLocale/);
});
test('a project change during terminal setup refuses spawning',async()=>{
 let reads=0,spawns=0;const host=new TerminalHost({notify:()=>{},profiles:async()=>[{id:'bash',executable:'/bin/bash'}],invoke:async method=>{
  if(method==='overview')return {projectId:'a',defaultShell:'bash',profiles:[{id:'bash',executable:'/bin/bash'}]};
  if(method==='browseDirectory')return {absolute:'/fixture'};
  if(method==='projectPath'){if(++reads>1)throw Error('project_changed');return {projectId:'a',path:'/fixture',shellPreference:'bash'};}
 }});host.call=async()=>{spawns++;};
 await assert.rejects(host.request({action:'open',id:'terminal-a',projectId:'a'}),/project_changed/);assert.equal(reads,2);assert.equal(spawns,0);
});
test('terminal control requires the bound project and does not forward arbitrary actions',async()=>{
 const host=new TerminalHost({notify:()=>{}});host.sessions.set('one','a');let calls=0;host.call=async()=>{calls++;return {};};
 await assert.rejects(host.request({action:'input',id:'one',projectId:'b',data:'pwd\r'}),/terminal_session_missing/);
 await assert.rejects(host.request({action:'dispose',id:'one',projectId:'a'}),/method_invalid/);assert.equal(calls,0);
 await host.request({action:'input',id:'one',projectId:'a',data:'pwd\r'});assert.equal(calls,1);
});
test('pending opens are deduplicated and cannot attach a different project',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});let starts=0;
 const host=new TerminalHost({notify:()=>{},profiles:async()=>[{id:'bash',executable:'/bin/bash'}],invoke:async method=>{if(method==='projectPath'){await gate;return {projectId:'a',shellPreference:'bash'};}return {absolute:'/fixture'};}});
 host.call=async()=>{starts++;return {state:'running'};};
 const first=host.request({action:'open',id:'same',projectId:'a'}),second=host.request({action:'open',id:'same',projectId:'a'});
 await assert.rejects(host.request({action:'open',id:'same',projectId:'b'}),/terminal_session_missing/);
 release();await Promise.all([first,second]);assert.equal(starts,1);
});
test('disposing the host cancels a pending open before a shell is spawned',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});let starts=0;
 const host=new TerminalHost({notify:()=>{},invoke:async()=>{await gate;return {projectId:'a'};}});host.call=async()=>{starts++;};
 const pending=host.request({action:'open',id:'late',projectId:'a'});host.dispose();release();
 await assert.rejects(pending,/terminal_disconnected/);assert.equal(starts,0);
});
for(const preference of ['cmd','bash','powershell'])test(`opening a terminal uses saved ${preference} unless the person chooses another shell`,async()=>{
 const profiles=['cmd','bash','powershell'].map(id=>({id,executable:'/fixture/'+id})),calls=[];
 const host=new TerminalHost({notify:()=>{},profiles:async()=>profiles,resolveShell:async()=>null,invoke:async method=>method==='projectPath'?{projectId:'a',shellPreference:preference}:{absolute:'/fixture'}});
 host.call=async(action,args)=>{calls.push(args);return {state:'running'};};
 await host.request({action:'open',id:'default',projectId:'a'});
 assert.equal(calls[0].executable,'/fixture/'+preference);
 const other=preference==='bash'?'cmd':'bash';
 await host.request({action:'open',id:'explicit',projectId:'a',profile:other});
 assert.equal(calls[1].executable,'/fixture/'+other);
});

test('interactive Git Bash receives the verified installation environment root',async()=>{
 const root='C:\\Program Files\\Git';
 const host=new TerminalHost({notify:()=>{},profiles:async()=>[{id:'bash',executable:root+'\\usr\\bin\\bash.exe',gitBashRoot:root}],resolveShell:async()=>null,invoke:async method=>method==='projectPath'?{shellPreference:'bash'}:{absolute:'C:\\fixture'}});
 let observed;host.call=async(action,args)=>{observed=args;return {id:args.id};};
 await host.request({action:'open',id:'git',projectId:'p',gitBashRoot:'untrusted'});
 assert.equal(observed.gitBashRoot,root);assert.equal(observed.executable,root+'\\usr\\bin\\bash.exe');
});
test('opening a shell validates its directory without requesting a full file listing',async()=>{
 const calls=[];const host=new TerminalHost({notify:()=>{},profiles:async()=>[{id:'bash',executable:'/bin/bash'}],resolveShell:async()=>null,invoke:async(method,args)=>{calls.push({method,args});return method==='projectPath'?{projectId:'a',shellPreference:'bash'}:{absolute:'/fixture'};}});
 host.call=async()=>({state:'running'});await host.request({action:'open',id:'fast',projectId:'a'});
 assert.equal(calls.find(row=>row.method==='browseDirectory').args.includeEntries,false);assert.equal(calls.filter(row=>row.method==='projectPath').length,2);
});
