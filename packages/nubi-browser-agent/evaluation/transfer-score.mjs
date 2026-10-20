import {cases,schedule,summarize} from './transfer-cases.mjs';
const key=x=>`${x.caseId}/${x.arm}/${x.index}`;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
/** Refuse partial, duplicate or contaminated cohorts; never remove a failed planned trial. */
export function scoreTransfer(report){
  const errors=[],expected=schedule(),planned=new Set(expected.map(key)),seen=new Set();
  if(report.contract!=='naver-memory-transfer-v1'||report.stage!=='measure'||report.actualModel!==true||report.actualBrowser!==true||report.actualPi!==true)errors.push('evaluation_contract_invalid');
  if(!same(report.schedule,expected))errors.push('schedule_changed');
  if(!report.finishedAt)errors.push('cohort_unfinished');
  if(report.memoryUnchanged!==true||!report.memoryBefore||!same(report.memoryBefore,report.memoryAfter))errors.push('memory_changed_or_missing');
  if(!Array.isArray(report.trials)||report.trials.length!==expected.length)errors.push('trial_count_invalid');
  for(const row of report.trials??[]){
    const id=key(row);if(!planned.has(id))errors.push('unplanned_trial:'+id);if(seen.has(id))errors.push('duplicate_trial:'+id);seen.add(id);
    if(!Number.isFinite(row.totalMs)||row.totalMs<0)errors.push('trial_unfinished:'+id);
    if(row.analysisCalls!==0)errors.push('online_analysis_not_frozen:'+id);
    if(row.arm==='none'&&(row.usedProcedure||row.wikiDelivered))errors.push('baseline_memory_leak:'+id);
    if(row.success){
      const task=cases.find(x=>x.id===row.caseId),checks=row.verifications?.at(-1);
      if(row.state!=='COMPLETED'||!checks||!['query','freshDocuments','items','fields','summary'].every(k=>checks[k]===true))errors.push('success_without_verification:'+id);
      if(!task||row.oracle?.length!==task.kinds.length||new Set(row.oracle?.map(x=>x.kind)).size!==task.kinds.length||!task.kinds.every(kind=>row.oracle.some(o=>o.kind===kind&&['endpoint','display','sort','time'].every(k=>o[k]===true))))errors.push('fresh_oracle_missing:'+id);
    }
  }
  for(const id of planned)if(!seen.has(id))errors.push('missing_trial:'+id);
  if(errors.length)return {scored:false,errors};
  return {scored:true,errors:[],summary:summarize(report)};
}
