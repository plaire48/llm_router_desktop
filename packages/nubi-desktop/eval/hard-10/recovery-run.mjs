// Separate diagnostic: no baseline result or product code is changed.
import {disableHostedTracing} from '../../runtime/worker-environment.mjs';
disableHostedTracing(process.env);
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {runCase} from '../driver.mjs';
import {candidateIdentity} from '../candidate.mjs';
import {connectRelayProviders} from '../relay.mjs';
import {prepareHardWorkspace,configureHardService,hash} from './fixtures.mjs';
import {gradeHard} from './grade.mjs';
const option=name=>{const i=process.argv.indexOf('--'+name);return i<0?undefined:process.argv[i+1];};
const baseline=JSON.parse(await readFile(path.resolve(option('baseline')||'verification/eval-live/hard10-v1-chatgpt-20261013/report.json'),'utf8'));
if(!baseline.finishedAt)throw Error('baseline_not_finished');
const candidate=await candidateIdentity();if(candidate.hash!==baseline.candidate.hash)throw Error('candidate_changed');
const clarification='추가 실행 조건: 하나의 승인 요청(script)에는 read 명령 하나만 넣으세요. 세 read를 ; 또는 && 등으로 합치지 말고 각각 별도의 실행 요청으로 제출하세요. 조회별 승인 범위는 그대로이며 권한을 확대하지 않습니다.';
const originals=JSON.parse(await readFile(new URL('cases.json',import.meta.url),'utf8')),cases=originals.filter(c=>['H08','H09'].includes(c.id)).map(c=>({...c,request:c.request+'\n'+clarification}));
const output=path.resolve(option('out')||'verification/eval-live/hard10-command-clarification-20261013');await mkdir(output,{recursive:false});
const report={kind:'hard10-command-clarification-diagnostic',startedAt:new Date().toISOString(),baselineBenchmarkHash:baseline.benchmarkHash,candidate,planned:2,concurrency:2,trials:1,clarification,limitations:['Not a replacement for the baseline score. Same product, added explicit command-granularity instruction.','New run, not resuming the stopped task; does not prove in-task rejection recovery.','Timing is not comparable with the three-concurrent-case baseline.'],limits:baseline.limits,results:[]};
const files=['cases.json','fixtures.mjs','grade.mjs','recovery-run.mjs','../driver.mjs','../transcript.mjs','../relay.mjs','../candidate.mjs','../corpus.mjs','../user.mjs','../medium-40/fixtures.mjs','../medium-40/audit-facts.mjs'];
report.benchmarkHash=hash((await Promise.all(files.map(f=>readFile(new URL(f,import.meta.url))))).map((b,i)=>files[i]+':'+hash(b)).join('\n'));
await writeFile(path.join(output,'manifest.json'),JSON.stringify({candidate,cases,benchmarkHash:report.benchmarkHash},null,2)+'\n');
await Promise.all(cases.map(async c=>{
 const providers=await connectRelayProviders({socketPath:option('socket')||'/tmp/nubi-hard10-20261013/model.sock'});report.modelConfiguration=providers.status();
 if(report.modelConfiguration.model!==baseline.modelConfiguration.model||report.modelConfiguration.reasoningEffort!==baseline.modelConfiguration.reasoningEffort)throw Error('model_changed');
 let run;try{
  console.log('START '+c.id);run=await runCase({testCase:{id:c.id,corpus:'order-service',request:c.request,approvals:['command'],commands:['bash (?:\\./)?tools/report\\.sh (?:catalog|read ["\']?[a-zA-Z0-9-]+["\']?)','(?:node|bash) --version']},providers,limits:report.limits,prepareWorkspace:w=>prepareHardWorkspace(c,w),configureService:(s,w)=>configureHardService(c,s,w)});
  const grade=await gradeHard(c,run),result={id:c.id,title:c.title,...grade,state:run.state,error:run.error,answer:run.answer,elapsedMs:run.elapsedMs,modelCalls:run.modelCalls,delegatedCalls:run.delegatedCalls,commands:run.commands,user:run.user,sourceReferences:run.sourceReferences,metrics:run.metrics.summary,reviewStatus:run.reviewStatus};
  const directory=path.join(output,c.id);await mkdir(directory);await writeFile(path.join(directory,'result.json'),JSON.stringify(result,null,2)+'\n');await writeFile(path.join(directory,'transcript.jsonl'),run.transcript.map(e=>JSON.stringify(e)).join('\n')+'\n');await writeFile(path.join(directory,'operations.json'),JSON.stringify(run.operations,null,2)+'\n');report.results.push(result);console.log(grade.outcome.toUpperCase()+' '+c.id+' '+Math.round(run.elapsedMs/1000)+'s');
 }finally{await run?.dispose();providers.dispose();}
}));
report.finishedAt=new Date().toISOString();report.candidateUnchanged=JSON.stringify(candidate)===JSON.stringify(await candidateIdentity());await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
