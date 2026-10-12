// Live measurement of the Wiki that Desktop prepares when a project is opened
// (user decision 2026-10-04): the product path, initializeWiki, with the model
// the user logged in to. The runner alone is measured by wiki-update.mjs; this
// measures what the app does around it: source listing, the private snapshot,
// publication with Claims and the update record, and the status afterwards.
//
// Setup: the order-service corpus without its Wiki, as a Git project or as an
// ordinary folder (--source folder removes .git). Then one question through
// the agent on the generated Wiki (case K1), graded on the answer only.
//
// Usage: node eval/wiki-init.mjs --socket <path> --out <directory> [--source git|folder] [--no-question]
import {mkdir,readFile,rm,writeFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {createWorkspace} from './corpus.mjs';
import {connectRelayProviders} from './relay.mjs';
import {candidateIdentity} from './candidate.mjs';
import {loadCases} from './cases.mjs';

const option=name=>{const at=process.argv.indexOf('--'+name);return at>0?process.argv[at+1]:undefined;};
const socketPath=option('socket'),outputDir=option('out'),source=option('source')||'git',withQuestion=!process.argv.includes('--no-question');
if(!socketPath||!outputDir||!['git','folder'].includes(source)){console.error('사용법: node eval/wiki-init.mjs --socket <경로> --out <폴더> [--source git|folder] [--no-question]');process.exit(2);}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const INIT_LIMIT_MS=40*60*1000,QUESTION_LIMIT_MS=20*60*1000;

const workspace=await createWorkspace({corpus:'order-service'});
process.env.OPENWIKI_CONFIG_DIR=path.join(workspace.directory,'openwiki-home');
const {ProjectService}=await import('../runtime/project-service.mjs');
const {installAgent}=await import('../runtime/agent.mjs');
const {git}=await import('../runtime/files.mjs');
const {readRunMetrics}=await import('../runtime/run-metrics.mjs');
if(!ProjectService.prototype.startAgent)installAgent(ProjectService);
const relay=await connectRelayProviders({socketPath});
const requests={ok:0,rejected:0,failed:0};
const providers={status:()=>relay.status(),dispose:()=>relay.dispose?.(),async complete(...args){try{const result=await relay.complete(...args);requests.ok++;return result;}catch(error){if(error.message==='response_invalid')requests.rejected++;else requests.failed++;throw error;}}};
const counted=()=>{const value={...requests};requests.ok=0;requests.rejected=0;requests.failed=0;return value;};
const root=workspace.root;
const report={corpus:workspace.corpus,corpusHash:workspace.corpusHash,candidate:await candidateIdentity(),model:providers.status().model,source,steps:{}};
const summary=metrics=>({modelCalls:metrics.summary.modelCalls,retries:metrics.summary.retries,promptTokens:metrics.summary.promptTokens,completionTokens:metrics.summary.completionTokens,elapsedMs:metrics.summary.elapsedMs});
const listWiki=async()=>{const out=[];const walk=async dir=>{for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await walk(file);else out.push(path.relative(root,file).split(path.sep).join('/'));}};try{await walk(path.join(root,'openwiki'));}catch{}return out.sort();};
let service;
try{
  // 1. The corpus without its Wiki. A Git project keeps its history; an ordinary folder has none.
  await rm(path.join(root,'openwiki'),{recursive:true,force:true});
  if(source==='git'){await git(root,['add','-A']);await git(root,['commit','-qm','Without a Wiki']);}
  else await rm(path.join(root,'.git'),{recursive:true,force:true});
  const before=(await readdir(root)).sort();

  // 2. As in the app: the model is connected, then the project is opened and the Wiki is prepared in the background.
  service=new ProjectService({storageRoot:workspace.stateRoot});service.providers=providers;
  const started=Date.now(),stages=[];let last='';
  await service.open(root);
  let job;
  for(;;){
    job=service.wikiInitialization();
    const key=job?`${job.state}:${job.stage}:${job.percent}:${job.completed}/${job.total}`:'none';
    if(key!==last){stages.push({at:Math.round((Date.now()-started)/1000),state:job?.state,stage:job?.stage,percent:job?.percent,completed:job?.completed,total:job?.total,...(job?.error?{error:job.error}:{})});last=key;}
    if(job&&job.state!=='running')break;
    if(Date.now()-started>INIT_LIMIT_MS){service.wikiInitialization({action:'cancel'});}
    await pause(1000);
  }
  await service.wikiInitPromise?.catch(()=>{});
  const files=await listWiki();
  report.steps.init={state:job.state,stage:job.stage,error:job.error||null,elapsedMs:Date.now()-started,requests:counted(),pages:files.filter(rel=>rel.endsWith('.md')),claims:files.filter(rel=>rel.startsWith('openwiki/.claims/')).length,record:files.includes('openwiki/.last-update.json'),manifest:files.includes('openwiki/.page-manifest.json'),otherFiles:files.filter(rel=>!rel.endsWith('.md')&&!rel.startsWith('openwiki/.claims/')),sourceFiles:job.sourceFiles??null,excludedFiles:job.excludedFiles??null,stages,...(job.id?summary(readRunMetrics(service.store,{taskId:'wiki-update:'+job.id})):{})};
  // Nothing outside openwiki/ changes in the user's folder, and no Git is created there.
  report.steps.folder={newEntries:(await readdir(root)).sort().filter(name=>!before.includes(name)),gitCreated:source==='folder'&&await stat(path.join(root,'.git')).then(()=>true,()=>false)};
  try{report.steps.status=(await service.invoke('wikiUpdate',{method:'status'})).status;}catch(error){report.steps.status={error:String(error?.message||error).slice(0,120)};}
  if(job.state==='completed'){
    try{const record=JSON.parse(await readFile(path.join(root,'openwiki/.last-update.json'),'utf8'));report.steps.record={status:record.status,command:record.command,language:record.language,gitHead:record.gitHead??null};}catch{}
  }

  // 3. One question on the generated Wiki, through the agent as a user would ask it.
  if(withQuestion&&job.state==='completed'){
    const [testCase]=await loadCases({ids:['K1-jeju-extra-fee']});
    const taskId=(await service.createTask({request:testCase.request,criteria:[]})).id,asked=Date.now();
    const timer=setTimeout(()=>{service.stopAgent({taskId}).catch(()=>{});},QUESTION_LIMIT_MS);
    try{await service.startAgent({taskId});await service.agent.promise;}finally{clearTimeout(timer);}
    const task=service.task(taskId),answer=task?.messages?.findLast(message=>message.role==='assistant')?.content||'';
    const includes=testCase.expect.answer_includes.map(group=>(Array.isArray(group)?group:[group]).some(text=>answer.includes(text)));
    const metrics=readRunMetrics(service.store,{taskId});
    report.steps.question={request:testCase.request,state:task?.state,error:task?.error||null,asked:task?.question?true:false,answerIncludes:includes,answer:answer.slice(0,1200),elapsedMs:Date.now()-asked,requests:counted(),tools:metrics.summary?.byTool?Object.fromEntries(Object.entries(metrics.summary.byTool).map(([name,row])=>[name,row.calls??row.count??row])):null,...summary(metrics)};
  }
}catch(error){report.error=String(error?.message||error).slice(0,300);}
finally{
  await mkdir(path.resolve(outputDir),{recursive:true});
  await writeFile(path.join(path.resolve(outputDir),'report.json'),JSON.stringify(report,null,2)+'\n');
  const init=report.steps.init,q=report.steps.question;
  console.log(JSON.stringify({source,init:init&&{state:init.state,stage:init.stage,error:init.error,pages:init.pages.length,claims:init.claims,record:init.record,manifest:init.manifest,modelCalls:init.modelCalls,rejected:init.requests.rejected,seconds:Math.round(init.elapsedMs/1000)},folder:report.steps.folder,status:report.steps.status&&{state:report.steps.status.state,reason:report.steps.status.reason||null,stalePages:report.steps.status.stalePages?.length},question:q&&{state:q.state,error:q.error,answerIncludes:q.answerIncludes,modelCalls:q.modelCalls,seconds:Math.round(q.elapsedMs/1000),tools:q.tools},error:report.error||null},null,1));
  try{service?.dispose();service?.store?.close();}catch{/* Already closed. */}
  relay.dispose?.();
  if(!report.error)await workspace.dispose();
}
