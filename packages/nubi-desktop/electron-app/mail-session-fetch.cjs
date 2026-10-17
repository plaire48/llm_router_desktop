const {Readable}=require('node:stream');

// Electron session.fetch rejects manual redirects before exposing their status.
// Keep Chromium's session/cookies, but expose the redirect without following it.
function mailSessionFetch(session,url,options){
 return new Promise((resolve,reject)=>{
  if(options.signal?.aborted){reject(options.signal.reason);return;}
  const request=require('electron').net.request({session,url,method:options.method,credentials:'include',redirect:'manual'});
  let settled=false;
  const fail=error=>{if(!settled){settled=true;reject(error);}};
  const abort=()=>{fail(options.signal.reason);request.abort();};
  options.signal?.addEventListener('abort',abort,{once:true});
  request.once('close',()=>options.signal?.removeEventListener('abort',abort));
  request.on('error',fail);
  request.on('redirect',(status,_method,location)=>{
   if(settled)return;
   settled=true;resolve(new Response(null,{status,headers:{location}}));request.abort();
  });
  request.on('response',response=>{
   if(settled){request.abort();return;}
   try{
    const headers=new Headers();for(const [key,value] of Object.entries(response.headers))for(const item of Array.isArray(value)?value:[value])if(typeof item==='string')headers.append(key,item);
    const body=[204,205,304].includes(response.statusCode)?null:Readable.toWeb(response);
    const result=new Response(body,{status:response.statusCode,headers});settled=true;resolve(result);
   }catch(error){fail(error);request.abort();}
  });
  try{for(const [name,value] of Object.entries(options.headers||{}))request.setHeader(name,value);if(options.body)request.end(options.body);else request.end();}catch(error){fail(error);request.abort();}
 });
}
module.exports={mailSessionFetch};
