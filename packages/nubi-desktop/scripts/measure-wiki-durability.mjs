import {randomInt,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

export const DURABILITY_FAULTS=Object.freeze(['network','rate_limit','server_error','timeout','output_limit','app_restart','sleep_resume','model_reconnect']);

// Stratified random sampling: every fault occurs once, twelve are sampled,
// then all twenty are shuffled. The seed is retained, never retried for a pass.
export function durabilitySchedule(seed){
 if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw Error('invalid_seed');
 let state=seed;const next=()=>{state=(state+0x6D2B79F5)>>>0;let value=Math.imul(state^(state>>>15),1|state);value^=value+Math.imul(value^(value>>>7),61|value);return ((value^(value>>>14))>>>0)/4294967296;};
 const rows=[...DURABILITY_FAULTS];while(rows.length<20)rows.push(DURABILITY_FAULTS[Math.floor(next()*8)]);
 for(let i=rows.length-1;i>0;i--){const j=Math.floor(next()*(i+1));[rows[i],rows[j]]=[rows[j],rows[i]];}
 return rows;
}

export function summarizeDurability(rows){
 if(rows.length!==20)throw Error('twenty_runs_required');
 const completedWithoutHuman=rows.filter(row=>row.state==='completed'&&row.verified===true&&row.manualRetries===0).length;
 const completionRate=completedWithoutHuman/20;
 const observed=key=>rows.map(row=>row[key]).filter(value=>Number.isSafeInteger(value)&&value>=0),resumes=observed('resumes'),partials=observed('partialPublications');
 const completionThresholdPassed=completionRate>=.9,metricsComplete=resumes.length===20&&partials.length===20;
 return {runs:20,completedWithoutHuman,completionRate,minimumCompletionRate:.9,completionThresholdPassed,metricsComplete,passed:completionThresholdPassed&&metricsComplete,
   resumeSamples:resumes.length,meanResumes:resumes.length===20?resumes.reduce((sum,value)=>sum+value,0)/20:null,
   partialPublicationSamples:partials.length,partialPublications:partials.length===20?partials.reduce((sum,value)=>sum+value,0):null};
}

export async function reserveDurabilityOutput(output,initial){
 await mkdir(path.dirname(output),{recursive:true});
 await writeFile(output,JSON.stringify(initial,null,2)+'\n',{flag:'wx'});
 return value=>writeFile(output,JSON.stringify(value,null,2)+'\n');
}

export async function measureWikiDurability({seed=randomInt(0x100000000),run=async args=>(await import('../tests/helpers/wiki-durability-fixture.mjs')).runDurabilityScenario(args),onProgress=async()=>{}}={}){
 const schedule=durabilitySchedule(seed),rows=[];
 for(const [index,injection] of schedule.entries()){
   const started=performance.now();let row;
   try{row=await run({injection,index,seed});}
   catch(error){const code=String(error?.code||error?.message||'measurement_failed');row={state:'failed',verified:false,manualRetries:0,resumes:null,partialPublications:null,error:/^[a-z_]{1,100}$/.test(code)?code:'measurement_failed'};}
   rows.push({...row,run:index+1,injection,durationMs:performance.now()-started});
   await onProgress({status:'running',seed,expectedRuns:20,rows:[...rows]});
 }
 return {schemaVersion:1,seed,sampling:'eight faults once + twelve seeded samples, then Fisher-Yates shuffle; no omitted or retried runs',...summarizeDurability(rows),rows};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const options=process.argv.slice(2),args={};
 for(let i=0;i<options.length;i+=2){if(!['--seed','--output'].includes(options[i])||options[i+1]===undefined)throw Error('invalid_arguments');args[options[i]]=options[i+1];}
 const seed=args['--seed']===undefined?randomInt(0x100000000):Number(args['--seed']);durabilitySchedule(seed);
 const output=path.resolve(args['--output']||'verification/wiki-durability/q1-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
 const root=fileURLToPath(new URL('../',import.meta.url)),inputs={};
 for(const file of ['scripts/measure-wiki-durability.mjs','tests/helpers/wiki-durability-fixture.mjs','runtime/wiki-update.mjs','runtime/wiki-run-journal.mjs','runtime/wiki-durable-policy.mjs','runtime/desktop-features.mjs','generated/openwiki-update/index.mjs'])inputs[file]=createHash('sha256').update(await readFile(path.join(root,file))).digest('hex');
 const metadata={startedAt:new Date().toISOString(),platform:process.platform,node:process.version,inputs,boundary:'Synthetic corpus/provider; actual Desktop transport, native OpenWiki planning/page/review/Claims queue, SQLite, Git copy and publication. App restart abruptly exits only the owned fixture process and reopens its saved state. Sleep/reconnect are host events. Host retry waits use virtual time, recorded per run; synthetic 429 advertises 1ms. No physical sleep, company model or Windows claim.'};
 const persist=await reserveDurabilityOutput(output,{...metadata,status:'running',seed,expectedRuns:20,rows:[]});
 const result=await measureWikiDurability({seed,onProgress:async progress=>{
   await persist({...metadata,...progress});const row=progress.rows.at(-1);console.log(JSON.stringify({run:row.run,injection:row.injection,state:row.state,verified:row.verified,error:row.error}));
 }});
 await persist({...metadata,...result,status:result.passed?'passed':'failed',finishedAt:new Date().toISOString()});
 console.log(JSON.stringify({output,runs:result.runs,completionRate:result.completionRate,meanResumes:result.meanResumes,partialPublications:result.partialPublications,passed:result.passed}));process.exitCode=result.passed?0:1;
}
