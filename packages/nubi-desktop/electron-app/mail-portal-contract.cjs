const ORIGIN='https://kor3.samsung.net';
const PATHS={summary:'/mail/rest/v1/mails/desktop/read/simple',identity:'/mail/rest/v1/mails/userinfo/read',folders:'/mail/rest/v1/mails/desktop/folders',list:'/mail/rest/v1/mails/desktop/list/byfolder/new',eml:'/mail/rest/v1/mails/eml/download',approvals:'/approval/rest/v1/desktop/list/getDeskTopApList',approvalItem:'/approval/rest/v1/desktop/getDeskTopApItem'};
function folderKind(name){return /보낸|sent/i.test(name)?'sent':/임시|draft/i.test(name)?'draft':/스팸|spam|junk/i.test(name)?'spam':/휴지통|삭제|trash|deleted/i.test(name)?'trash':/받은|inbox/i.test(name)?'inbox':'other';}
function foldersOf(data){
 if(!Array.isArray(data))throw Error('mail_portal_format');
 return data.slice(0,500).map(item=>{const id=String(item.folderID),name=String(item.folderName||'메일함').slice(0,100);if(!/^\d{1,15}$/.test(id))throw Error('mail_portal_format');return {id,name,mailbox:folderKind(name),total:Number.isSafeInteger(item.mailCount)&&item.mailCount>=0?item.mailCount:null};});
}
function identityOf(data){
 const candidates=[data,data?.data,data?.userInfo,data?.userinfo,data?.user];
 for(const value of candidates){if(!value||typeof value!=='object')continue;const userId=value.epUserId||value.epUserID||value.userId||value.userID||value.epId||value.epID||value.usrId;const id=userId||value.email||value.emailAddress||value.receivedAddress;if(typeof id==='string'&&id.trim()&&id.length<=320){const email=value.email||value.emailAddress||value.receivedAddress;return {id:id.trim(),userId:typeof userId==='string'?userId:null,email:typeof email==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null,setCd:typeof value.setCd==='string'?value.setCd.slice(0,100):typeof value.domainSet==='string'?value.domainSet.split('@')[0].slice(0,100):''};}}
 throw Error('mail_portal_identity');
}
// Runs in the logged-in portal's own renderer. No cookie/token read or copy.
// Only the fixed read-only mail endpoints are admitted, with bounded bodies.
async function portalFetch(input){
 const origin='https://kor3.samsung.net',paths={summary:'/mail/rest/v1/mails/desktop/read/simple',identity:'/mail/rest/v1/mails/userinfo/read',folders:'/mail/rest/v1/mails/desktop/folders',list:'/mail/rest/v1/mails/desktop/list/byfolder/new',eml:'/mail/rest/v1/mails/eml/download',approvals:'/approval/rest/v1/desktop/list/getDeskTopApList',approvalItem:'/approval/rest/v1/desktop/getDeskTopApItem'};
 if(location.origin!==origin)throw Error('mail_portal_login');
 const route=paths[input.operation];if(!route)throw Error('mail_portal_action');
 const raw=input.operation==='eml';
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
 try{
  const query=raw||input.operation==='summary'?'?'+new URLSearchParams({folderID:input.folderId,mailSeq:input.seq}):input.operation==='approvals'?'?'+new URLSearchParams({epid:input.userId,pageNum:String(input.page||1)}):'';
  const json=input.operation==='folders'?{topFolderId:'0',setCd:input.setCd||''}:input.operation==='list'?{folderID:Number(input.folderId),refMailSeq:Number(input.cursor||0),topFolderId:'0',setCd:input.setCd||''}:input.operation==='approvalItem'?[{ap:input.ap,ln:input.ln}]:{};
  const response=await fetch(route+query,{method:'POST',credentials:'same-origin',redirect:'error',signal:controller.signal,headers:{Accept:raw?'application/octet-stream':'application/json',...(!raw?{'Content-Type':'application/json; charset=utf-8'}:{}),...(input.operation==='approvals'?{'X-EpUserID':input.userId}:{})},body:raw||input.operation==='approvals'?'':JSON.stringify(json)});
  if([401,403].includes(response.status))throw Error('mail_portal_login');if(!response.ok)throw Error('mail_portal_request');
  const limit=raw||input.operation==='approvalItem'?10*1024*1024:2*1024*1024,reader=response.body?.getReader();if(!reader)throw Error('mail_portal_format');
  const parts=[];let size=0;while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>limit){await reader.cancel();throw Error('mail_size_limit');}parts.push(next.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  const head=new TextDecoder().decode(bytes.subarray(0,512)).trim();if(/^<!doctype\s+html|^<html|^<head|^<form/i.test(head))throw Error('mail_portal_login');
  if(raw){let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return {raw:btoa(binary),size};}
  try{const data=JSON.parse(new TextDecoder().decode(bytes));if(input.operation!=='identity')return data;const identity={};for(const value of [data,data?.data,data?.userInfo,data?.userinfo,data?.user]){if(!value||typeof value!=='object')continue;for(const key of ['epUserId','epUserID','userId','userID','epId','epID','usrId','email','emailAddress','receivedAddress','setCd','domainSet'])if(typeof value[key]==='string'&&!identity[key])identity[key]=value[key].slice(0,320);}return identity;}catch{throw Error('mail_portal_format');}
 }catch(error){if(error.name==='AbortError')throw Error('mail_portal_timeout');if(/^mail_/.test(error.message))throw error;throw Error('mail_portal_request');}finally{clearTimeout(timer);}
}
module.exports={ORIGIN,PATHS,folderKind,foldersOf,identityOf,portalFetch};
