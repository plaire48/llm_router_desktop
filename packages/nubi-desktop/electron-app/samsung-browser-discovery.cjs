const {readFile,readdir}=require('node:fs/promises');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {POWERSHELL_TEXT_ARGS,POWERSHELL_UTF8_PREFIX}=require('../runtime/powershell-encoding.mjs');
const RESULT='NUBI_BROWSER_DISCOVERY:';
function discoveryError(code,cause){return Object.assign(new Error(code,{cause}),{stage:'browser_discovery',actionIssued:false,exitCode:Number.isInteger(cause?.code)?cause.code:null});}
function discoveryMetadata(stdout){
 const lines=String(stdout||'').replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.startsWith(RESULT));
 if(lines.length!==1)throw Error('browser_samsung_discovery_protocol');
 const value=JSON.parse(lines[0].slice(RESULT.length));
 if(!value||Array.isArray(value)||typeof value!=='object')throw Error('browser_samsung_discovery_protocol');
 for(const key of ['executable','userDataDir'])if(value[key]!==null&&(typeof value[key]!=='string'||value[key].includes('\0')||!path.win32.isAbsolute(value[key])))throw Error('browser_samsung_discovery_protocol');
 return {executable:value.executable,userDataDir:value.userDataDir};
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
 // This fixed read-only helper has a JSON stdout contract. Progress is not
 // protocol data; real errors/exit status remain failures even with a frame.
 const binary=path.win32.join(env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 const encoded=Buffer.from(POWERSHELL_UTF8_PREFIX+"$ProgressPreference='SilentlyContinue';\n"+script,'utf16le').toString('base64');
 return new Promise((resolve,reject)=>execute(binary,[...POWERSHELL_TEXT_ARGS,'-EncodedCommand',encoded],{env,encoding:'utf8',shell:false,windowsHide:true,timeout:8000,maxBuffer:16384},(error,stdout)=>{
  if(error)return reject(discoveryError(error.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER'?'browser_samsung_discovery_protocol':error.killed===true?'browser_samsung_discovery_timeout':'browser_samsung_discovery_failed',error));
  try{resolve(discoveryMetadata(stdout));}catch(cause){reject(discoveryError('browser_samsung_discovery_protocol',cause));}
 }));
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
module.exports={samsungInstallation,samsungPortFile};
