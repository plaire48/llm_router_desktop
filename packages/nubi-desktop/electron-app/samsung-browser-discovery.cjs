const {readFile,readdir}=require('node:fs/promises');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {checkedBrowserEndpoint,browserEndpointFile,listenerBrowserEndpoint}=require('./browser-endpoint.cjs');
const {POWERSHELL_TEXT_ARGS,POWERSHELL_UTF8_PREFIX}=require('../runtime/powershell-encoding.mjs');
const RESULT='NUBI_BROWSER_DISCOVERY:';
function discoveryError(code,cause){return Object.assign(new Error(code,{cause}),{stage:'browser_discovery',actionIssued:false,exitCode:Number.isInteger(cause?.code)?cause.code:null});}
function discoveryMetadata(stdout){
 const value=discoveryFrame(stdout);
 for(const key of ['executable','userDataDir'])if(value[key]!==null&&(typeof value[key]!=='string'||value[key].includes('\0')||!path.win32.isAbsolute(value[key])))throw Error('browser_samsung_discovery_protocol');
 return {executable:value.executable,userDataDir:value.userDataDir};
}
function discoveryFrame(stdout){
 const lines=String(stdout||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.startsWith(RESULT));
 if(lines.length!==1)throw Error('browser_samsung_discovery_protocol');
 const value=JSON.parse(lines[0].slice(RESULT.length));
 if(!value||Array.isArray(value)||typeof value!=='object')throw Error('browser_samsung_discovery_protocol');
 return value;
}
// Fixed read-only metadata projection. Never print command lines, URLs,
// authentication stores, cookies, profile bodies or policy values to logs.
function samsungInstallation({execute=execFile,env=process.env}={}){
 const script=[
  "$ErrorActionPreference='Stop'; $candidates=@(Get-Process -Name browser,samsunginternet,samsungbrowser -ErrorAction SilentlyContinue | ForEach-Object {try{$_.Path}catch{}})",
  "foreach($base in @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths')){foreach($name in @('browser.exe','samsunginternet.exe','samsungbrowser.exe')){try{$candidates+=Get-ItemPropertyValue -LiteralPath ($base+'\\'+$name) -Name '(default)' -ErrorAction Stop}catch{}}}",
  "$p=$null; foreach($f in ($candidates | Select-Object -Unique)){try{$v=[System.Diagnostics.FileVersionInfo]::GetVersionInfo($f);if($v.CompanyName -match 'Samsung' -or $v.ProductName -match 'Samsung'){$p=$f;break}}catch{}}",
  "if(!$p){foreach($base in @($env:LOCALAPPDATA,$env:ProgramFiles,${env:ProgramFiles(x86)})){if(!$base){continue};$vendor=Join-Path $base 'Samsung';if(!(Test-Path -LiteralPath $vendor -PathType Container)){continue};foreach($f in (Get-ChildItem -LiteralPath $vendor -Filter '*.exe' -File -Recurse -Depth 4 -ErrorAction SilentlyContinue | Where-Object {$_.Name -in @('browser.exe','samsunginternet.exe','samsungbrowser.exe')} | Select-Object -First 16)){try{$v=$f.VersionInfo;if($v.CompanyName -match 'Samsung' -or $v.ProductName -match 'Samsung'){$p=$f.FullName;break}}catch{}};if($p){break}}}",
  "$d=$null; foreach($k in @('HKCU:\\Software\\Policies\\Samsung\\Internet','HKLM:\\Software\\Policies\\Samsung\\Internet')){try{$v=Get-ItemProperty -LiteralPath $k -Name UserDataDir -ErrorAction Stop;if($v.UserDataDir){$d=[Environment]::ExpandEnvironmentVariables($v.UserDataDir);break}}catch{}}; [Console]::Out.WriteLine('NUBI_BROWSER_DISCOVERY:'+(@{executable=$p;userDataDir=$d} | ConvertTo-Json -Compress))"
 ].join('; ');
 return runDiscovery(script,{execute,env},discoveryMetadata);
}
function runDiscovery(script,{execute=execFile,env=process.env,signal}={},parse){
 // This fixed read-only helper has a JSON stdout contract. Progress is not
 // protocol data; real errors/exit status remain failures even with a frame.
 const binary=path.win32.join(env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const encoded=Buffer.from(POWERSHELL_UTF8_PREFIX+"$ProgressPreference='SilentlyContinue';\n"+script,'utf16le').toString('base64');
 return new Promise((resolve,reject)=>execute(binary,[...POWERSHELL_TEXT_ARGS,'-EncodedCommand',encoded],{env,signal,encoding:'utf8',shell:false,windowsHide:true,timeout:8000,maxBuffer:16384},(error,stdout)=>{
  if(signal?.aborted)return reject(Error('dock_cancelled'));
  if(error)return reject(discoveryError(error.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER'?'browser_samsung_discovery_protocol':error.killed===true?'browser_samsung_discovery_timeout':'browser_samsung_discovery_failed',error));
  try{resolve(parse(stdout));}catch(cause){reject(discoveryError('browser_samsung_discovery_protocol',cause));}
 }));
}
// Inspect only current-session Samsung processes (or the exact user-selected
// executable) and their existing loopback
// listeners. No launch, command lines, debugging flags or browser state writes.
function samsungRunningBrowser({executable,...options}={}){
 if(executable&&(typeof executable!=='string'||executable.includes('\0')||!path.win32.isAbsolute(executable)||path.win32.extname(executable).toLowerCase()!=='.exe'))return Promise.reject(Error('external_browser_executable_invalid'));
 const script=[
  "$ErrorActionPreference='Stop'; $session=(Get-Process -Id $PID).SessionId; $selected=$env:NUBI_BROWSER_EXECUTABLE; $names=if($selected){@([System.IO.Path]::GetFileNameWithoutExtension($selected))}else{@('browser','samsunginternet','samsungbrowser')}; $browsers=@(Get-Process -Name $names -ErrorAction SilentlyContinue | Where-Object {$_.SessionId -eq $session} | Where-Object {try{if($selected){$_.Path -eq $selected}else{$v=[System.Diagnostics.FileVersionInfo]::GetVersionInfo($_.Path);$v.CompanyName -match 'Samsung' -or $v.ProductName -match 'Samsung'}}catch{$false}})",
  "$listeners=@(); if($browsers.Count){$ids=@($browsers | Select-Object -ExpandProperty Id); $listeners=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object {$_.OwningProcess -in $ids -and $_.LocalAddress -in @('127.0.0.1','::1')} | Sort-Object LocalPort,LocalAddress -Unique | Select-Object -First 8 | ForEach-Object {@{address=$_.LocalAddress;port=[int]$_.LocalPort}})}",
  "$d=$null; foreach($k in @('HKCU:\\Software\\Policies\\Samsung\\Internet','HKLM:\\Software\\Policies\\Samsung\\Internet')){try{$v=Get-ItemProperty -LiteralPath $k -Name UserDataDir -ErrorAction Stop;if($v.UserDataDir){$d=[Environment]::ExpandEnvironmentVariables($v.UserDataDir);break}}catch{}}; [Console]::Out.WriteLine('NUBI_BROWSER_DISCOVERY:'+(@{running=($browsers.Count -gt 0);userDataDir=$d;listeners=$listeners} | ConvertTo-Json -Compress -Depth 4))"
 ].join('; ');
 return runDiscovery(script,{...options,env:{...(options.env||process.env),NUBI_BROWSER_EXECUTABLE:executable||''}},stdout=>{
  const value=discoveryFrame(stdout);
  if(typeof value.running!=='boolean'||!Array.isArray(value.listeners)||value.listeners.length>8||value.userDataDir!==null&&(typeof value.userDataDir!=='string'||value.userDataDir.includes('\0')||!path.win32.isAbsolute(value.userDataDir))||value.listeners.some(v=>!v||!['127.0.0.1','::1'].includes(v.address)||!Number.isInteger(v.port)||v.port<1||v.port>65535))throw Error('browser_samsung_discovery_protocol');
  return {running:value.running,userDataDir:value.userDataDir,listeners:value.listeners.map(({address,port})=>({address,port}))};
 });
}
async function samsungBrowserEndpoint({signal,executable,metadata=samsungRunningBrowser,localAppData=process.env.LOCALAPPDATA}={}){
 const value=await metadata({signal,executable});if(signal?.aborted)throw Error('dock_cancelled');
 if(!value.running)throw Error(executable?'browser_selected_not_running':'browser_samsung_not_running');
 const listeners=value.listeners;
 // Consent-only servers need the discovery route and need not serve HTTP.
 // A stale file cannot direct the connection to another browser's listener.
 try{
  const endpoint=await browserEndpointFile(await samsungPortFile({localAppData,userDataDir:value.userDataDir})),url=new URL(endpoint);
  const owner=listeners.find(x=>x.port===+url.port);if(owner)return checkedBrowserEndpoint(`ws://${owner.address==='::1'?'[::1]':owner.address}:${owner.port}${url.pathname}`);
 }catch{}
 if(signal?.aborted)throw Error('dock_cancelled');
 // Fixed-port Chromium servers do not have to write DevToolsActivePort.
 // Probe only these owned listeners, two at a time, never a port range.
 for(let i=0;i<listeners.length;i+=2){
  const results=await Promise.allSettled(listeners.slice(i,i+2).map(x=>listenerBrowserEndpoint(x,{signal})));
  if(signal?.aborted)throw Error('dock_cancelled');
  const found=results.find(x=>x.status==='fulfilled');if(found)return found.value;
 }
 throw Error(executable?'browser_control_unavailable':'browser_samsung_control_unavailable');
}
async function samsungPortFile({localAppData=process.env.LOCALAPPDATA,userDataDir}={}){
 if(userDataDir){const exact=path.join(userDataDir,'DevToolsActivePort');try{await readFile(exact);return exact;}catch{throw Error('browser_connection_permission_required');}}
 if(!localAppData)throw Error('browser_samsung_unavailable');
 const queue=[{directory:path.join(localAppData,'Samsung'),depth:0}],limit=100;let visited=0;
 while(queue.length&&visited++<limit){const {directory,depth}=queue.shift();
  try{const values=await readdir(directory,{withFileTypes:true});if(values.some(x=>x.name==='DevToolsActivePort'&&x.isFile()))return path.join(directory,'DevToolsActivePort');
   if(depth<4)for(const value of values)if(value.isDirectory()&&!value.isSymbolicLink()&&!['Cache','Code Cache','GPUCache','Default','Guest Profile','System Profile'].includes(value.name)&&!/^Profile \d+$/.test(value.name))queue.push({directory:path.join(directory,value.name),depth:depth+1});
  }catch{}
 }
 throw Error('browser_connection_permission_required');
}
module.exports={samsungInstallation,samsungPortFile,samsungRunningBrowser,samsungBrowserEndpoint};
