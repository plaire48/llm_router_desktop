import {evidenceRequirements} from './workflow-completion.mjs';
const tools=new Set(['read_source','source_search','wiki_query','ask_openwiki','read_personal_mail']);
function sources(tool,result){
 if(tool==='read_personal_mail')return result?.id&&result.sourceHash?[{kind:'mail',mailId:result.id,hash:result.sourceHash}]:[];
 const rows=tool==='read_source'?[result]:tool==='ask_openwiki'?result.citations||[]:result.results||[];
 return rows.slice(0,40).flatMap(row=>{
  const start=row.provenance?.start??row.start??row.line,end=row.provenance?.end??row.end??row.line;
  if(typeof row.path!=='string'||typeof row.hash!=='string'||!row.hash)return [];
  if(tool!=='wiki_query'&&tool!=='ask_openwiki'&&(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<1||end<start))return [];
  return [{kind:tool==='wiki_query'||tool==='ask_openwiki'?'wiki':'source',path:row.path,hash:row.hash,...(Number.isSafeInteger(start)?{start,end}:{})}];
 });
}
export function recordWorkflowEvidence(service,task,context,operation,result,traceId){
 if(!context||!tools.has(operation.tool)||!result||result.error||result.ok===false||result.deferred)return result;
 const entry=task.trace.find(row=>row.id===traceId&&row.runId===operation.runId&&row.tool===operation.tool);const observed=sources(operation.tool,result);
 if(!entry||!observed.length)return result;
 const receipt={id:'operation:'+operation.id,workflowRunId:context.run.id,stepId:context.step.id,taskId:task.id,agentRunId:operation.runId,sources:observed};
 operation.workflowEvidence=receipt;service.store.set('operation:'+operation.id,operation);
 entry.workflowEvidence=[...(entry.workflowEvidence||[]).filter(row=>row.id!==receipt.id),receipt];
 return {...result,workflowEvidence:[receipt]};
}
export function assertWorkflowEvidence(service,task,run,step,output){
 for(const requirement of evidenceRequirements(step)){
  const values=output[requirement.field]??[];
  if(!Array.isArray(values))throw Error('workflow_evidence_invalid');
  const ids=values.map(value=>typeof value==='string'?value:value?.id);
  if(new Set(ids).size<requirement.min)throw Error('workflow_evidence_invalid');
  for(const id of ids){
   if(typeof id!=='string'||!id.startsWith('operation:'))throw Error('workflow_evidence_invalid');
   const operation=service.store.get(id),receipt=operation?.workflowEvidence;
   const trace=task.trace?.find(row=>row.runId===receipt?.agentRunId&&row.workflowEvidence?.some(value=>value.id===id));
   if(operation?.state!=='completed'||operation.taskId!==task.id||!receipt||receipt.workflowRunId!==run.id||receipt.stepId!==step.id||receipt.taskId!==task.id||!tools.has(operation.tool)||operation.runId!==receipt.agentRunId||!trace||!receipt.sources?.length||JSON.stringify(trace.workflowEvidence.find(value=>value.id===id))!==JSON.stringify(receipt))throw Error('workflow_evidence_invalid');
  }
 }
}
