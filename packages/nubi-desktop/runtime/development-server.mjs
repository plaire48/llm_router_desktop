import {fail} from './files.mjs';
import {terminalReadableText} from './terminal-readable-text.mjs';

function localAddress(value){
 try{
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!url.port||url.username||url.password||url.search||url.hash)return null;
  return url.href;
 }catch{return null;}
}
export function observedServerUrls(output){
 const matches=terminalReadableText(output).match(/https?:\/\/[^\s<>"'`\x1b]+/g)||[];
 return [...new Set(matches.map(value=>localAddress(value.replace(/[),.;]+$/,''))).filter(Boolean))].slice(0,8);
}

// A loopback response is deliberately narrower than process ownership or a
// functioning feature. No command, cookie, redirect or arbitrary network host.
export async function inspectDevServer({taskId,processId,url,signal}){
 this.task(taskId);signal?.throwIfAborted();
 const record=this.processes.records.get(processId)||this.store.get('process:'+processId);
 if(!record||record.taskId!==taskId)fail('process_missing');
 const urls=observedServerUrls(record.output);
 const selected=url===undefined&&urls.length===1?urls[0]:localAddress(url);
 if(url!==undefined&&(!selected||!urls.includes(selected)))fail('server_url_not_observed');
 const base={processId,state:record.state,execution:record.execution||'unknown',urls,responding:false,functionalVerified:false,processOwnership:'not_verified',observedAt:new Date().toISOString()};
 if(record.state!=='running'||record.execution!=='started'||!selected)return {...base,reason:record.state!=='running'?'process_not_running':urls.length>1?'select_observed_url':'server_url_not_observed'};
 try{
  const response=await fetch(selected,{redirect:'error',credentials:'omit',headers:{accept:'text/html,application/json,text/plain;q=0.9'},signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(5000)])});
  const type=response.headers.get('content-type')||'',reader=response.body?.getReader();let text='',bytes=0;
  const decoder=new TextDecoder();
  try{while(reader&&bytes<8192){const part=await reader.read();if(part.done)break;const slice=part.value.subarray(0,8192-bytes);bytes+=slice.length;text+=decoder.decode(slice,{stream:true});}text+=decoder.decode();}
  finally{await reader?.cancel().catch(()=>{});}
  const current=this.processes.records.get(processId)||this.store.get('process:'+processId);
  const running=current?.state==='running'&&current.execution==='started';
  const result={...base,state:current?.state||'unknown',url:selected,status:response.status,contentType:type.slice(0,160),responding:running&&response.ok,
    title:(text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').slice(0,200),
    scope:'http_response_only',instruction:'This URL was observed in this process log; OS listener ownership and application behavior are not verified. Read the actual page and exercise the requested behavior before claiming functional success.'};
  if(current&&running){current.serverObservation=result;this.store.set('process:'+processId,current);}
  return result;
 }catch(error){signal?.throwIfAborted();return {...base,url:selected,reason:error.name==='TimeoutError'?'server_response_timeout':'server_response_unavailable'};}
}
