import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {appendFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createClaudeCode} from '../../nubi-desktop/runtime/claude-code.mjs';
import {runHostAuthoringEvaluation} from '../eval/host-authoring.mjs';
const root=resolve(process.argv[2]??'artifacts/host-authoring-2026-10-16-v1');
const runtime=process.env.NUBI_QA_RUNTIME??'/Users/ganadi/.cache/codex-runtimes/codex-primary-runtime/dependencies';
const pptSkill='/Users/ganadi/.codex/plugins/cache/openai-primary-runtime/presentations/26.1009.11318/skills/presentations';
const provider=createClaudeCode({contextWindows:()=>Promise.resolve(new Map())});
const controller=new AbortController();
process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
await mkdir(root,{recursive:true});await mkdir(join(root,'fonts/cache'),{recursive:true});
const fontconfig=join(root,'fonts/fonts.conf');
await writeFile(fontconfig,`<?xml version="1.0"?><fontconfig><dir>/System/Library/Fonts</dir><dir>/System/Library/Fonts/Supplemental</dir><cachedir>${join(root,'fonts/cache')}</cachedir></fontconfig>`,{flag:'wx'});
const connection={startedAt:new Date().toISOString(),adapter:'existing Desktop createClaudeCode',connected:false,modelResponses:0,actualOffice2016:false,nascaVerified:false};
try{
  const status=await provider.connect();connection.connected=status.connected;connection.model=status.model;connection.reasoningEffort=status.reasoningEffort;
  connection.adapterSha256=createHash('sha256').update(await readFile(new URL('../../nubi-desktop/runtime/claude-code.mjs',import.meta.url))).digest('hex');
  await writeFile(join(root,'connection.json'),JSON.stringify(connection,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({event:'host_connected',model:status.model,effort:status.reasoningEffort}));
  const host={id:status.model,async complete(messages,tools,ctx){
    const result=await provider.complete(messages,tools,ctx.signal,ctx.onText,()=>{},ctx.onActivity,{backgroundModel:{provider:'claude',model:ctx.modelId},typedToolArguments:true});
    const resolved=provider.status().models.find(m=>m.id===ctx.modelId)?.resolvedModel??null;
    appendFileSync(join(root,'model-calls.jsonl'),JSON.stringify({requestedModel:ctx.modelId,resolvedModel:resolved,proposedTools:result.calls.map(c=>c.function.name),errorFeedback:messages.filter(m=>m.role==='tool'&&typeof m.content==='string'&&m.content.includes('"isError":true')).length})+'\n');
    if(resolved!==ctx.modelId)throw Error('invalid_model');return result;
  }};
  const verifyArtifact=({domain,path,directory,signal})=>new Promise((resolveReport,reject)=>{
    const child=spawn(join(runtime,'python/bin/python3'),[fileURLToPath(new URL('./qa-host-artifact.py',import.meta.url)),domain,path,directory],{stdio:['ignore','pipe','pipe'],env:{...process.env,NUBI_QA_RUNTIME:runtime,NUBI_PPT_SKILL:pptSkill,FONTCONFIG_FILE:fontconfig,SAL_FONTPATH:'/System/Library/Fonts'}});
    let output='';child.stdout.setEncoding('utf8');child.stdout.on('data',text=>{output+=text;});child.stderr.on('data',()=>{});const abort=()=>child.kill();signal.addEventListener('abort',abort,{once:true});
    child.once('error',()=>reject(Error('local_artifact_verification_failed')));child.once('close',code=>{signal.removeEventListener('abort',abort);if(code!==0){reject(Error('local_artifact_verification_failed'));return;}try{resolveReport(JSON.parse(output));}catch{reject(Error('local_artifact_verification_failed'));}});
  });
  const report=await runHostAuthoringEvaluation({host,output:root,evidence:'live',signal:controller.signal,trials:3,qualityRepairs:1,verifyArtifact,onProgress:event=>{if(event.kind==='model_end'||event.status)console.log(JSON.stringify(event));}});
  console.log(JSON.stringify({event:'evaluation_finished',planned:report.plannedTrials,initialPassed:report.initialPassed,finalPassed:report.finalPassed,modelMeasured:report.modelMeasured}));
}catch(error){
  const code=/^[a-z_]{3,80}$/.test(error?.message??'')?error.message:'host_evaluation_failed';await writeFile(join(root,'blocked.json'),JSON.stringify({error:code,actualModelQualityMeasured:false},null,2)+'\n');console.log(JSON.stringify({event:'evaluation_blocked',error:code}));process.exitCode=1;
}finally{provider.disconnect();}
