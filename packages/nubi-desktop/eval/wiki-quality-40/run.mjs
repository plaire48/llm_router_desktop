import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {runCase} from '../driver.mjs';
import {candidateIdentity} from '../candidate.mjs';
import {connectRelayProviders,defaultSocketPath} from '../relay.mjs';
import {changedPaths} from '../corpus.mjs';
import {leaderEntries} from '../transcript.mjs';
import {prepare,configure,sourcePath,wikiPath,mailId} from './fixtures.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex');
export async function loadCases(){
 const cases=JSON.parse(await readFile(new URL('cases.json',import.meta.url),'utf8'));
 if(cases.length!==40||new Set(cases.map(c=>c.id)).size!==40||['code','personal'].some(category=>cases.filter(c=>c.category===category).length!==20))throw Error('invalid_cases');
 return cases;
}
export function grade(c,run){
 const answer=String(run.answer||'').normalize('NFKC'),refs=run.sourceReferences||[];
 const missing=c.expected.filter(group=>!group.some(term=>answer.toLowerCase().includes(term.toLowerCase())));
 const supported=c.decisive.map(i=>refs.some(ref=>c.category==='personal'?ref.id===mailId(c,i):[wikiPath(c,i),sourcePath(c,i),...(c.id==='code-13'?['records/current.md']:[])].includes(ref.path)));
 const checks={delivered:run.state==='review'&&!!answer&&!run.error&&!run.needsHuman,expectedStatements:missing.length===0,noForbiddenStatement:!c.forbidden.some(term=>answer.includes(term)),decisiveSourceRecall:supported.every(Boolean),noActions:!(run.commands?.length||run.user?.applied?.length||run.user?.refused?.length)};
 // This is an automated screen, not an independent entailment/quality judge.
 return {checks,automatedPass:Object.values(checks).every(Boolean),missing,decisiveRecall:supported.filter(Boolean).length/Math.max(1,supported.length),manualReviewRequired:true};
}
const option=name=>{const i=process.argv.indexOf('--'+name);return i<0?undefined:process.argv[i+1];};
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const cases=await loadCases(),candidate=await candidateIdentity(),out=path.resolve(option('out')||'verification/openwiki-quality-2026-10-15'),trials=Number(option('trials')||3);
 if(!Number.isInteger(trials)||trials<1||trials>3)throw Error('invalid_trials');
 const ids=option('cases')?.split(','),selected=ids?cases.filter(c=>ids.includes(c.id)):cases;
 if(ids&&selected.length!==ids.length)throw Error('unknown_case');
 const files=['cases.json','run.mjs','fixtures.mjs','../driver.mjs','../hard-10/fixtures.mjs','../transcript.mjs','../relay.mjs','../corpus.mjs'];
 const benchmarkHash=sha((await Promise.all(files.map(async f=>f+':'+sha(await readFile(new URL(f,import.meta.url)))))).join('\n'));
 await mkdir(out,{recursive:true});
 let report={schema:1,kind:'wiki-quality-40-live-agent',candidate,benchmarkHash,trials,startedAt:new Date().toISOString(),results:Array.from({length:trials},(_,trial)=>cases.map(c=>({id:c.id,category:c.category,trial:trial+1,outcome:'not_run'}))).flat(),limitations:['Synthetic corpora with the actual Desktop agent; not company mail or Windows proof.','Acceptance benchmark authored during this work, not an independently blinded holdout.','Automatic string and source checks require independent human entailment and readability review.','Personal cases evaluate search/read/answer, not generation or fact ingestion; ingestion is tested separately.']};
 try{const prior=JSON.parse(await readFile(path.join(out,'report.json'),'utf8'));if(!process.argv.includes('--resume'))throw Error('output_exists_use_resume');if(prior.benchmarkHash!==benchmarkHash||prior.candidate.hash!==candidate.hash||prior.trials!==trials)throw Error('resume_conditions_changed');report=prior;}catch(e){if(e.code!=='ENOENT')throw e;}
 const save=async()=>{const done=report.results.filter(r=>r.outcome!=='not_run');report.summary={planned:report.results.length,executed:done.length,automatedPass:done.filter(r=>r.automatedPass).length,failed:done.filter(r=>!r.automatedPass).length,notRun:report.results.length-done.length,allTrialsPass:cases.filter(c=>report.results.filter(r=>r.id===c.id&&r.automatedPass).length===trials).length};await writeFile(path.join(out,'report.json.tmp'),JSON.stringify(report,null,2)+'\n');await rename(path.join(out,'report.json.tmp'),path.join(out,'report.json'));};
 await save();
 if(process.argv.includes('--prepare-only')){console.log(JSON.stringify(report.summary));process.exit(0);}
 let providers;
 try{providers=await connectRelayProviders({socketPath:option('socket')||defaultSocketPath()});}
 catch{report.blocked='model_session_unavailable';await save();console.log('BLOCKED model_session_unavailable');process.exit(2);}
 const status=providers.status();report.model={provider:status.provider,model:status.model,reasoningEffort:status.reasoningEffort};delete report.blocked;await save();
 try{
  for(const row of report.results){
   if(row.outcome!=='not_run'||!selected.some(c=>c.id===row.id))continue;
   if((await candidateIdentity()).hash!==candidate.hash)throw Error('candidate_changed');
   const c=cases.find(c=>c.id===row.id);console.log(`START ${c.id} trial=${row.trial}`);
   const run=await runCase({testCase:{id:c.id,corpus:'order-service',request:c.request,approvals:[],commands:[]},providers,limits:{timeoutMs:600000,maxModelCalls:35,maxDelegatedCalls:120,maxInteractions:8},prepareWorkspace:w=>prepare(c,w),configureService:(s,w)=>configure(c,s,w)});
   try{
    const result=grade(c,run),changes=await changedPaths(run.root);result.checks.unchanged=changes.length===0;result.automatedPass&&=changes.length===0;
    const calls=leaderEntries(run.transcript).flatMap(e=>e.response?.calls||[]),reads=calls.filter(c=>/read|query|search/.test(c.name)),unique=new Set(reads.map(c=>JSON.stringify([c.name,c.arguments]))).size;
    Object.assign(row,result,{outcome:run.error?'error':result.automatedPass?'passed':'failed',error:run.error,answer:run.answer,sourceReferences:run.sourceReferences,elapsedMs:run.elapsedMs,modelCalls:run.modelCalls,delegatedCalls:run.delegatedCalls,reads:reads.length,repeatedReads:reads.length-unique});
    await writeFile(path.join(out,`${c.id}-trial${row.trial}.json`),JSON.stringify({...row,transcript:run.transcript,metrics:run.metrics},null,2)+'\n');await save();
    console.log(`DONE ${c.id} trial=${row.trial} ${row.outcome} ${run.elapsedMs}ms`);
    if(['unauthorized','no_credential','claude_login_required','rate_limited','worker_disconnected'].includes(run.error)){report.blocked=run.error;await save();break;}
   }finally{await run.dispose();}
  }
 }finally{providers.dispose();report.finishedAt=new Date().toISOString();await save();}
 console.log(JSON.stringify(report.summary));
}
