const {fork,execFile}=require('node:child_process');
const {access}=require('node:fs/promises');
const path=require('node:path');
const {promisify}=require('node:util');
const exec=promisify(execFile);
const {POWERSHELL_UTF8_PREFIX}=require('../runtime/powershell-encoding.mjs');
const {powerShellExecutable}=require('../runtime/shell-discovery.cjs');
// Initialize only this interactive shell. Query its actual version for the
// banner; keep the normal prompt and never change system locale or profiles.
const powershellStartup=POWERSHELL_UTF8_PREFIX+"Write-Host ('PowerShell ' + $PSVersionTable.PSVersion.ToString())";
async function interactiveShell(profile,{platform=process.platform,env=process.env,exists=access,lookup=exec,verifiedExecutable}={}){
 if(profile==='powershell'&&platform==='win32'){
  const executable=verifiedExecutable||await powerShellExecutable({env,exists,lookup});
  return {executable,argv:['-NoLogo','-NoProfile','-NoExit','-OutputFormat','Text','-EncodedCommand',Buffer.from(powershellStartup,'utf16le').toString('base64')]};
 }else if(profile==='cmd'&&platform==='win32')return {executable:path.win32.join(env.SystemRoot||'C:\\Windows','System32','cmd.exe'),argv:['/D']};
 return null;
}
class TerminalHost{
 constructor({invoke,notify,workerFile,profiles,resolveShell=interactiveShell,spawnWorker=fork,onDiagnostic=()=>{}}){this.spawnWorker=spawnWorker;this.onDiagnostic=onDiagnostic;this.resolveShell=resolveShell;this.profiles=profiles;this.invoke=invoke;this.notify=notify;this.workerFile=workerFile;this.pending=new Map();this.next=0;this.sessions=new Map();this.opens=new Map();this.generation=0;}
 start(){if(this.worker)return;const child=this.spawnWorker(this.workerFile,[],{execArgv:[],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','ignore','ignore','ipc']});this.worker=child;
  child.on('message',message=>{if(message.diagnostic){const {id,phase,pending}=message.diagnostic;if(typeof id==='string'&&/^[-\w]{1,80}$/.test(id)&&['spawn_start','spawn_done','resize_start','resize_done','output_paused','output_resumed'].includes(phase))this.onDiagnostic({id,phase,...(Number.isSafeInteger(pending)?{pending}:{})});return;}if(message.event){this.notify(message.event);return;}const pending=this.pending.get(message.requestId);if(!pending)return;this.pending.delete(message.requestId);message.error?pending.reject(Error(message.error)):pending.resolve(message.result);});
  const failed=()=>{if(this.worker!==child)return;this.worker=null;for(const pending of this.pending.values())pending.reject(Error('terminal_disconnected'));this.pending.clear();for(const id of this.sessions.keys())this.notify({id,type:'disconnected'});this.sessions.clear();};child.on('error',failed);child.on('exit',failed);
 }
 call(action,args){this.start();return new Promise((resolve,reject)=>{const requestId=++this.next;this.pending.set(requestId,{resolve,reject});this.worker.send({requestId,action,args},error=>{if(error){this.pending.delete(requestId);reject(Error('terminal_disconnected'));}});});}
 async request(args){
  const {action='open',id,projectId}=args||{};
  if(typeof id!=='string'||!/^[-\w]{1,80}$/.test(id)||typeof projectId!=='string')throw Error('terminal_session_missing');
  if(action==='open'){
   if(this.opens.has(id)){const opening=this.opens.get(id);if(opening.projectId!==projectId)throw Error('terminal_session_missing');return opening;}
   if(this.opens.size+this.sessions.size>=12&&!this.sessions.has(id))throw Error('terminal_session_limit');
   const opening=this.open(args);opening.projectId=projectId;this.opens.set(id,opening);try{return await opening;}finally{if(this.opens.get(id)===opening)this.opens.delete(id);}
  }
  if(this.opens.has(id)){const opening=this.opens.get(id);if(opening.projectId!==projectId)throw Error('terminal_session_missing');await opening;}
  if(this.sessions.get(id)!==projectId)throw Error('terminal_session_missing');
  if(!['input','resize','ack','detach','close'].includes(action))throw Error('method_invalid');
  const result=await this.call(action,args);if(action==='close')this.sessions.delete(id);return result;
 }
 async open(args){
  const {id,projectId}=args,generation=this.generation;
  const trace=phase=>this.onDiagnostic({id,phase});trace('project');
  const configuration=await this.invoke('projectPath',{projectId});
  if(generation!==this.generation)throw Error('terminal_disconnected');
  const existing=this.sessions.get(id);if(existing&&existing!==projectId)throw Error('terminal_session_missing');
  if(existing)return this.call('open',{id,projectId});
  trace('directory');const location=await this.invoke('browseDirectory',{projectId,path:args.path||'',includeEntries:false});
  trace('profiles');const profile=(await this.profiles()).find(item=>item.id===(args.profile||configuration.shellPreference||(process.platform==='win32'?'powershell':'bash')));if(!profile)throw Error('shell_unavailable');
  trace('shell');const shell=await this.resolveShell(profile.id,{verifiedExecutable:profile.executable})||{executable:profile.executable,argv:profile.id==='bash'?['--noprofile','--norc','-i']:[]};
  if(!shell.executable)throw Error('shell_unavailable');
  // Folder/model work may have changed while shell discovery was pending.
  trace('revalidate');await this.invoke('projectPath',{projectId});
  if(generation!==this.generation)throw Error('terminal_disconnected');
  trace('worker');const result=await this.call('open',{id,projectId,cwd:location.absolute,...shell,...(profile.gitBashRoot?{gitBashRoot:profile.gitBashRoot}:{}),cols:args.cols,rows:args.rows});this.sessions.set(id,projectId);trace('opened');return result;
 }
 dispose(){this.generation++;this.opens.clear();const child=this.worker;this.worker=null;for(const pending of this.pending.values())pending.reject(Error('terminal_disconnected'));this.pending.clear();this.sessions.clear();if(child?.connected)child.disconnect();}
}
module.exports={TerminalHost,interactiveShell};
