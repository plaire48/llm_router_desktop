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
// Money arrives in minor units: spend as {amount_minor,currency,exponent}, extra_usage as cents with decimal_places.
// Enterprise plans are limited by spend in dollars, often with no 5-hour or 7-day window (user report 2026-10-14;
// llm_router's dashboard reads the same fields).
function money(value){
 if(!value||typeof value!=='object'||!Number.isFinite(value.amount_minor))return null;
 const exponent=Number.isInteger(value.exponent)?value.exponent:2;
 return {amount:value.amount_minor/10**exponent,currency:typeof value.currency==='string'?value.currency:'USD'};
}
function spending(data){
 const spend=data?.spend;
 if(spend&&typeof spend==='object'){
  const used=money(spend.used),limit=money(spend.limit)||money(spend.cap);
  if(used&&(spend.enabled||limit||used.amount>0))return {used:used.amount,limit:limit?limit.amount:null,remaining:limit?Math.max(0,limit.amount-used.amount):null,currency:used.currency,percent:percent(spend.percent)};
 }
 const extra=data?.extra_usage;
 if(extra&&typeof extra==='object'&&Number.isFinite(extra.monthly_limit)){
  const scale=10**(Number.isInteger(extra.decimal_places)?extra.decimal_places:2),used=(Number(extra.used_credits)||0)/scale,limit=extra.monthly_limit/scale;
  return {used,limit,remaining:Math.max(0,limit-used),currency:typeof extra.currency==='string'?extra.currency:'USD',percent:percent(extra.utilization)};
 }
 return null;
}
// Weekly limits for one model (e.g. "Fable") come only in the limits list.
function scopedWindows(data){
 return (Array.isArray(data?.limits)?data.limits:[]).filter(item=>item?.kind==='weekly_scoped'&&percent(item.percent)!=null).slice(0,6).map(item=>{
  const used=percent(item.percent),name=String(item.scope?.model?.display_name||item.scope?.surface||'').slice(0,40);
  return {label:name?`7일 한도 (${name})`:'7일 한도 (범위)',used,remaining:Math.round((100-used)*10)/10,resetsAt:typeof item.resets_at==='string'?item.resets_at:null};
 });
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
   const fiveHour=window(data?.five_hour),sevenDay=window(data?.seven_day),scoped=scopedWindows(data),spend=spending(data);
   if(!fiveHour&&!sevenDay&&!scoped.length&&!spend)throw code('claude_cli_format');
   last={source:'claude_cli',fiveHour,sevenDay,scoped,spend,readAt:new Date(now()).toISOString()};
   return last;
  },
  status(){return last;},
 };
}
module.exports={createClaudeCliUsage,readToken,USAGE_URL};
