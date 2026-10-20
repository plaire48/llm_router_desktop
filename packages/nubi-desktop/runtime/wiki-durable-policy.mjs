import {setTimeout as delay} from 'node:timers/promises';

export const WIKI_RUN_BUDGET_MS=2*60*60*1000;
const waits=[10000,30000,60000,120000,300000];
export const wikiClock=Object.freeze({now:()=>Date.now(),sleep:(ms,signal)=>delay(ms,undefined,{signal})});
export function wikiErrorCode(error){
 const status=error?.status??error?.statusCode;
 if(status===401)return 'unauthorized';if(status===403)return 'forbidden';if(status===400)return 'invalid_request';
 const code=String(error?.code||error?.message||'model_failed');
 return /^[a-z_]{1,80}$/.test(code)?code:'model_failed';
}
export function wikiRetryPolicy(error,{attempt=0,now=Date.now(),deadlineAt=now+WIKI_RUN_BUDGET_MS}={}){
 const reason=wikiErrorCode(error),status=error?.status??error?.statusCode;
 const terminal=[400,401,403].includes(status)||['unauthorized','forbidden','invalid_request','expired_token','cancelled','canceled','no_credential','claude_login_required'].includes(reason)||error?.name==='AbortError';
 if(terminal)return {retry:false,waitMs:0,terminal:true,reason};
 let waitMs=waits[Math.min(waits.length-1,Math.max(0,attempt))];
 if(status===429||reason==='rate_limited'){
   const reset=typeof error?.retryAt==='number'?error.retryAt:Date.parse(error?.retryAt||'');
   const after=Number(error?.retryAfterMs);
   if(Number.isFinite(after)&&after>=0)waitMs=Math.max(waitMs,after);
   if(Number.isFinite(reset))waitMs=Math.max(waitMs,reset-now);
 }
 return {retry:Number.isFinite(deadlineAt)&&now+waitMs<deadlineAt,waitMs,terminal:false,reason:now>=deadlineAt?'wiki_budget_exhausted':reason};
}
