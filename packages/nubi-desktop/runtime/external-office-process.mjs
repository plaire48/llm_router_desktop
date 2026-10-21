import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

const methods=new Set(['bind_document','office_capture_template','inspect_office','execute_office_operations','calculate_office','save_document','list_checkpoints','restore_checkpoint','window_identity']);
const validDocument=c=>typeof c?.documentId==='string'&&c.documentId.length>0&&c.documentId.length<=160&&typeof c.documentTitle==='string'&&c.documentTitle.length<=300;
const validChoices=rows=>Array.isArray(rows)&&rows.length>0&&rows.length<=64&&new Set(rows.map(r=>r?.candidateId)).size===rows.length&&rows.every(r=>/^[a-f0-9]{32}$/.test(r?.candidateId)&&typeof r.documentTitle==='string'&&r.documentTitle.length<=300&&Number.isInteger(r.windowNumber)&&r.windowNumber>0&&r.windowNumber<=64);
const code=value=>typeof value==='string'&&/^[a-z][a-z_]{2,70}$/.test(value)?value:'native_office_call_failed';
// A private inherited stdio channel, never an HTTP listener, shell command or
// model-selected executable. A broken channel is retired, not reconnected.
export async function openOfficeProcess({app,executable,platform=process.platform,spawnProcess=spawn,timeoutMs=120000,startupMs=20000,onExit=()=>{}}){
 if(platform!=='win32')throw Error('native_office_windows_required');
 if(!['word','excel','powerpoint'].includes(app)||!path.isAbsolute(executable))throw Error('native_office_host_invalid');
 const child=spawnProcess(executable,[app],{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'],cwd:path.dirname(executable)});
 let ended=false,ready=false,metadata,pending,sequence=0,buffer='',resolveReady,rejectReady;
 const opening=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
 const errorFor=(reason,mutating=false)=>Object.assign(Error(code(reason)),{writeResultUncertain:mutating,actionIssued:mutating});
 function retire(reason='native_office_closed'){
  if(ended)return;ended=true;clearTimeout(startTimer);
  if(pending){const item=pending;pending=null;clearTimeout(item.timer);item.signal?.removeEventListener('abort',item.abort);item.reject(errorFor(reason,item.mutating));}
  if(!ready)rejectReady(errorFor(reason));
  child.kill();try{onExit(reason);}catch{}
 }
 const startTimer=setTimeout(()=>retire('native_office_start_timeout'),startupMs);
 child.on('error',()=>retire('native_office_host_unavailable'));child.on('close',()=>retire());
 // Drain diagnostics without retaining document contents in logs or UI.
 child.stderr.on('data',()=>{});child.stdin.on('error',()=>retire());
 child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
  if(ended)return;buffer+=chunk.toString('utf8');
  if(Buffer.byteLength(buffer)>2000000){retire('native_office_frame_limit');return;}
  while(buffer.includes('\n')&&!ended){const end=buffer.indexOf('\n'),line=buffer.slice(0,end);buffer=buffer.slice(end+1);let frame;
   try{frame=JSON.parse(line);}catch{retire('native_office_protocol_invalid');return;}
   if(!ready){
    const c=frame?.connection;
    if(frame?.type==='startup_error'){retire(code(frame.error));return;}
    if(frame?.type!=='ready'||frame.protocol!==1||typeof frame.sessionId!=='string'||!frame.sessionId||frame.sessionId.length>100||c?.app!==app||!(c.selectionRequired===true?validChoices(c.documents):validDocument(c))){retire('native_office_protocol_invalid');return;}
    metadata={environment:'windows-office',app,documentId:c.documentId,documentTitle:c.documentTitle,selectionRequired:c.selectionRequired===true,documents:c.selectionRequired===true?c.documents.map(({candidateId,documentTitle,windowNumber})=>({candidateId,documentTitle,windowNumber})):undefined,officeSessionId:frame.sessionId,officeVersion:typeof c.officeVersion==='string'?c.officeVersion.slice(0,40):''};ready=true;clearTimeout(startTimer);resolveReady();continue;
   }
   const item=pending;
   if(frame?.type!=='result'||frame.sessionId!==metadata.officeSessionId||!item||frame.id!==item.id||frame.sequence!==item.sequence||Object.hasOwn(frame,'result')===Object.hasOwn(frame,'error')){retire('native_office_protocol_invalid');return;}
   pending=null;clearTimeout(item.timer);item.signal?.removeEventListener('abort',item.abort);
   if(item.name==='bind_document'){
    const c=frame.result;
    if(frame.error||!validDocument(c)||c.app!==app||c.candidateId!==item.candidateId){item.reject(errorFor(frame.error||'native_office_protocol_invalid'));retire('native_office_selection_changed');continue;}
    Object.assign(metadata,{documentId:c.documentId,documentTitle:c.documentTitle,officeVersion:typeof c.officeVersion==='string'?c.officeVersion.slice(0,40):'',selectionRequired:false,documents:undefined});
   }
   frame.error?item.reject(errorFor(frame.error,item.mutating)):item.resolve(frame.result);
  }
 });
 await opening;
 const api={isAlive:()=>!ended,close:()=>retire(),async call(name,input,signal){
  signal?.throwIfAborted();if(ended)throw errorFor('native_office_closed');if(pending)throw errorFor('native_office_busy');if(!methods.has(name))throw errorFor('native_office_method_invalid');
  if(name==='bind_document'){if(!metadata.selectionRequired||!metadata.documents.some(row=>row.candidateId===input?.candidateId))throw errorFor('native_office_selection_changed');}
  else if(metadata.selectionRequired)throw errorFor('native_office_selection_required');
  const message={type:'call',sessionId:metadata.officeSessionId,id:randomUUID(),sequence:sequence+1,name,input};
  const encoded=JSON.stringify(message);if(encoded.length>300000)throw errorFor('native_office_input_limit');
  return new Promise((resolve,reject)=>{
   const item={resolve,reject,id:message.id,sequence:++sequence,signal,name,candidateId:input?.candidateId,mutating:['execute_office_operations','save_document','restore_checkpoint'].includes(name)};
   item.abort=()=>retire('native_office_cancelled');item.timer=setTimeout(()=>retire('native_office_timeout'),timeoutMs);pending=item;signal?.addEventListener('abort',item.abort,{once:true});
   child.stdin.write(encoded+'\n',error=>{if(error)retire();});
  });
 }};
 for(const key of Object.keys(metadata))Object.defineProperty(api,key,{enumerable:true,get:()=>metadata[key]});
 return api;
}
