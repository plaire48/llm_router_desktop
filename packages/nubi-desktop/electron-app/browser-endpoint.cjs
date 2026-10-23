const {readFile}=require('node:fs/promises');
const {get}=require('node:http');

// Endpoint metadata only. No credentials, proxy, DNS, redirect or arbitrary URL.
function checkedBrowserEndpoint(value){
 if(typeof value!=='string'||value.length>1024||!/^ws:\/\/(?:127\.0\.0\.1|\[::1\]):\d{1,5}\/devtools\/browser\/[A-Za-z0-9-]+$/.test(value))throw Error('browser_connection_unavailable');
 const url=new URL(value);if(+url.port<1||+url.port>65535)throw Error('browser_connection_unavailable');return url.href;
}
async function browserEndpointFile(file){
 const text=await readFile(file,'utf8');
 if(text.length>1024||!/^\d{1,5}\r?\n\/devtools\/browser\/[A-Za-z0-9-]+\r?\n?$/.test(text))throw Error('browser_connection_unavailable');
 const [port,route]=text.trim().split(/\r?\n/);return checkedBrowserEndpoint(`ws://127.0.0.1:${port}${route}`);
}
function listenerBrowserEndpoint({address,port},{signal,timeout=750}={}){
 if(!['127.0.0.1','::1'].includes(address)||!Number.isInteger(port)||port<1||port>65535)return Promise.reject(Error('browser_connection_unavailable'));
 return new Promise((resolve,reject)=>{
  let settled=false,request;const end=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);request?.destroy();error?reject(error):resolve(value);};
  const abort=()=>end(Error('dock_cancelled')),timer=setTimeout(()=>end(Error('browser_connection_unavailable')),timeout);
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}
  request=get({host:address,port,path:'/json/version',agent:false,maxHeaderSize:8192},response=>{
   if(response.statusCode!==200){end(Error('browser_connection_unavailable'));return;}
   const chunks=[];let length=0;response.on('data',chunk=>{length+=chunk.length;if(length>16384)end(Error('browser_connection_unavailable'));else chunks.push(chunk);});response.on('error',()=>end(Error('browser_connection_unavailable')));
   response.on('end',()=>{try{const endpoint=checkedBrowserEndpoint(JSON.parse(Buffer.concat(chunks).toString('utf8')).webSocketDebuggerUrl),url=new URL(endpoint);
    if(+url.port!==port||url.hostname!==(address==='::1'?'[::1]':address))throw Error('browser_connection_unavailable');end(null,endpoint);
   }catch{end(Error('browser_connection_unavailable'));}});
  });request.on('error',()=>end(Error('browser_connection_unavailable')));
 });
}
module.exports={checkedBrowserEndpoint,browserEndpointFile,listenerBrowserEndpoint};
