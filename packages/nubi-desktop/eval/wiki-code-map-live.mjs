// Explicit live, synthetic-corpus comparison. Never accepts a user project path.
import {mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createWorkspace} from './corpus.mjs';
import {createClaudeCode,runClaude} from '../runtime/claude-code.mjs';
import {git,hash} from '../runtime/files.mjs';

if(!process.argv.includes('--live'))throw Error('Use --live to run the authenticated model on the pinned synthetic corpus.');
const out=path.resolve('verification/code-wiki-map-2026-10-16');
await mkdir(out,{recursive:true});
process.env.OPENWIKI_CONFIG_DIR=path.join(out,'openwiki-home');
const {defaultWikiUpdater}=await import('../runtime/wiki-update.mjs');
const runtime=await import('../generated/openwiki-update/index.mjs');
let active;
const claude=createClaudeCode({contextWindows:null,run:(binary,args,options)=>runClaude(binary,args,{...options,onEvent:event=>{
  if(active&&event.type==='assistant')for(const part of event.message?.content||[])if(part.type==='tool_use')active.diagnostics.push({kind:'cli_tool',name:part.name,argumentType:typeof part.input});
  if(active&&event.type==='result')active.diagnostics.push({kind:'cli_result',subtype:event.subtype,isError:event.is_error,hasStructuredOutput:!!event.structured_output,calls:Array.isArray(event.structured_output?.calls)?event.structured_output.calls.map(call=>({name:call.name,argumentType:typeof call.arguments,jsonValid:typeof call.arguments==='string'?(()=>{try{JSON.parse(call.arguments);return true;}catch{return false;}})():null})):null});
  options.onEvent?.(event);
}})});
const report=process.argv.includes('--append')?JSON.parse(await readFile(path.join(out,'report.json'),'utf8')):{scope:'Native generations of the same pinned synthetic order-service. One initial trial per variant, not a general quality or speed estimate. Additional attempts retain all earlier failures.',startedAt:new Date().toISOString(),results:[]};
const save=()=>writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
try{
  await claude.connect();claude.model('opus');claude.reasoning('medium');
  report.model={provider:'claude',model:claude.status().model,effort:claude.status().reasoningEffort};await save();
  for(const variant of process.argv.includes('--candidate-only')?['candidate']:['baseline','candidate']){
    const workspace=await createWorkspace({corpus:'order-service'});
    await rm(path.join(workspace.root,'openwiki'),{recursive:true,force:true});
    await git(workspace.root,['add','-A']);await git(workspace.root,['commit','-qm','Evaluate native wiki creation']);
    const sourceFiles=['runtime/wiki-code-map.mjs','runtime/wiki-code-map-core.mjs','runtime/wiki-update.mjs','../openwiki/src/agent/repository-runner.ts','../openwiki/src/agent/repository-prompts.ts'];
    const row={variant,attempt:report.results.filter(row=>row.variant===variant).length+1,implementationHashes:Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,hash(await readFile(file))]))),corpusHash:workspace.corpusHash,workspace:workspace.root,modelCalls:0,toolCalls:0,reads:0,events:[],transcript:[],diagnostics:[]};active=row;
    report.results.push(row);await save();
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12*60*1000),started=Date.now();
    const service={store:{},providers:{status:claude.status,async complete(messages,tools,signal,...rest){
      if(++row.modelCalls>60){controller.abort();throw Error('evaluation_call_limit');}
      const at=Date.now();let response;
      try{response=await claude.complete(messages,tools,signal,...rest);}catch(error){row.transcript.push({messages,error:error.message,elapsedMs:Date.now()-at});await save();throw error;}
      row.toolCalls+=response.calls.length;row.reads+=response.calls.filter(call=>/^(read_file|ls|glob|grep)$/.test(call.function.name)).length;
      row.transcript.push({messages,response,elapsedMs:Date.now()-at});
      console.log(`${variant} call=${row.modelCalls} tools=${response.calls.map(call=>call.function.name).join(',')} seconds=${Math.round((Date.now()-started)/1000)}`);
      await save();return response;
    }}};
    const load=async()=>({...runtime,runNativeRepositoryGeneration(options){
      return runtime.runNativeRepositoryGeneration({...options,repositoryContext:variant==='candidate'?options.repositoryContext:undefined,pageConcurrency:1,workerStartStaggerMs:0,
        planningContext:'Write in Korean. This small evaluation repository needs exactly two focused pages: openwiki/quickstart.md and openwiki/architecture.md. Cover the order entrypoint and dependencies, discount and shipping conditions, status transitions, validation limits, tests and legacy code boundaries. Lead with the core behavior and avoid repetitive inventories. Use original source evidence; do not claim tests ran.'});
    }});
    try{row.result=await defaultWikiUpdater(service,{load})({root:workspace.root,mode:'init',language:'ko',signal:controller.signal,updateId:variant,onEvent:event=>{row.events.push({...event,elapsedMs:Date.now()-started});}});row.state='completed';}
    catch(error){row.state='failed';row.error=error.message;}
    finally{clearTimeout(timer);row.elapsedMs=Date.now()-started;}
    row.pages=[];row.claimFiles=[];
    const collect=async(dir,relative='')=>{for(const entry of await readdir(dir,{withFileTypes:true})){const rel=relative?relative+'/'+entry.name:entry.name;if(entry.isDirectory())await collect(path.join(dir,entry.name),rel);else if(rel.endsWith('.md'))row.pages.push({path:rel,text:await readFile(path.join(dir,entry.name),'utf8')});else if(rel.startsWith('.claims/')&&rel.endsWith('.json'))row.claimFiles.push({path:rel,value:JSON.parse(await readFile(path.join(dir,entry.name),'utf8'))});}};
    await collect(path.join(workspace.root,'openwiki')).catch(()=>{});
    row.pageCharacters=row.pages.reduce((sum,page)=>sum+page.text.length,0);
    row.sourceHashes=Object.fromEntries((await Promise.all(['src/order.mjs','src/shipping.mjs','src/discount.mjs','src/status.mjs'].map(async rel=>[rel,hash(await readFile(path.join(workspace.root,rel)))]))));
    await save();console.log(`${variant} ${row.state} ${Math.round(row.elapsedMs/1000)}s pages=${row.pages.length}`);
    if(row.error&&/credential|login|rate_limit|auth/.test(row.error))break;
  }
}finally{claude.disconnect();report.finishedAt=new Date().toISOString();await save();}
