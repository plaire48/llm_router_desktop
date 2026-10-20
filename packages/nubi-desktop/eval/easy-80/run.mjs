import {readSyntheticFixture} from '../../../nubi-office/eval/synthetic-values.mjs';
import {disableHostedTracing} from '../../runtime/worker-environment.mjs';
disableHostedTracing(process.env);
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {runCase} from '../driver.mjs';
import {candidateIdentity} from '../candidate.mjs';
import {connectRelayProviders,defaultSocketPath} from '../relay.mjs';
import {prepareEasyWorkspace,configureEasyService,hash} from './fixtures.mjs';
import {gradeEasy} from './grade.mjs';

export async function loadEasyCases(version=1){
 if(![1,2].includes(version))throw Error('suite_version_invalid');
 const cases=await readSyntheticFixture(new URL(version===2?'cases-v2.json':'cases.json',import.meta.url));
 if(cases.length!==80||new Set(cases.map(c=>c.id)).size!==80)throw Error('easy80_case_count');
 for(const category of ['bash','mail','skill','wiki'])if(cases.filter(c=>c.category===category).length!==20)throw Error('easy80_category_count');
 if(cases.some(c=>!c.request||!c.expected?.length||c.expected.some(g=>!g.length)))throw Error('easy80_expectations_missing');
 return cases;
}
export function summary(results){return Object.fromEntries(['bash','mail','skill','wiki'].map(category=>{
 const rows=results.filter(r=>r.category===category),done=rows.filter(r=>r.outcome!=='not_run'),times=done.map(r=>r.elapsedMs).sort((a,b)=>a-b);
 return [category,{planned:20,executed:done.length,passed:rows.filter(r=>r.passed).length,failed:rows.filter(r=>r.outcome==='failed').length,error:rows.filter(r=>r.outcome==='error').length,needsHuman:rows.filter(r=>r.outcome==='needs_human').length,notRun:rows.filter(r=>r.outcome==='not_run').length,falseCompletion:rows.filter(r=>r.falseCompletion).length,p50Ms:times[Math.floor((times.length-1)*.5)]??null,p95Ms:times[Math.floor((times.length-1)*.95)]??null}];
}));}
const option=name=>{const i=process.argv.indexOf('--'+name);return i<0?undefined:process.argv[i+1];};
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const version=Number(option('suite')||1),cases=await loadEasyCases(version),ids=option('cases')?.split(','),selected=ids?cases.filter(c=>ids.includes(c.id)):Array.from({length:20},(_,i)=>['bash','mail','skill','wiki'].map(category=>cases.find(c=>c.id===category+'-'+String(i+1).padStart(2,'0')))).flat();
 if(ids&&selected.length!==ids.length)throw Error('case_unknown');
 const concurrency=Number(option('concurrency')||2);if(!Number.isInteger(concurrency)||concurrency<1||concurrency>4)throw Error('invalid_concurrency');
 const output=path.resolve(option('out')||'verification/eval-live/easy80-opus55-medium-20261012');await mkdir(output,{recursive:true});
 const candidate=await candidateIdentity(),files=[version===2?'cases-v2.json':'cases.json','skills.json','fixtures.mjs','grade.mjs','run.mjs','../driver.mjs','../../../nubi-office/eval/synthetic-values.mjs','../transcript.mjs','../relay.mjs'];
 const benchmarkHash=hash((await Promise.all(files.map(f=>readFile(new URL(f,import.meta.url))))).map((b,i)=>files[i]+':'+hash(b)).join('\n'));
 let report={schema:1,kind:'easy-80-live-agent',suiteVersion:version,startedAt:new Date().toISOString(),candidate,benchmarkHash,concurrency,platform:os.platform(),node:process.version,trials:1,
  limits:{timeoutMs:600000,maxModelCalls:60,maxDelegatedCalls:160,maxInteractions:16},
  limitations:['Actual connected model and product Agent. Fixed synthetic inputs, not corporate account/mailbox verification.','Bash commands use this Mac; not Windows PowerShell.','One trial per distinct case, not repeat reliability or an overall product quality score.','Facts and required execution/source receipts are deterministic checks; paraphrase ambiguities require review.','Concurrent case durations include shared provider contention.'],
  results:cases.map(c=>({id:c.id,category:c.category,title:c.title,passed:false,outcome:'not_run'}))};
 let prior;
 try{prior=JSON.parse(await readFile(path.join(output,'report.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(prior){
  if(!process.argv.includes('--resume'))throw Error('output_exists_use_resume');
  if(prior.benchmarkHash!==benchmarkHash||prior.candidate.hash!==candidate.hash||prior.concurrency!==concurrency)throw Error('resume_conditions_changed');
  report=prior;delete report.finishedAt;
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
    const testCase={id:c.id,corpus:'order-service',request:c.request,approvals:c.category==='bash'?['command']:[],commands:c.category==='bash'?['bash (?:\\./)?tools/report\\.sh (?:catalog|run ["\']?[a-zA-Z0-9-]+["\']?)','(?:node|bash) --version']:undefined};
    let run;
    try{
     run=await runCase({testCase,providers,limits:report.limits,prepareWorkspace:w=>prepareEasyWorkspace(c,w),configureService:(s,w)=>configureEasyService(c,s,w)});
     const grade=await gradeEasy(c,run);
     const result={id:c.id,category:c.category,title:c.title,...grade,state:run.state,error:run.error,elapsedMs:run.elapsedMs,modelCalls:run.modelCalls,delegatedCalls:run.delegatedCalls,answer:run.answer,user:run.user,commands:run.commands,sourceReferences:run.sourceReferences,metrics:run.metrics.summary};
     report.results[report.results.findIndex(r=>r.id===c.id)]=result;
     await writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2)+'\n');
     await writeFile(path.join(directory,'transcript.jsonl'),run.transcript.map(r=>JSON.stringify(r)).join('\n')+'\n');
     await writeFile(path.join(directory,'operations.json'),JSON.stringify(run.operations,null,2)+'\n');
     console.log(`${grade.outcome.toUpperCase()} ${c.id} ${Math.round(run.elapsedMs/1000)}s calls=${run.modelCalls}+${run.delegatedCalls} failed=${grade.checks.filter(x=>!x.passed).map(x=>x.name).join(',')}`);
     if(run.error==='worker_disconnected')stopped=true;
    }catch(error){report.results[report.results.findIndex(r=>r.id===c.id)]={id:c.id,category:c.category,title:c.title,passed:false,outcome:'error',error:/^[a-z_]+$/.test(error.message)?error.message:'evaluation_failed'};console.log(`ERROR ${c.id}`);}
    finally{await run?.dispose();await save();}
   }
  }finally{providers?.dispose();}
 }
 await Promise.all(Array.from({length:concurrency},worker));report.finishedAt=new Date().toISOString();report.candidateUnchanged=JSON.stringify(candidate)===JSON.stringify(await candidateIdentity());await save();console.log(JSON.stringify(report.summary,null,2));
}
