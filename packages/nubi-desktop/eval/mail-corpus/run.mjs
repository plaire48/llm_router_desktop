// Explicit local benchmark. Never part of npm test, never opens a user's store.
import {spawn,execFile} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeCorpus} from './generate.mjs';

const directory=path.resolve(process.argv[2]||'verification/mail-scale-m6');
const packageRoot=fileURLToPath(new URL('../../',import.meta.url));
await mkdir(directory,{recursive:true});
// A fresh directory is mandatory: no previous baseline or measured source is replaced.
const lock=await import('node:fs/promises').then(fs=>fs.open(path.join(directory,'RUN'),'wx'));await lock.close();
const report={version:1,scope:'synthetic cached DTO baseline; not MIME/network/vault import or rendered UI',
  startedAt:new Date().toISOString(),environment:{platform:process.platform,arch:process.arch,node:process.version,
    cpus:os.cpus().length,totalMemoryBytes:os.totalmem(),loadavg:os.loadavg()},
  limits:{perStageMs:180000,heapMiB:1536,mailRssMiB:500,listMs:300,searchP95Ms:200},
  stages:[],sourceHashes:{},notMeasured:{
    fts5:'not_implemented_pending_encryption_decision',
    renderedFirstList:'backend_API_only',
    mimeAndVaultIngestion:'DTO_seed_is_not_product_ingestion',
    nightlySynthesis:'requires_live_model_budget_and_pipeline',
    interruptMatrix:'W0_evidence_is_not_mail_pipeline_evidence',
    answerCitationAccuracy:'source_hash_validation_is_not_model_answer_accuracy'}};
for(const relative of ['runtime/mail-search.mjs','runtime/store.mjs','runtime/mail-preview.mjs','runtime/mail-text.mjs',
  'eval/mail-corpus/generate.mjs','eval/mail-corpus/measure-worker.mjs','eval/mail-corpus/run.mjs']){
  report.sourceHashes[relative]=createHash('sha256').update(await readFile(path.join(packageRoot,relative))).digest('hex');
}
const save=()=>writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
await save();
const at=performance.now();report.corpus=await writeCorpus(path.join(directory,'corpus'));
report.generatorMs=performance.now()-at;await save();
for(const stage of ['seed','rows','list','search']){
  const stageStarted=performance.now();
  const child=spawn(process.execPath,['--max-old-space-size=1536',fileURLToPath(new URL('./measure-worker.mjs',import.meta.url)),directory,stage],
    {stdio:['ignore','pipe','pipe']});
  const log=createWriteStream(path.join(directory,`${stage}.log`));child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  let timeout=false,peakRssBytes=0,samplingError=null;
  // Parent sampling also survives child OOM. macOS/Linux ps reports KiB.
  const sample=setInterval(()=>{
    try{execFile('ps',['-o','rss=','-p',String(child.pid)],(error,stdout)=>{
      if(error){samplingError=error.code||'sample_failed';return;}
      if(Number.isFinite(Number(stdout.trim())))peakRssBytes=Math.max(peakRssBytes,Number(stdout.trim())*1024);
    });}catch(error){samplingError=error.code||'sample_failed';}
  },500);
  const timer=setTimeout(()=>{timeout=true;child.kill('SIGKILL');},report.limits.perStageMs);
  const outcome=await new Promise(resolve=>{
    child.once('error',error=>resolve({exitCode:null,signal:null,error:error.message}));
    child.once('close',(exitCode,signal)=>resolve({exitCode,signal}));
  });
  clearInterval(sample);clearTimeout(timer);log.end();
  let measured;try{measured=JSON.parse(await readFile(path.join(directory,`${stage}.json`),'utf8'));}catch{measured={};}
  report.stages.push({...measured,stage,...outcome,processElapsedMs:performance.now()-stageStarted,
    status:timeout?'timeout':outcome.exitCode===0&&measured.status==='completed'?'completed':'failed',
    samplingError,sampledPeakRssBytes:peakRssBytes,peakRssBytes:Math.max(peakRssBytes,measured.peakRssBytes||0)});
  await save();console.log(JSON.stringify(report.stages.at(-1)));
  if(stage==='seed'&&report.stages.at(-1).status!=='completed')break;
}
report.finishedAt=new Date().toISOString();
const search=report.stages.find(s=>s.stage==='search'), list=report.stages.find(s=>s.stage==='list');
const complete=search?.status==='completed'&&search.queries?.length===240;
const times=(search?.queries||[]).map(q=>q.ms).sort((a,b)=>a-b);
report.results={listApiPassed:list?.status==='completed'&&list.rowCountCorrect&&list.listApiMs<=300,
  memoryPassed:report.stages.length===4&&report.stages.every(s=>s.status==='completed'&&s.peakRssBytes<=500*1024**2),
  querySetComplete:complete,searchP95Ms:complete?times[Math.ceil(times.length*.95)-1]:null,
  observedQueryCount:times.length,partialSearchP95Ms:times.length?times[Math.ceil(times.length*.95)-1]:null};
await save();
console.log(JSON.stringify({report:path.join(directory,'report.json'),results:report.results}));
