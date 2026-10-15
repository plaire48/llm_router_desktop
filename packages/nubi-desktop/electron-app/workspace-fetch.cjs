const {workspaceTransferLimit}=require('./workspace-transfer.cjs');
// Company credentials stay in the host. In-flight results belong to the sign-in that started them.
function createWorkspaceFetch(account,{fetcher=fetch}={}){
 let ghesCredentialCache=null;
 return async function workspaceFetch(args={}){
   const GHES_ORIGIN='https://code.sdsdev.co.kr';let target;try{target=new URL(String(args.url||''));}catch{throw Error('ghes_url_invalid');}
   if(target.origin!==GHES_ORIGIN||target.username||target.password)throw Error('ghes_url_invalid');
   const route=target.pathname;const allowed=/^\/api\/v3\/repos\/Manufacturing-IT\/ai_workspace(?:\/|$)/.test(route)||route==='/api/graphql'||route==='/api/v3/user'||/^\/api\/v3\/user\/[1-9]\d*$/.test(route)||/^\/api\/v3\/users\/[^/]+(?:\/|$)/.test(route)||/^\/api\/v3\/search\/users$/.test(route)||/^\/api\/v3\/orgs\/Manufacturing-IT\//.test(route)||/^\/api\/v3\/user\/orgs$/.test(route);
   if(!allowed)throw Error('ghes_route_denied');
   const methodName=String(args.method||'GET').toUpperCase();if(!['GET','POST','PUT','PATCH','DELETE'].includes(methodName))throw Error('method_invalid');
   // A verified credential is reused for two minutes of the same sign-in: verifying it re-reads the profile, which
   // doubled every Talk, 문의 and app request and failed them all when that read hiccuped (2026-10-14).
   let credential=null;
   if((await account.status()).connected){
    const generation=account.generation;
    if(ghesCredentialCache&&ghesCredentialCache.generation===generation&&Date.now()-ghesCredentialCache.at<120000)credential=ghesCredentialCache;
    else{credential={...await account.credential(),at:Date.now()};ghesCredentialCache=credential;}
   }else ghesCredentialCache=null;
   if(!credential?.token)throw Error('ghes_login_required');
   const active=()=>{if(account.generation!==credential.generation||account.state!=='connected')throw Error('ghes_session_changed');};
   active();
   const headers={};for(const [key,value] of Object.entries(args.headers||{}))if(typeof value==='string'&&!/^(authorization|cookie|host)$/i.test(key))headers[key]=value;
   headers.Authorization='Bearer '+credential.token;if(!headers.Accept&&!headers.accept)headers.Accept='application/vnd.github+json';
   let body;if(args.body!=null){const text=String(args.body);if(Buffer.byteLength(text)>workspaceTransferLimit(route,24*1024*1024))throw Error('ghes_body_limit');body=args.bodyEncoding==='base64'?Buffer.from(text,'base64'):text;}
   const deadline=AbortSignal.timeout(60000);
   try{
   const response=await fetcher(target.href,{method:methodName,headers,body,redirect:['manual','error'].includes(args.redirect)?args.redirect:'follow',cache:'no-store',credentials:'omit',signal:AbortSignal.any([account.accessController.signal,deadline])});
   active();if(response.status===401)ghesCredentialCache=null;
   const chunks=[];let size=0;const reader=response.body?.getReader();if(reader){while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>workspaceTransferLimit(route,32*1024*1024)){await reader.cancel();throw Error('ghes_response_limit');}chunks.push(next.value);}}
   active();const out={};for(const [key,value] of response.headers.entries())if(!/^set-cookie$/i.test(key))out[key]=value;
   return {status:response.status,statusText:response.statusText,headers:out,url:response.url,body:Buffer.concat(chunks.map(c=>Buffer.from(c))).toString('base64')};
   }catch(error){
    active();
    if(/^ghes_[a-z_]+$/.test(error?.message||''))throw error;
    // Keep a safe actionable code across IPC, including a response stream that breaks after headers.
    // Do not retry: a write may already have reached GHES.
    throw Error(deadline.aborted?'ghes_timeout':'ghes_network');
   }
 };
}
module.exports={createWorkspaceFetch};
