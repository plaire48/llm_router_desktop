const path=require('node:path');
const {access}=require('node:fs/promises');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const lookupDefault=promisify(execFile);

// Shared discovery only. Neither caller executes a profile or changes PATH.
async function powerShellExecutable({env=process.env,exists=access,lookup=lookupDefault}={}){
 const candidates=[path.win32.join(env.ProgramFiles||'C:\\Program Files','PowerShell','7','pwsh.exe')];
 try{await exists(candidates[0]);return candidates[0];}catch{}
 try{const result=await lookup('where.exe',['pwsh.exe'],{windowsHide:true,timeout:2000});candidates.push(...result.stdout.trim().split(/\r?\n/).filter(value=>path.win32.isAbsolute(value)));}catch{}
 const fallback=path.win32.join(env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
 candidates.push(fallback);
 for(const executable of [...new Set(candidates)])try{await exists(executable);return executable;}catch{}
 return fallback; // Spawn reports missing/blocked execution; discovery never invents success.
}
function createShellProfileCache(discover,{ttlMs=30000,now=Date.now}={}){
 let cached;
 return async key=>{
  if(!cached||cached.key!==key||cached.expires<=now()){
   const entry={key,expires:Infinity};cached=entry;
   entry.promise=Promise.resolve().then(discover).then(value=>{entry.expires=now()+ttlMs;return value;},error=>{if(cached===entry)cached=null;throw error;});
  }
  return structuredClone(await cached.promise);
 };
}
module.exports={powerShellExecutable,createShellProfileCache};
