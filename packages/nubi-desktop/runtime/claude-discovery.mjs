import {access,readFile,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import os from 'node:os';
const exec=promisify(execFile);
const envValue=(env,key)=>env[Object.keys(env).find(name=>name.toLowerCase()===key.toLowerCase())]||'';
export function claudeSearchDirectories({platform=process.platform,environment=process.env,home=os.homedir(),registeredPath=''}={}){
 const p=platform==='win32'?path.win32:path.posix,delimiter=platform==='win32'?';':':';
 const expand=value=>value.replace(/%([^%]+)%/g,(all,key)=>envValue(environment,key)||all);
 const paths=[...envValue(environment,'PATH').split(delimiter),...registeredPath.split(delimiter),p.join(home,'.local','bin')];
 if(platform==='win32'){
  const appdata=envValue(environment,'APPDATA')||p.join(home,'AppData','Roaming');
  paths.push(p.join(appdata,'npm'),envValue(environment,'npm_config_prefix'));
  const local=envValue(environment,'LOCALAPPDATA')||p.join(home,'AppData','Local');
  paths.push(p.join(local,'Microsoft','WinGet','Links'));
 }
 const seen=new Set();return paths.map(value=>expand(value.trim().replace(/^"(.*)"$/,'$1'))).filter(value=>{
  if(!p.isAbsolute(value)||value.includes('\0'))return false;
  const key=platform==='win32'?value.toLowerCase():value;if(seen.has(key))return false;seen.add(key);return true;
 });
}
export async function windowsRegisteredPath(environment=process.env){
 const root=envValue(environment,'SystemRoot');if(!path.win32.isAbsolute(root))return '';
 const reg=path.win32.join(root,'System32','reg.exe');
 const keys=['HKCU\\Environment','HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'];
 return (await Promise.all(keys.map(async key=>{try{const {stdout}=await exec(reg,['query',key,'/v','Path'],{windowsHide:true,timeout:3000,maxBuffer:65536,encoding:'utf8'});return stdout.match(/\bPath\s+REG_(?:EXPAND_)?SZ\s+([^\r\n]+)/i)?.[1]||'';}catch{return '';}}))).join(';');
}
// Native, WinGet and npm installations keep ownership of credentials and
// updates. Resolve npm's declared bin; do not run .cmd through a shell with
// model-controlled JSON arguments, and never execute package scripts here.
export async function findClaudeBinary({platform=process.platform,environment=process.env,home=os.homedir(),registeredPath,fs={access,readFile,stat}}={}){
 if(registeredPath===undefined)registeredPath=platform==='win32'?await windowsRegisteredPath(environment):'';
 const p=platform==='win32'?path.win32:path.posix,dirs=claudeSearchDirectories({platform,environment,home,registeredPath});let denied=false;
 const exists=async file=>{try{await fs.access(file,platform==='win32'?constants.F_OK:constants.X_OK);return (await fs.stat(file)).isFile();}catch(error){if(['EACCES','EPERM'].includes(error.code))denied=true;return false;}};
 for(const dir of dirs){
  const native=p.join(dir,platform==='win32'?'claude.exe':'claude');if(await exists(native))return native;
  if(platform!=='win32')continue;
  const root=p.basename(dir)==='.bin'?p.join(p.dirname(dir),'@anthropic-ai','claude-code'):p.join(dir,'node_modules','@anthropic-ai','claude-code');
  try{
   const metadata=JSON.parse(await fs.readFile(p.join(root,'package.json'),'utf8'));
   const bin=typeof metadata.bin==='string'?metadata.bin:metadata.bin?.claude;
   if(metadata.name!=='@anthropic-ai/claude-code'||typeof bin!=='string'||p.isAbsolute(bin)||bin.split(/[\\/]/).includes('..')||!(/\.(exe|[cm]?js)$/i.test(bin)))continue;
   const entry=p.join(root,bin);if(await exists(entry))return entry;
  }catch(error){if(['EACCES','EPERM'].includes(error.code))denied=true;}
 }
 throw Error(denied?'claude_cli_unavailable':'claude_cli_missing');
}
export function claudeLaunch(binary,args,{executable=process.execPath,electron=!!process.versions.electron}={}){
 return /\.[cm]?js$/i.test(binary)?{command:executable,args:[binary,...args],environment:electron?{ELECTRON_RUN_AS_NODE:'1'}:{}}:{command:binary,args,environment:{}};
}
