const {readFile,readdir}=require('node:fs/promises');
const path=require('node:path');
const {execFile}=require('node:child_process');
// Fixed read-only metadata projection. Never print command lines, URLs,
// authentication stores, cookies, profile bodies or policy values to logs.
function samsungInstallation({execute=execFile}={}){
 const script="$ErrorActionPreference='Stop'; $p=Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -in @('browser','samsunginternet') } | ForEach-Object { try { $f=$_.Path; $v=[System.Diagnostics.FileVersionInfo]::GetVersionInfo($f); if($v.CompanyName -match 'Samsung' -or $v.ProductName -match 'Samsung'){ $f } } catch {} } | Select-Object -First 1; $d=$null; foreach($k in @('HKCU:\\Software\\Policies\\Samsung\\Internet','HKLM:\\Software\\Policies\\Samsung\\Internet')){try{$v=Get-ItemProperty -LiteralPath $k -Name UserDataDir -ErrorAction Stop; if($v.UserDataDir){$d=[Environment]::ExpandEnvironmentVariables($v.UserDataDir);break}}catch{}}; @{executable=$p;userDataDir=$d} | ConvertTo-Json -Compress";
 return new Promise((resolve,reject)=>execute('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:8000,maxBuffer:4096},(error,stdout)=>{if(error)return reject(Error('browser_samsung_unavailable'));try{const value=JSON.parse(stdout);resolve({executable:typeof value.executable==='string'&&path.win32.isAbsolute(value.executable)?value.executable:null,userDataDir:typeof value.userDataDir==='string'&&path.win32.isAbsolute(value.userDataDir)?value.userDataDir:null});}catch{reject(Error('browser_samsung_unavailable'));}}));
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
