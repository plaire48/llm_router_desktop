const ORIGIN=(()=>{const value=String(process.env.NUBI_MAIL_PORTAL_ORIGIN||'http://kor3.samsung.net');try{const url=new URL(value);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)return url.origin;}catch{}return 'http://kor3.samsung.net';})();
// Accept only the configured mail origin and its same-host HTTP -> HTTPS upgrade.
// Once upgraded, a connection never falls back to HTTP or changes host/port.
function portalOrigin(value,current=ORIGIN){
 try{const url=new URL(value),base=new URL(ORIGIN),active=new URL(current);
  if(url.username||url.password||url.hostname!==base.hostname||url.port!==base.port)return null;
  if(url.origin!==base.origin&&!(base.protocol==='http:'&&url.protocol==='https:'))return null;
  if(active.protocol==='https:'&&url.protocol!=='https:')return null;
  return url.origin;
 }catch{return null;}
}
const PATHS={summary:'/mail/rest/v1/mails/desktop/read/simple',identity:'/mail/rest/v1/mails/userinfo/read',identityPolicy:'/mail/rest/v1/mails/desktop/auth/policy',identityPortal:'/portal/user/rest/v1/get/session/token',folders:'/mail/rest/v1/mails/desktop/folders',list:'/mail/rest/v1/mails/desktop/list/byfolder/new',eml:'/mail/rest/v1/mails/eml/download',approvals:'/approval/rest/v1/desktop/list/getDeskTopApList',approvalItem:'/approval/rest/v1/desktop/getDeskTopApItem'};
function folderKind(name){return /보낸|sent/i.test(name)?'sent':/임시|draft/i.test(name)?'draft':/스팸|spam|junk/i.test(name)?'spam':/휴지통|삭제|trash|deleted/i.test(name)?'trash':/받은|inbox/i.test(name)?'inbox':'other';}
function foldersOf(data){
 if(!Array.isArray(data))throw Error('mail_portal_format');
 return data.slice(0,500).map(item=>{const id=String(item.folderID),name=String(item.folderName||'메일함').slice(0,100);if(!/^\d{1,15}$/.test(id))throw Error('mail_portal_format');return {id,name,mailbox:folderKind(name),total:Number.isSafeInteger(item.mailCount)&&item.mailCount>=0?item.mailCount:null};});
}
function identityOf(data){
 const candidates=[data,data?.data,data?.userInfo,data?.userinfo,data?.user];
 for(const value of candidates){if(!value||typeof value!=='object')continue;const rawId=value.epUserId??value.epUserID??value.userId??value.userID??value.epId??value.epID??value.usrId;const userId=typeof rawId==='string'?rawId.trim():Number.isSafeInteger(rawId)?String(rawId):null;const id=userId||value.email||value.emailAddress||value.receivedAddress;if(typeof id==='string'&&id.trim()&&id.length<=320){const email=value.email||value.emailAddress||value.receivedAddress;return {id:id.trim(),userId:typeof userId==='string'?userId:null,email:typeof email==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null,setCd:typeof value.setCd==='string'?value.setCd.slice(0,100):typeof value.domainSet==='string'?value.domainSet.split('@')[0].slice(0,100):''};}}
 throw Error('mail_portal_identity');
}
// Runs in the portal renderer or through its persistent Chromium session. No cookie/token extraction or copy.
// The portal session endpoint is projected to identity fields only; its token fields never leave this function.
// Only fixed read-only endpoints are admitted, with bounded bodies.
async function portalFetch(input,context=null){
 const origin=context?.origin||'__NUBI_PORTAL_ORIGIN__',paths={summary:'/mail/rest/v1/mails/desktop/read/simple',identity:'/mail/rest/v1/mails/userinfo/read',identityPolicy:'/mail/rest/v1/mails/desktop/auth/policy',identityPortal:'/portal/user/rest/v1/get/session/token',folders:'/mail/rest/v1/mails/desktop/folders',list:'/mail/rest/v1/mails/desktop/list/byfolder/new',eml:'/mail/rest/v1/mails/eml/download',approvals:'/approval/rest/v1/desktop/list/getDeskTopApList',approvalItem:'/approval/rest/v1/desktop/getDeskTopApItem'};
 if(!context&&location.origin!==origin)throw Error('mail_portal_login');
 const route=paths[input.operation];if(!route)throw Error('mail_portal_action');
 const raw=input.operation==='eml',identityPortal=input.operation==='identityPortal';
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);let httpStatus;
 try{
  const query=input.operation==='identityPolicy'?'?svcSectCd=DM':raw||input.operation==='summary'?'?'+new URLSearchParams({folderID:input.folderId,mailSeq:input.seq}):input.operation==='approvals'?'?'+new URLSearchParams({epid:input.userId,pageNum:String(input.page||1)}):'';
  const json=input.operation==='folders'?{topFolderId:'0',setCd:input.setCd||''}:input.operation==='list'?{folderID:Number(input.folderId),refMailSeq:Number(input.cursor||0),topFolderId:'0',setCd:input.setCd||''}:input.operation==='approvalItem'?[{ap:input.ap,ln:input.ln}]:{};
  const response=await (context?.fetch||fetch)((context?origin:'')+route+query,{method:identityPortal?'GET':'POST',credentials:context?'include':'same-origin',redirect:'error',signal:context?.signal?AbortSignal.any([context.signal,controller.signal]):controller.signal,headers:{Accept:raw?'application/octet-stream':'application/json',...(!raw&&!identityPortal&&input.operation!=='approvals'?{'Content-Type':'application/json; charset=utf-8'}:{}),...(input.operation==='approvals'?{'X-EpUserID':input.userId}:{})},...(identityPortal?{}:{body:raw||input.operation==='approvals'||input.operation==='identityPolicy'?'':JSON.stringify(json)})});
  httpStatus=response.status;
  if(!response.ok)await response.body?.cancel();
  if(response.status===404&&['approvals','approvalItem'].includes(input.operation))throw Error('mail_portal_not_found');
  if(response.status===401)throw Error('mail_portal_login');
  if(response.status===403)throw Error(input.operation==='approvals'||input.operation==='approvalItem'?'mail_portal_approval_forbidden':'mail_portal_forbidden');
  if(['approvals','approvalItem'].includes(input.operation)&&[400,415].includes(response.status))throw Error('mail_portal_approval_request');
  if(response.status===429||response.status>=500){
   const error=Error(response.status===429?'mail_portal_rate_limited':'mail_portal_unavailable');
   const value=response.headers.get('retry-after'),seconds=value&&/^\d+$/.test(value)?Number(value)*1000:Date.parse(value)-Date.now();
   if(Number.isFinite(seconds)&&seconds>0)error.retryAfterMs=seconds;
   throw error;
  }
  if(!response.ok)throw Error('mail_portal_request');
  const limit=raw?96*1024*1024:input.operation==='approvalItem'?10*1024*1024:2*1024*1024,reader=response.body?.getReader();if(!reader)throw Error('mail_portal_format');
  const parts=[];let size=0;while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>limit){await reader.cancel();throw Error('mail_size_limit');}parts.push(next.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  const head=new TextDecoder().decode(bytes.subarray(0,8192)).trim();if(/^<!doctype\s+html|^<html|^<head|^<form/i.test(head))throw Error(/<input\b[^>]*\btype\s*=\s*["']?password\b|<form\b[^>]*\baction\s*=\s*["'][^"']*\/loginapp\/(?:login|abnormal-logout|logout)(?:[\/\s\x22\x27?#>]|$)/i.test(head)?'mail_portal_login':'mail_portal_response');
  if(raw){let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return {raw:btoa(binary),size};}
  try{const data=JSON.parse(new TextDecoder().decode(bytes));if(!['identity','identityPolicy','identityPortal'].includes(input.operation))return data;
   const identity={},ids=new Map(),queue=[[data,0]],keys={epuserid:'epUserId',userid:'userId',epid:'epId',usrid:'usrId',email:'email',emailaddress:'emailAddress',receivedaddress:'receivedAddress',setcd:'setCd',setcode:'setCd',domainsetcode:'setCd',domainset:'domainSet'};
   let visited=0;while(queue.length&&visited++<80){const [value,depth]=queue.shift();if(!value||typeof value!=='object'||Array.isArray(value)||depth>3)continue;for(const [key,raw] of Object.entries(value)){const canonical=keys[key.toLowerCase()];if(canonical&&(typeof raw==='string'||Number.isSafeInteger(raw))){const text=String(raw).trim();if(text&&text.length<=320){if(['epUserId','userId','epId','usrId'].includes(canonical)){if(!ids.has(canonical))ids.set(canonical,new Set());ids.get(canonical).add(text);}if(!identity[canonical])identity[canonical]=text;}}else if(/^(data|result|userinfo|user|sessioninfo|loginuser|memberinfo|policy|authentication)$/i.test(key))queue.push([raw,depth+1]);}}
   if([...ids.values()].some(values=>values.size>1))for(const key of ['epUserId','userId','epId','usrId'])delete identity[key];
   return identity;}catch{throw Error('mail_portal_format');}
 }catch(error){
  const failure=context?.signal?.aborted?Error('mail_cancelled'):controller.signal.aborted||error.name==='AbortError'?Error('mail_portal_timeout'):/^mail_[a-z_]+$/.test(error.message)?error:/ERR_CERT_|CERT_|TLS|SSL/i.test(error.message||'')?Error('mail_tls_error'):Error('mail_portal_request');
  if(httpStatus)failure.httpStatus=httpStatus;
  // executeJavaScript discards Error properties. Return a fixed envelope only for approval reads.
  if(input.reportFailure&&['approvals','approvalItem'].includes(input.operation))return {__nubiPortalError:failure.message,...(httpStatus?{httpStatus}:{})};
  throw failure;
 }finally{clearTimeout(timer);}
}
const LOGIN_URL=(()=>{const value=String(process.env.NUBI_MAIL_PORTAL_LOGIN_URL||new URL('/portalapp/home',ORIGIN).href);try{const url=new URL(value);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)return url.href;}catch{}return new URL('/portalapp/home',ORIGIN).href;})();
// Source text for the page: the configured origin takes the placeholder's place (the function is serialised, so it cannot close over ORIGIN).
// The bundler may rewrite the placeholder's quotes, so either quote is matched; a source that kept the placeholder
// would treat every page as signed out (user report 2026-10-14: login finished, "확인 중" forever), so it fails instead.
const portalFetchSource=(origin=ORIGIN)=>{
 if(!portalOrigin(origin))throw Error('mail_portal_login');
 const source=portalFetch.toString().replace(/(["'`])__NUBI_PORTAL_ORIGIN__\1/,JSON.stringify(origin));
 if(source.includes('__NUBI_PORTAL_ORIGIN__'))throw Error('mail_portal_request');
 return source;
};
module.exports={portalOrigin,ORIGIN,LOGIN_URL,PATHS,folderKind,foldersOf,identityOf,portalFetch,portalFetchSource};
