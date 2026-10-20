import {writeFile} from 'node:fs/promises';
import {createBrowserAddon} from '../dist/index.js';
import {hostFixture,task,action} from '../tests/host.mjs';

// Measures module/host-contract overhead only. It never calls a model or browser.
const runs=100, cold={},samples={attach:[],open:[],observe:[],execute:[],verify:[],detach:[],total:[]};
for(let i=0;i<=runs;i++){
  const {host}=hostFixture(),addon=createBrowserAddon();const start=performance.now();
  const record=(name,value)=>{if(i===0)cold[name]=value;else samples[name].push(value);};
  const timed=async(name,fn)=>{const before=performance.now();const value=await fn();record(name,performance.now()-before);return value;};
  const session=await timed('attach',()=>addon.attach(host,{projectId:'latency-fixture'}));
  await timed('open',()=>session.openTask(task));
  const observation=await timed('observe',()=>session.observe(task.taskId,'tab-1'));
  await timed('execute',()=>session.execute(task.taskId,action(session,observation)));
  const verification=await timed('verify',()=>session.complete(task.taskId));
  if(!verification.completed)throw Error('fixture_verification_failed');
  await timed('detach',()=>addon.detach());record('total',performance.now()-start);
}
const quantile=(xs,p)=>[...xs].sort((a,b)=>a-b)[Math.ceil(xs.length*p)-1];
const report={schemaVersion:1,mode:'in_memory_contract_only',actualModel:false,actualBrowser:false,companySSO:false,warmRuns:runs,firstProcessRun:cold,node:process.version,platform:process.platform,architecture:process.arch,unit:'milliseconds',warmStages:Object.fromEntries(Object.entries(samples).map(([stage,xs])=>[stage,{p50:quantile(xs,.5),p95:quantile(xs,.95),max:Math.max(...xs)}])),limitations:['First process run excludes Node startup, module import, build and fixture creation; warm means runtime reuse, not browser session reuse.','No LLM, network, real browser, Electron, disk store or user wait.','These timings are not end-to-end product latency or evidence of improvement.']};
const output=process.argv[2];if(output)await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
