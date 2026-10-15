// Explicit live, synthetic-corpus comparison. Never accepts a user project path.
import {mkdir,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createWorkspace} from './corpus.mjs';
import {createClaudeCode,runClaude} from '../runtime/claude-code.mjs';
import {git,hash} from '../runtime/files.mjs';

if(!process.argv.includes('--live'))throw Error('Use --live to run the authenticated model on the pinned synthetic corpus.');
const outputName=process.argv.find(arg=>arg.startsWith('--output='))?.slice(9)||'wiki-semantic-review-2026-10-16';
if(!/^wiki-[a-z0-9-]+$/.test(outputName))throw Error('invalid_evaluation_output');
const out=path.resolve('verification',outputName);
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
const report=process.argv.includes('--append')?JSON.parse(await readFile(path.join(out,'report.json'),'utf8')):{scope:'Independent semantic review enabled on pinned synthetic order-service and cache-retry. All failures retained. Not a general quality or speed estimate.',startedAt:new Date().toISOString(),results:[]};
const save=()=>writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
try{
  await claude.connect();claude.model('opus');claude.reasoning('medium');
  report.model={provider:'claude',model:claude.status().model,effort:claude.status().reasoningEffort};await save();
  for(const variant of process.argv.includes('--update-latest')?['cache-retry']:process.argv.includes('--cache-only')?['cache-retry']:process.argv.includes('--candidate-only')?['order-service']:['order-service','cache-retry']){
    const update=process.argv.includes('--update-latest');
    const previous=update?[...report.results].reverse().find(row=>row.variant===variant&&row.state==='completed'):null;
    let workspace;
    if(update){
      if(!previous||!previous.workspace.includes('nubi-eval-'))throw Error('synthetic_update_workspace_missing');
      for(const [rel,expected] of Object.entries(previous.sourceHashes||{}))if(hash(await readFile(path.join(previous.workspace,rel)))!==expected)throw Error('synthetic_source_changed');
      workspace={root:previous.workspace,corpusHash:previous.corpusHash};
    }else{
      workspace=await createWorkspace({corpus:variant});
      await rm(path.join(workspace.root,'openwiki'),{recursive:true,force:true});
      await git(workspace.root,['add','-A']);await git(workspace.root,['commit','--allow-empty','-qm','Evaluate native wiki creation']);
    }
    const sourceFiles=['generated/openwiki-update/index.mjs','runtime/wiki-code-map.mjs','runtime/wiki-code-map-core.mjs','runtime/wiki-update.mjs','../openwiki/src/agent/repository-runner.ts','../openwiki/src/agent/repository-prompts.ts','../openwiki/src/agent/repository-semantic-review.ts','../openwiki/src/ingestion/code-mode.ts'];
    const row={variant,mode:update?'update':'init',parentAttempt:previous?.attempt??null,attempt:report.results.filter(row=>row.variant===variant).length+1,implementationHashes:Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,hash(await readFile(file))]))),corpusHash:workspace.corpusHash,workspace:workspace.root,modelCalls:0,toolCalls:0,reads:0,events:[],transcript:[],diagnostics:[]};active=row;
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
      return runtime.runNativeRepositoryGeneration({...options,force:update,repositoryContext:options.repositoryContext,pageConcurrency:1,workerStartStaggerMs:0,
        planningContext:variant==='cache-retry'?'Write in Korean. Create exactly openwiki/quickstart.md and openwiki/architecture.md. Explain the service call flow, cache lifecycle and time conditions, retry and cancellation behavior, mutation/concurrency limits, and current behavior versus historical notes. Use original source evidence; do not claim tests ran. Lead with core behavior and avoid repetitive inventories.':'Write in Korean. This small evaluation repository needs exactly two focused pages: openwiki/quickstart.md and openwiki/architecture.md. Cover the order entrypoint and dependencies, discount and shipping conditions, status transitions, validation limits, tests and legacy code boundaries. Lead with the core behavior and avoid repetitive inventories. Use original source evidence; do not claim tests ran.'});
    }});
    try{row.result=await defaultWikiUpdater(service,{load})({root:workspace.root,mode:update?'update':'init',language:'ko',signal:controller.signal,updateId:variant,onEvent:event=>{row.events.push({...event,elapsedMs:Date.now()-started});}});row.state='completed';}
    catch(error){row.state='failed';row.error=error.message;}
    finally{clearTimeout(timer);row.elapsedMs=Date.now()-started;}
    row.pages=[];row.claimFiles=[];
    const collect=async(dir,relative='')=>{for(const entry of await readdir(dir,{withFileTypes:true})){const rel=relative?relative+'/'+entry.name:entry.name;if(entry.isDirectory())await collect(path.join(dir,entry.name),rel);else if(rel.endsWith('.md'))row.pages.push({path:rel,text:await readFile(path.join(dir,entry.name),'utf8')});else if(rel.startsWith('.claims/')&&rel.endsWith('.json'))row.claimFiles.push({path:rel,value:JSON.parse(await readFile(path.join(dir,entry.name),'utf8'))});}};
    await collect(path.join(workspace.root,'openwiki')).catch(()=>{});
    row.pageCharacters=row.pages.reduce((sum,page)=>sum+page.text.length,0);
    row.sourceHashes=Object.fromEntries((await Promise.all((variant==='order-service'?['src/order.mjs','src/shipping.mjs','src/discount.mjs','src/status.mjs']:['src/cache.mjs','src/retry.mjs','src/service.mjs']).map(async rel=>[rel,hash(await readFile(path.join(workspace.root,rel)))]))));
    await save();console.log(`${variant} ${row.state} ${Math.round(row.elapsedMs/1000)}s pages=${row.pages.length}`);
    if(row.error&&/credential|login|rate_limit|auth/.test(row.error))break;
  }
}finally{claude.disconnect();report.finishedAt=new Date().toISOString();await save();}
