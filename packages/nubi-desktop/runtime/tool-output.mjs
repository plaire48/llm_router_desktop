// Oversized tool output adopted from opencode (MIT License, Copyright (c) 2025 opencode), packages/core/src/tool-output.ts
// at commit d93568f3. The model receives the first whole lines within 2000 lines and 50 KiB plus one marker naming
// a retained file that holds the whole output; nothing is silently dropped. Saved files expire after seven days.
// See THIRD-PARTY-NOTICES.md.
import {randomBytes} from 'node:crypto';
import {mkdir,readdir,stat,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
export const TOOL_OUTPUT_MAX_LINES=2000;
export const TOOL_OUTPUT_MAX_BYTES=50*1024;
export const TOOL_OUTPUT_RETENTION_MS=7*24*60*60*1000;
const SAVED=/^tool_[0-9a-f]{12}/;
export const TOOL_OUTPUT_ID=/^tool_[0-9a-f]{12}$/;
export const toolOutputFileName=()=>'tool_'+randomBytes(6).toString('hex');
// reader: how the model reads the saved file back, appended to opencode's marker (nubi reads it by id, not by path).
export async function truncateToolOutput(text,{directory,maxLines=TOOL_OUTPUT_MAX_LINES,maxBytes=TOOL_OUTPUT_MAX_BYTES,name=toolOutputFileName(),reader}={}){
 const value=String(text??'');
 const lines=value.split('\n');
 if(value.endsWith('\n'))lines.pop();
 if(lines.length<=maxLines&&Buffer.byteLength(value,'utf8')<=maxBytes)return {text:value,truncated:false};
 const kept=[];let bytes=0;
 for(const line of lines.slice(0,maxLines)){
  const size=Buffer.byteLength(line,'utf8')+(kept.length>0?1:0);
  if(bytes+size>maxBytes)break;
  kept.push(line);bytes+=size;
 }
 await mkdir(directory,{recursive:true});
 const outputPath=path.join(directory,name);
 await writeFile(outputPath,value,{mode:0o600});
 const shown=kept.length>0?`lines 1-${kept.length}`:'0 lines';
 const marker=`[showing ${shown} of ${lines.length}; full output saved to ${outputPath}${reader?'; '+reader(name):''}]`;
 return {text:kept.length?kept.join('\n')+'\n'+marker:marker,truncated:true,outputPath};
}
export async function cleanupToolOutputs(directory,{now=Date.now(),retentionMs=TOOL_OUTPUT_RETENTION_MS}={}){
 const entries=await readdir(directory).catch(()=>[]);let removed=0;
 for(const name of entries){
  if(!SAVED.test(name))continue;
  const file=path.join(directory,name);
  const info=await stat(file).catch(()=>null);
  if(info&&now-info.mtimeMs>retentionMs){await rm(file,{force:true});removed++;}
 }
 return removed;
}
// Task-owned outputs live in the project store; read_process_output reads them back by id for the same task only.
export const toolOutputDirectory=service=>path.join(service.store.directory,'tool-output');
let swept=false;
export async function saveTaskToolOutput(service,taskId,text,limits={}){
 const directory=toolOutputDirectory(service);
 if(!swept){swept=true;cleanupToolOutputs(directory).catch(()=>{});}
 const result=await truncateToolOutput(text,{...limits,directory,reader:id=>`read it with read_process_output processId "${id}"`});
 if(!result.truncated)return {text:result.text};
 const outputId=path.basename(result.outputPath);
 service.store.set('tool-output:'+outputId,{id:outputId,taskId,createdAt:new Date().toISOString()});
 return {text:result.text,outputId};
}
