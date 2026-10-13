import {disableHostedTracing} from '../../runtime/worker-environment.mjs';
disableHostedTracing(process.env);
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runCase} from '../driver.mjs';
import {candidateIdentity} from '../candidate.mjs';
import {connectRelayProviders,defaultSocketPath} from '../relay.mjs';
import {prepareHardWorkspace,configureHardService,hash} from './fixtures.mjs';
import {gradeHard} from './grade.mjs';

export async function loadHardCases(){
 const cases=JSON.parse(await readFile(new URL('cases.json',import.meta.url),'utf8'));
 if(cases.length!==10||new Set(cases.map(c=>c.id)).size!==10)throw Error('hard10_case_count');
 if(cases.some(c=>c.datasets.length!==3||c.mails.length!==3||c.policies.length!==3||!c.expectedRows.length))throw Error('hard10_incomplete');
 return cases;
}
export function shouldStopEvaluation(error){return ['worker_disconnected','rate_limited','unauthorized','expired_token','no_credential','claude_login_required'].includes(error);}
export function summary(rows){
 const done=rows.filter(r=>r.outcome!=='not_run'),times=done.map(r=>r.elapsedMs).filter(Number.isFinite).sort((a,b)=>a-b);
 const dimensions=Object.fromEntries([...new Set(done.flatMap(r=>(r.checks||[]).map(c=>c.name)))].map(name=>[name,{passed:done.filter(r=>r.checks?.find(c=>c.name===name)?.passed).length,planned:10}]));
 return {planned:10,executed:done.length,passed:rows.filter(r=>r.passed).length,failed:rows.filter(r=>r.outcome==='failed').length,error:rows.filter(r=>r.outcome==='error').length,needsHuman:rows.filter(r=>r.outcome==='needs_human').length,notRun:rows.filter(r=>r.outcome==='not_run').length,p50Ms:times[Math.floor((times.length-1)*.5)]??null,p95Ms:times[Math.ceil((times.length-1)*.95)]??null,modelCalls:done.reduce((n,r)=>n+(r.modelCalls||0)+(r.delegatedCalls||0),0),dimensions};
}
const option=name=>{const i=process.argv.indexOf('--'+name);return i<0?undefined:process.argv[i+1];};
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const version=1,cases=await loadHardCases(),ids=option('cases')?.split(','),selected=ids?cases.filter(c=>ids.includes(c.id)):cases;
 if(ids&&selected.length!==ids.length)throw Error('case_unknown');
 const concurrency=Number(option('concurrency')||3);if(!Number.isInteger(concurrency)||concurrency<1||concurrency>4)throw Error('invalid_concurrency');
 const output=path.resolve(option('out')||'verification/eval-live/hard10-v1-chatgpt-20261013');await mkdir(output,{recursive:true});
 const candidate=await candidateIdentity(),files=['cases.json','fixtures.mjs','grade.mjs','run.mjs','../driver.mjs','../transcript.mjs','../relay.mjs','../candidate.mjs','../corpus.mjs','../user.mjs','../medium-40/fixtures.mjs','../medium-40/audit-facts.mjs'];
 const benchmarkHash=hash((await Promise.all(files.map(f=>readFile(new URL(f,import.meta.url))))).map((b,i)=>files[i]+':'+hash(b)).join('\n'));
 let report={schema:1,kind:'hard-10-composite-live-agent',suiteVersion:version,startedAt:new Date().toISOString(),candidate,benchmarkHash,concurrency,platform:os.platform(),node:process.version,trials:1,
  limits:{timeoutMs:900000,maxModelCalls:100,maxDelegatedCalls:160,maxInteractions:40},
  limitations:['Actual connected model and product Agent. Fixed synthetic inputs, not corporate account/mailbox verification.','Bash commands use this Mac; not Windows PowerShell.','One trial per distinct case, not repeat reliability or an overall product quality score.','Facts and required execution/source receipts are deterministic checks; paraphrase ambiguities require review.','Concurrent case durations include shared provider contention.'],
  results:cases.map(c=>({id:c.id,category:c.category,title:c.title,passed:false,outcome:'not_run'}))};
 let prior;
 try{prior=JSON.parse(await readFile(path.join(output,'report.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(prior){
  if(!process.argv.includes('--resume'))throw Error('output_exists_use_resume');
  if(prior.benchmarkHash!==benchmarkHash||prior.candidate.hash!==candidate.hash||prior.concurrency!==concurrency)throw Error('resume_conditions_changed');
  report=prior;delete report.finishedAt;delete report.stoppedReason;
 }
 const pending=selected.filter(c=>report.results.find(r=>r.id===c.id)?.outcome==='not_run');
 let writeChain=Promise.resolve(),next=0,stopped=false;
 const save=()=>{report.summary=summary(report.results);const payload=JSON.stringify(report,null,2)+'\n';writeChain=writeChain.then(async()=>{await writeFile(path.join(output,'report.json.tmp'),payload);await rename(path.join(output,'report.json.tmp'),path.join(output,'report.json'));});return writeChain;};
 await writeFile(path.join(output,'manifest.json'),JSON.stringify({benchmarkHash,candidate,cases},null,2)+'\n');await save();
 async function worker(){
  let providers;
  try{providers=await connectRelayProviders({socketPath:option('socket')||defaultSocketPath()});const config=providers.status();
   if(report.modelConfiguration&&(report.modelConfiguration.model!==config.model||report.modelConfiguration.reasoningEffort!==config.reasoningEffort))throw Error('resume_model_changed');
   report.modelConfiguration=config;await save();
   while(!stopped){const c=pending[next++];if(!c)break;
    const directory=path.join(output,c.id);await mkdir(directory,{recursive:true});
    console.log(`START ${c.id} ${c.title}`);
    const testCase={id:c.id,corpus:'order-service',request:c.request,approvals:['command'],commands:['bash (?:\\./)?tools/report\\.sh (?:catalog|read ["\']?[a-zA-Z0-9-]+["\']?)','(?:node|bash) --version']};
    let run;
    try{
     run=await runCase({testCase,providers,limits:report.limits,prepareWorkspace:w=>prepareHardWorkspace(c,w),configureService:(s,w)=>configureHardService(c,s,w)});
     const grade=await gradeHard(c,run);
     const result={id:c.id,category:c.category,title:c.title,...grade,state:run.state,error:run.error,elapsedMs:run.elapsedMs,modelCalls:run.modelCalls,delegatedCalls:run.delegatedCalls,answer:run.answer,user:run.user,commands:run.commands,sourceReferences:run.sourceReferences,metrics:run.metrics.summary,reviewStatus:run.reviewStatus};
     report.results[report.results.findIndex(r=>r.id===c.id)]=result;
     await writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2)+'\n');
     await writeFile(path.join(directory,'transcript.jsonl'),run.transcript.map(r=>JSON.stringify(r)).join('\n')+'\n');
     await writeFile(path.join(directory,'operations.json'),JSON.stringify(run.operations,null,2)+'\n');
     console.log(`${grade.outcome.toUpperCase()} ${c.id} ${Math.round(run.elapsedMs/1000)}s calls=${run.modelCalls}+${run.delegatedCalls} failed=${grade.checks.filter(x=>!x.passed).map(x=>x.name).join(',')}`);
     if(shouldStopEvaluation(run.error)){stopped=true;report.stoppedReason=run.error;}
    }catch(error){if(shouldStopEvaluation(error.message)){stopped=true;report.stoppedReason=error.message;}report.results[report.results.findIndex(r=>r.id===c.id)]={id:c.id,category:c.category,title:c.title,passed:false,outcome:'error',error:/^[a-z_]+$/.test(error.message)?error.message:'evaluation_failed'};console.log(`ERROR ${c.id}`);}
    finally{await run?.dispose();await save();}
   }
  }finally{providers?.dispose();}
 }
 await Promise.all(Array.from({length:concurrency},worker));report.finishedAt=new Date().toISOString();report.candidateUnchanged=JSON.stringify(candidate)===JSON.stringify(await candidateIdentity());await save();console.log(JSON.stringify(report.summary,null,2));
}
