import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {codeMap} from '../runtime/code-map.mjs';
import {runCodeAnalysis} from '../runtime/code-quality.mjs';
import {codeMapContext} from '../runtime/code-map.mjs';
import {Worker} from 'node:worker_threads';
const label=process.argv[2]||'current',functionsPerFile=Number(process.argv[3]||1000),out=path.resolve('verification/read-task-isolation'),root=await mkdtemp(path.join(os.tmpdir(),'nubi-read-bench-'));
const inline=process.argv[4]==='inline',mapEngine=inline?(await import('../runtime/code-map-core.mjs')).codeMap:codeMap;
const analysisEngine=inline?input=>new Promise((resolve,reject)=>{const worker=new Worker(new URL('../runtime/code-analysis-worker.mjs',import.meta.url),{workerData:input,execArgv:[],resourceLimits:{maxOldGenerationSizeMb:256}});worker.once('message',value=>{void worker.terminate();resolve(value);});worker.once('error',reject);}):runCodeAnalysis;
await mkdir(out,{recursive:true});await mkdir(path.join(root,'src'));
const paths=Array.from({length:120},(_,i)=>`src/module-${i}.ts`);
for(const [i,rel]of paths.entries())await writeFile(path.join(root,rel),`import {f0 as next} from './module-${(i+1)%paths.length}';\n`+Array.from({length:functionsPerFile},(_,j)=>`export function f${j}(value:number){return value+${j};}`).join('\n'));
async function measured(operation){let last=performance.now(),maxDelayMs=0,ticks=0,peakRss=process.memoryUsage().rss;const timer=setInterval(()=>{const now=performance.now();maxDelayMs=Math.max(maxDelayMs,now-last-5);last=now;ticks++;peakRss=Math.max(peakRss,process.memoryUsage().rss);},5),at=performance.now();try{const value=await operation(),elapsedMs=performance.now()-at;await delay(15);return {elapsedMs,maxDelayMs,ticks,peakRss,resultHash:createHash('sha256').update(JSON.stringify(value)).digest('hex')};}finally{clearInterval(timer);}}
const inputs={};for(const file of ['runtime/code-map.mjs','runtime/code-quality.mjs','runtime/code-map-core.mjs','runtime/code-map-graph.mjs','runtime/read-task-pool.mjs','runtime/read-task-worker.mjs'])try{inputs[file]=createHash('sha256').update(await readFile(file)).digest('hex');}catch(error){if(error.code!=='ENOENT')throw error;}
const result={label,inline,node:process.version,platform:process.platform,files:120,functionsPerFile,inputs,map:[],analysis:[],boundary:'Local synthetic source corpus; event-loop heartbeat in the owning service-equivalent Node process. Inline baseline uses the unchanged map algorithm in process and one parser thread per request; isolated uses the production navigation projection. Compare identical rank/summary/context hashes. Not Windows, real-model throughput, or full-app end-to-end latency.'};
try{
 for(let i=0;i<2;i++)result.map.push(await measured(async()=>{const map=await mapEngine(root,paths,{projection:'navigation'});return {ranking:map.ranking,summary:map.summary,context:codeMapContext(map)};}));
 for(let i=0;i<6;i++)result.analysis.push(await measured(()=>analysisEngine({mode:'quality',path:'example.ts',before:'export const value:number=1;',after:'export const value:number=2;'})));
 try{const {readTasks}=await import('../runtime/read-task-pool.mjs');result.children=readTasks.snapshot();await readTasks.close();}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
 await writeFile(path.join(out,label+'.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await rm(root,{recursive:true,force:true});}
