import path from 'node:path';
import {readSource,listFiles,relativeFile,fail} from './files.mjs';
import {runCodeAnalysis} from './code-quality.mjs';

// Closed source snapshot. The compiler never executes project configuration,
// plugins, hooks or a language server. Normal source/secret boundaries apply.
export async function inspectCode({taskId,path:file,mode='diagnostics',line=1,column=1,signal}){
 if(!['diagnostics','definition','references'].includes(mode)||!Number.isSafeInteger(line)||line<1||!Number.isSafeInteger(column)||column<1)fail('code_position_invalid');
 relativeFile(file);
 if(!/\.[cm]?[jt]sx?$/i.test(file))fail('code_language_unavailable');
 const root=await this.target(taskId),target=await readSource(root,file,{maxBytes:256*1024});
  const directory=path.posix.dirname(file);
  const listing=await listFiles(root),candidates=[file,...listing.paths.filter(name=>name!==file&&/\.[cm]?[jt]sx?$/i.test(name)).sort((a,b)=>Number(path.posix.dirname(b)===directory)-Number(path.posix.dirname(a)===directory)||a.localeCompare(b))];
 const files=[target];let bytes=Buffer.byteLength(target.content),skipped=0;
 for(const rel of candidates.slice(1)){
  signal?.throwIfAborted();
  if(files.length>=200){skipped++;continue;}
  try{const source=await readSource(root,rel,{maxBytes:256*1024}),size=Buffer.byteLength(source.content);if(bytes+size>4*1024*1024){skipped++;continue;}files.push(source);bytes+=size;}catch{skipped++;}
 }
 const result=await runCodeAnalysis({mode:'intelligence',operation:mode,path:file,line,column,files},{signal,timeoutMs:15000});
 signal?.throwIfAborted();
  if(result.error)fail(['cancelled','code_position_invalid'].includes(result.error)?result.error:'quality_unavailable');
 if((await readSource(root,file)).hash!==target.hash)fail('source_stale');
 return {...result,path:file,hash:target.hash,editObservation:false,
  coverage:{admittedFiles:files.length,skippedFiles:skipped,bytes,incomplete:listing.truncated||skipped>0||result.unresolvedImports>0},
  sources:files.filter(source=>source.path===file||result.locations?.some(row=>row.path===source.path)).map(({path,hash})=>({path,hash})),
  instruction:'Static JS/TS snapshot only, not a build/test pass or edit authorization. Standard libraries, installed dependencies, tsconfig aliases and unsaved editor buffers are not loaded. Missing imports remain unresolved. Read the relevant current source ranges before editing and execute the project typecheck/tests for full validation.'};
}
