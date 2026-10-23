import {spawn, execFile} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,appendFileSync} from 'node:fs';
import {access} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {StringDecoder} from 'node:string_decoder';
import {POWERSHELL_TEXT_ARGS,POWERSHELL_UTF8_PREFIX} from './powershell-encoding.mjs';
import {startElevated,stopElevated} from './elevated-process.mjs';
import {powerShellOutputDecoder,processOutputDiagnostic} from './powershell-output.mjs';
import {stopWindowsProcess} from './windows-process-stop.mjs';
import {windowsBashProcess} from './windows-bash-process.mjs';
import {gitBashProfile,applyGitBashEnvironment} from './git-bash-profile.mjs';
import discovery from './shell-discovery.cjs';
import ptyProcess from './pty-process.cjs';
const {spawnPty}=ptyProcess;
const executeFile=promisify(execFile);
export const hostShell = (platform=process.platform) => platform==='win32'?'powershell':'bash';

export function shellArguments(shell, profile, script, {interactive=false}={}) {
  if(profile==='cmd'){
    const command='chcp 65001>nul & '+script;
    if(command.length>7600)throw Object.assign(new Error('shell_command_limit'),{code:'shell_command_limit'});
    return [...shell.args,command];
  }
  if(profile!=='powershell')return [...shell.args,script];
  // Windows PowerShell otherwise emits the console code page into UTF-8 pipes.
  // EncodedCommand also preserves Korean paths and literal quotes in argv.
  const content=POWERSHELL_UTF8_PREFIX+script;
  const encoded=Buffer.from(content,'utf16le').toString('base64');
  if(encoded.length>28000)throw Object.assign(new Error('shell_command_limit'),{code:'shell_command_limit'});
  return [...POWERSHELL_TEXT_ARGS.filter(arg=>!interactive||arg!=='-NonInteractive'),'-EncodedCommand',encoded];
}

const cachedProfiles=discovery.createShellProfileCache(()=>discoverShellProfiles());
export function shellProfiles(options) {
 if(options!==undefined)return discoverShellProfiles(options);
 return cachedProfiles(JSON.stringify([process.platform,...['ProgramFiles','SystemRoot','LOCALAPPDATA','NUBI_BASH_PATH','PATH'].map(name=>process.env[name])]));
}
async function discoverShellProfiles({platform=process.platform,bashCandidates,env=process.env,exists,lookup}={}) {
  if (platform !== 'win32') return [{id: 'bash', label: 'Bash', executable: '/bin/bash', args: ['--noprofile', '--norc', '-c']}];
  const system32=path.win32.join(env.SystemRoot || 'C:\\Windows','System32');
  const profiles = [{id: 'powershell', label: 'PowerShell', executable: await discovery.powerShellExecutable({env,exists,lookup}), args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']},
    {id:'cmd',label:'CMD',executable:path.win32.join(system32,'cmd.exe'),args:['/D','/Q','/C']}];
  if(!bashCandidates&&!env.NUBI_BASH_PATH){const nativeBash=await gitBashProfile({env,exists});if(nativeBash){profiles.push(nativeBash);return profiles;}}
  const candidates = bashCandidates || [env.NUBI_BASH_PATH, 'C:\\Program Files\\Git\\bin\\bash.exe', path.join(env.LOCALAPPDATA || '', 'Programs/Git/bin/bash.exe')].filter(Boolean);
  for (const executable of candidates) { try { await (exists||access)(executable); profiles.push(await gitBashProfile({env,exists,executable})||{id: 'bash', label: 'Git Bash', executable, args: ['--noprofile', '--norc', '-c']}); break; } catch {} }
  return profiles;
}
export const COMMAND_IDLE_MS = 5 * 60 * 1000;
export const processInputRevision=record=>'sha256:'+createHash('sha256').update(JSON.stringify([record.id,record.startedAt,record.outputBytes||0,record.inputCount||0,record.output])).digest('hex');
export class Processes {
  constructor(store,{onFinished=()=>{},onIdle=()=>{},onActivity=()=>{},idleMs=COMMAND_IDLE_MS,profiles=shellProfiles}={}) { this.store = store; this.active = new Map(); this.records = new Map(); this.pending=new Set();this.preflights=new Map();this.disposed=false;this.onFinished=onFinished;this.onIdle=onIdle;this.onActivity=onActivity;this.idleMs=idleMs;this.idleTimers=new Map();this.profiles=profiles; }
  async start({cwd, script, profile = hostShell(), taskId, timeoutMs = 0,autoDiagnose=true,repairOf,setupActionId,privilege='user',idleCheck=true,terminalRequestId,terminalProjectId,interactive=false,signal}) {
    if(this.disposed)throw new Error('host_disconnected');
    if(signal!=null&&!(signal instanceof AbortSignal))throw new Error('command_invalid');
    if(typeof interactive!=='boolean')throw new Error('command_invalid');
    if(privilege==='administrator'){if(interactive)throw Error('elevation_command_limit');return startElevated(this,{cwd,script,profile,taskId,setupActionId});}
    if(privilege!=='user')throw new Error('elevation_approval_required');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 86400000) throw new Error('timeout_invalid');
    if (typeof script !== 'string' || !script.trim() || script.length > 16000) throw new Error('command_invalid');
    const id = randomUUID(), record = {id, taskId, cwd, profile, script,timeoutMs,idleCheck,interactive,executionMode:interactive?'pty':'pipe',inputCount:0,outputBytes:0,autoDiagnose:autoDiagnose===true,...(repairOf?{repairOf}:{}),...(setupActionId?{setupActionId}:{}),...(terminalRequestId?{terminal:true,terminalRequestId,terminalProjectId}:{}), startedAt: new Date().toISOString(), state: 'checking', execution:'not_started', output: '', exitCode: null};
    const persist=()=>this.store.set('process:'+id,record);
    const finish=()=>{this.clearIdleWatch(id);record.finishedAt=new Date().toISOString();persist();this.store.event('process_finished',{id,state:record.state,exitCode:record.exitCode});try{this.onFinished({...record});}catch{}};
    mkdirSync(path.join(this.store.directory,'logs'),{recursive:true}); record.logPath=path.join(this.store.directory,'logs',id+'.log');
    try{appendFileSync(record.logPath,'');}catch{record.logIncomplete=true;}
    // Credentials belonging to the host are not inherited by development commands.
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/(TOKEN|SECRET|PASSWORD|API_KEY|AUTHORIZATION|CREDENTIAL|^ELECTRON_|^NUBI_|^NODE_OPTIONS$|^NODE_CHANNEL_FD$)/i.test(name)));
    if(interactive){env.TERM='xterm-256color';env.COLORTERM='truecolor';}
    if(process.platform!=='win32'&&!/utf-?8/i.test(env.LC_ALL||env.LC_CTYPE||env.LANG||''))env.LC_CTYPE=process.platform==='darwin'?'UTF-8':'C.UTF-8';
    const preflight=new AbortController();this.preflights.set(id,preflight);this.pending.add(id);this.records.set(id,record);persist();let shell,args,launch;
    const cancel=()=>{record.cancellationRequested=true;record.stopReason='user';preflight.abort();};
    signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
    try{
      shell=(await this.profiles()).find(p=>p.id===profile);if(!shell)throw Object.assign(new Error(),{code:'shell_unavailable'});
      if(process.platform==='win32'&&profile==='bash')applyGitBashEnvironment(env,shell.gitBashRoot);
      args=shellArguments(shell,profile,script,{interactive});record.shellExecutable=shell.executable;
      if(preflight.signal.aborted)throw new Error('cancelled');
      // Parse only: even a syntactically broken script with a valid prefix
      // must not partially execute before the model diagnoses it.
      if(profile==='bash')await executeFile(shell.executable,['--noprofile','--norc','-n','-c',script],{cwd,env,signal:preflight.signal,timeout:3000,maxBuffer:16000,windowsHide:true});
      launch=process.platform==='win32'&&profile==='bash'&&!interactive?await windowsBashProcess(shell.executable,args):{executable:shell.executable,args};
      if(preflight.signal.aborted)throw new Error('cancelled');
    }catch(error){record.state=preflight.signal.aborted?'cancelled':'failed';if(record.state==='failed'){record.fault=['shell_unavailable','shell_command_limit'].includes(error.code)?error.code:error.code==='ENOENT'?'shell_executable_missing':typeof error.code==='number'?'shell_syntax':'shell_preflight_failed';record.output=typeof error.stderr==='string'?error.stderr.slice(-16000):record.fault;}this.records.delete(id);finish();return {...record};}
    finally{signal?.removeEventListener('abort',cancel);this.pending.delete(id);this.preflights.delete(id);}
    record.state='running';record.execution='started';record.lastOutputAt=Date.now();
    let child;
    try{child=interactive?spawnPty(shell.executable,args,{cwd,env}):spawn(launch.executable, launch.args, {cwd, env, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});}
    catch(error){record.state='failed';record.execution='not_started';record.fault=interactive?'pty_start_failed':'shell_spawn_failed';record.output=record.fault;this.records.delete(id);finish();return {...record};}
    this.active.set(id, child); this.records.set(id, record); this.store.set('process:' + id, record);
    const decoders=[new StringDecoder('utf8'),new StringDecoder('utf8')],formatters=[powerShellOutputDecoder(),powerShellOutputDecoder()];
    const retain=text=>{record.output=(record.output+text).slice(-128000);const diagnostic=processOutputDiagnostic({output:text});if(diagnostic)record.outputDiagnostic=diagnostic;else record.outputDiagnostic ||= processOutputDiagnostic(record)||undefined;};
    const append = (data,index) => { try {appendFileSync(record.logPath,data);} catch {record.logIncomplete=true;} record.outputBytes+=data.length;record.lastOutputAt=Date.now();this.outputActivity(record);retain(formatters[index].write(decoders[index].write(data))); this.store.set('process:' + id, record); };
    child.stdout.on('data', data=>append(data,0)); child.stderr.on('data', data=>append(data,1));
    let timer;
    if (timeoutMs > 0) timer = setTimeout(() => this.stop(id,'timeout'), timeoutMs);
    child.on('error', error => { record.state = 'failed';record.execution='not_started';record.fault='shell_spawn_failed'; record.output += '\n' + error.code; this.store.set('process:' + id, record); });
    child.on('close', (code, signal) => { clearTimeout(timer);decoders.forEach((decoder,index)=>retain(formatters[index].write(decoder.end())+formatters[index].end())); record.exitCode = code; record.signal = signal; if (record.stopReason==='timeout'){record.state='timed_out';record.fault='process_timeout';}else if(record.stopReason==='idle_review'){record.state='interrupted';record.fault='process_idle_stopped';}else if (record.cancellationRequested) record.state='cancelled'; else if (record.state === 'running') record.state = code === 0 ? 'completed' : 'failed';if(record.state==='failed')record.fault ||= code===127?'command_not_found':'command_failed';this.active.delete(id); this.records.delete(id);finish(); });
    this.watchIdle(record);this.store.event('process_started', {id, taskId}); return {...record};
  }
  clearIdleWatch(id) { clearTimeout(this.idleTimers.get(id));this.idleTimers.delete(id); }
  watchIdle(record) {
    this.clearIdleWatch(record.id);
    if(this.disposed||record.state!=='running'||!record.taskId||!record.autoDiagnose||record.terminal||record.idleCheck===false||record.idleRequestedAt)return;
    const remaining=this.idleMs-(Date.now()-Math.max(record.lastOutputAt,record.idleWaitAt||0));
    const timer=setTimeout(()=>{
      this.idleTimers.delete(record.id);
      if(record.state!=='running'||this.disposed)return;
      if(Date.now()-Math.max(record.lastOutputAt,record.idleWaitAt||0)<this.idleMs){this.watchIdle(record);return;}
      record.idleRequestedAt=Date.now();this.store.set('process:'+record.id,record);
      try{this.onIdle({...record});}catch{}
    },Math.max(1,remaining));
    timer.unref();this.idleTimers.set(record.id,timer);
  }
  outputActivity(record) {
    if(!record.idleRequestedAt)return;
    delete record.idleRequestedAt;
    try{this.onActivity({...record});}catch{}
    this.watchIdle(record);
  }
  continueWaiting(id) {
    const record=this.records.get(id);
    if(!record||record.state!=='running'||!record.idleRequestedAt)throw Error('question_changed');
    delete record.idleRequestedAt;record.idleWaitAt=Date.now();
    this.store.set('process:'+id,record);this.watchIdle(record);return {...record};
  }
  poll(id) { const item = this.store.get('process:' + id); if (!item) throw new Error('process_missing'); return {...item,...(item.state==='running'?{quietForMs:Date.now()-item.lastOutputAt}:{})}; }
  input(id, value, revision) {
    const child=this.active.get(id),record=this.records.get(id);
    if(!child?.stdin||!record?.interactive||record.state!=='running'||typeof value!=='string'||!value.length||value.length>8000)throw Error('process_input_unavailable');
    if(revision!==processInputRevision(record))throw Error('process_input_changed');
    child.stdin.write(value);record.inputCount++;delete record.serverObservation;this.store.set('process:'+id,record);
    return {accepted:true,processId:id,inputCount:record.inputCount};
  }
  stop(id,reason='user') {
    this.clearIdleWatch(id);
    const preflight=this.preflights.get(id);
    if(preflight){const item=this.records.get(id);item.state='stopping';item.cancellationRequested=true;item.stopReason=reason;this.store.set('process:'+id,item);preflight.abort();return item;}
    const child = this.active.get(id); if (!child) return this.poll(id);
    if(child.nubiElevation)return stopElevated(this,id,child,reason);
    const item = this.records.get(id);if(item.state==='stopping')return item;
    item.state = 'stopping'; item.cancellationRequested=true;item.stopReason=reason; this.store.set('process:' + id, item);
    if (process.platform === 'win32') stopWindowsProcess(child,{isActive:()=>this.active.get(id)===child,onAttempt:attempt=>{item.stopAttempts=attempt;this.store.set('process:'+id,item);},onResult:code=>{item.stopExitCode=code;this.store.set('process:'+id,item);},onUnconfirmed:()=>{item.stopFault='process_stop_unconfirmed';this.store.set('process:'+id,item);}});
    else { try { process.kill(-child.pid, 'SIGTERM'); } catch {} const timer = setTimeout(() => { if (this.active.get(id) === child) {try {process.kill(-child.pid, 'SIGKILL');} catch {}} }, 1500); timer.unref(); }
    return item;
  }
  dispose() { this.disposed=true;for (const id of this.pending) this.stop(id);for (const id of this.active.keys()) this.stop(id); }
}
