// Reporting only. This never changes frozen cases, checks or recorded outcomes.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const [beforeDir,afterDir]=process.argv.slice(2);
if(!beforeDir||!afterDir)throw Error('usage: node compare.mjs BASELINE CANDIDATE');
const read=async dir=>JSON.parse(await readFile(path.join(dir,'report.json'),'utf8'));
const [before,after]=await Promise.all([read(beforeDir),read(afterDir)]);
for(const [dir,report] of [[beforeDir,before],[afterDir,after]]){
 try{
  const audit=JSON.parse(await readFile(path.join(dir,'source-audit.json'),'utf8'));
  if(audit.benchmarkHash!==report.benchmarkHash||audit.candidateHash!==report.candidate.hash)throw Error('audit_identity_changed');
  report.sourceAudit=audit;
 }catch(error){if(error.code!=='ENOENT')throw error;}
}
if(!before.finishedAt||!after.finishedAt)throw Error('evaluation_not_finished');
if(before.benchmarkHash!==after.benchmarkHash)throw Error('benchmark_changed');
if(before.concurrency!==after.concurrency||before.modelConfiguration.model!==after.modelConfiguration.model||before.modelConfiguration.reasoningEffort!==after.modelConfiguration.reasoningEffort)throw Error('conditions_changed');
const modelLimits=report=>{const m=report.modelConfiguration.models.find(m=>m.id===report.modelConfiguration.model);return [m?.contextLength,m?.maxInputTokens,m?.maxOutputTokens];};
if(before.platform!==after.platform||before.node!==after.node||before.trials!==after.trials||JSON.stringify(before.limits)!==JSON.stringify(after.limits)||JSON.stringify(modelLimits(before))!==JSON.stringify(modelLimits(after)))throw Error('environment_or_limits_changed');
const median=values=>{const v=values.toSorted((a,b)=>a-b),n=v.length;return n?n%2?v[(n-1)/2]:(v[n/2-1]+v[n/2])/2:null;};
const passed=(r,name)=>r.checks?.find(c=>c.name===name)?.passed===true;
function aggregate(report,category){
 const rows=report.results.filter(r=>!category||r.category===category),delivered=rows.filter(r=>passed(r,'delivered'));
 return {planned:rows.length,executed:rows.filter(r=>r.outcome!=='not_run').length,strictPass:rows.filter(r=>r.passed).length,delivered:delivered.length,factsAndRows:rows.filter(r=>passed(r,'answer_facts')&&passed(r,'bound_rows')).length,errors:rows.filter(r=>r.outcome==='error').length,needsHuman:rows.filter(r=>r.outcome==='needs_human').length,mainCalls:rows.reduce((n,r)=>n+(r.modelCalls||0),0),delegatedCalls:rows.reduce((n,r)=>n+(r.delegatedCalls||0),0),medianDeliveredSeconds:median(delivered.map(r=>Math.round(r.elapsedMs/1000))),medianAllSeconds:median(rows.filter(r=>Number.isFinite(r.elapsedMs)).map(r=>Math.round(r.elapsedMs/1000)))};
}
const audited=(report,category)=>report.sourceAudit?report.sourceAudit.rows.filter(r=>(category==='total'||r.id.startsWith(category+'-'))&&r.auditedPass).length:null;
const comparison={benchmarkHash:before.benchmarkHash,beforeCandidate:before.candidate,afterCandidate:after.candidate,beforeUnchanged:before.candidateUnchanged,afterUnchanged:after.candidateUnchanged,model:after.modelConfiguration.model,reasoningEffort:after.modelConfiguration.reasoningEffort,concurrency:after.concurrency,limitations:after.limitations,categories:Object.fromEntries(['bash','mail','skill','wiki','total'].map(c=>[c,{before:{...aggregate(before,c==='total'?null:c),sourceAuditPass:audited(before,c)},after:{...aggregate(after,c==='total'?null:c),sourceAuditPass:audited(after,c)}}])),cases:before.results.map(b=>{const a=after.results.find(a=>a.id===b.id);return {id:b.id,before:b.outcome,after:a.outcome,beforeSeconds:Math.round((b.elapsedMs||0)/1000),afterSeconds:Math.round((a.elapsedMs||0)/1000),beforeFailed:b.checks?.filter(c=>!c.passed).map(c=>c.name),afterFailed:a.checks?.filter(c=>!c.passed).map(c=>c.name)};})};
await writeFile(path.join(afterDir,'comparison.json'),JSON.stringify(comparison,null,2)+'\n');
console.log(JSON.stringify(comparison.categories,null,2));
