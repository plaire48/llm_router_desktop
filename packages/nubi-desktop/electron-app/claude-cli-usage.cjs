'use strict';
// Remaining Claude limit through the Claude Code sign-in (user decision 2026-10-14: reuse the CLI login). The CLI keeps
// its OAuth token in ~/.claude/.credentials.json (Windows, Linux) or the macOS keychain; the token is read for one
// request to the usage endpoint the CLI's own /usage uses and is never returned, logged or stored by Nubi.
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFile}=require('node:child_process');
const USAGE_URL='https://api.anthropic.com/api/oauth/usage';
const code=value=>Object.assign(Error(value),{code:value});
function configDir(env=process.env){return env.CLAUDE_CONFIG_DIR||path.join(os.homedir(),'.claude');}
async function readCredentialFile(env){
 try{return JSON.parse(await fs.readFile(path.join(configDir(env),'.credentials.json'),'utf8'));}
 catch(error){if(error.code==='ENOENT')return null;throw code('claude_cli_credentials');}
}
function readKeychain(){
 return new Promise(resolve=>{execFile('security',['find-generic-password','-s','Claude Code-credentials','-w'],{timeout:10000},(error,stdout)=>{if(error)return resolve(null);try{resolve(JSON.parse(String(stdout).trim()));}catch{resolve(null);}});});
}
async function readToken({platform=process.platform,env=process.env}={}){
 const record=(await readCredentialFile(env))||(platform==='darwin'?await readKeychain():null);
 const oauth=record?.claudeAiOauth;
 const token=typeof oauth?.accessToken==='string'?oauth.accessToken.trim():'';
 if(!token)throw code('claude_cli_login');
 if(Number.isFinite(oauth.expiresAt)&&oauth.expiresAt<Date.now())throw code('claude_cli_expired');
 return token;
}
const percent=value=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,Math.min(100,value)):null;
function window(entry){
 if(!entry||typeof entry!=='object')return null;
 const used=percent(entry.utilization);if(used==null)return null;
 return {used,remaining:Math.round((100-used)*10)/10,resetsAt:typeof entry.resets_at==='string'?entry.resets_at:null};
}
function createClaudeCliUsage({fetchImpl=globalThis.fetch,platform=process.platform,env=process.env,now=Date.now}={}){
 let last=null;
 return {
  async read(){
   const token=await readToken({platform,env});
   let response;
   try{response=await fetchImpl(USAGE_URL,{headers:{Authorization:`Bearer ${token}`,'anthropic-beta':'oauth-2025-04-20',Accept:'application/json'},signal:AbortSignal.timeout(15000)});}
   catch{throw code('claude_cli_request');}
   if(response.status===401||response.status===403)throw code('claude_cli_expired');
   if(!response.ok)throw code('claude_cli_request');
   const data=await response.json().catch(()=>null);
   const fiveHour=window(data?.five_hour),sevenDay=window(data?.seven_day);
   if(!fiveHour&&!sevenDay)throw code('claude_cli_format');
   last={source:'claude_cli',fiveHour,sevenDay,readAt:new Date(now()).toISOString()};
   return last;
  },
  status(){return last;},
 };
}
module.exports={createClaudeCliUsage,readToken,USAGE_URL};
