import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)]:null;
export function compareTrials(reports){
  const groups=new Map();
  for(const report of reports){
    if(report.status!=='measured'||!report.sourceHash||!report.model)throw new Error('comparison_requires_measured_runs');
    const configuration={provider:report.provider,model:report.model,caseVersion:report.caseVersion,sourceHash:report.sourceHash,analysisConcurrency:report.analysisConcurrency};
    const key=JSON.stringify(configuration);if(!groups.has(key))groups.set(key,{configuration,trials:0,passed:0,failed:0,pending:0,durations:[],calls:[],cases:new Map()});
    const group=groups.get(key);group.trials++;
    for(const result of report.cases){
      group[result.passed===true?'passed':result.passed===false?'failed':'pending']++;
      if(!group.cases.has(result.id))group.cases.set(result.id,[]);group.cases.get(result.id).push(result.passed);
      // Keep failure latency out of successful-task speed comparisons.
      if(result.passed===true&&Number.isFinite(result.metrics?.elapsedMs))group.durations.push(result.metrics.elapsedMs);
      if(Number.isFinite(result.metrics?.modelCalls))group.calls.push(result.metrics.modelCalls);
    }
  }
  return{kind:'measured-harness-comparison',groups:[...groups.values()].map(g=>({configuration:g.configuration,trials:g.trials,passed:g.passed,failed:g.failed,pending:g.pending,successfulLatency:{samples:g.durations.length,p50Ms:percentile(g.durations,.5),p95Ms:percentile(g.durations,.95)},modelCalls:{samples:g.calls.length,p50:percentile(g.calls,.5),p95:percentile(g.calls,.95)},repeatability:[...g.cases].map(([id,results])=>({id,trials:results.length,allPassed:results.every(r=>r===true),passed:results.filter(r=>r===true).length,pending:results.filter(r=>r===null).length}))})),limitations:['No performance or accuracy inference is made for absent environments.','Small samples and correlated repeated cases are not population accuracy or confidence intervals.','Token prices are not configured; monetary cost is unmeasured.']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const paths=process.argv.slice(2);if(paths.length<2)throw new Error('comparison_needs_two_reports');
  console.log(JSON.stringify(compareTrials(await Promise.all(paths.map(async path=>JSON.parse(await readFile(path,'utf8'))))),null,2));
}
