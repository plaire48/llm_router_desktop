import Ajv from 'ajv';
import {expandStepTools} from './workflow-tools.mjs';
import {markStep} from './workflow-run.mjs';
import {hash} from './files.mjs';
import {assertStepPermissions} from './workflow-policy.mjs';
export const STEP_GOAL_SUFFIX='새 파일은 inspect_path와 record_change_plan 뒤에 제안하고, 끝나면 submit_step_output으로 결과를 제출하라.';
export const STEP_OUTPUT_TOOL={type:'function',function:{name:'submit_step_output',description:"Submit this step's result object; the host validates it against the declared schema.",parameters:{type:'object',required:['output'],additionalProperties:false,properties:{output:{type:'object'}}}}};
export function workflowStepContext(service,task){
 if(task.origin?.kind!=='workflow_step')return null;
 const run=service.store.get('workflow-run:'+task.origin.runId),step=run?.workflow.steps.find(s=>s.id===task.origin.stepId),checkpoint=run?.steps[step?.id];
 if(!run||step?.kind!=='agent'||checkpoint?.taskId!==task.id||run.cursor!==step.id)throw Error('workflow_binding_changed');
 if(['complete','partial','cancelled','failed'].includes(run.status)||['complete','cancelled'].includes(checkpoint.status))throw Error('workflow_step_closed');
 assertStepPermissions(run.workflow,step);
 const resolved=expandStepTools(step.tools).tools;
 if(JSON.stringify(step.resolvedTools)!==JSON.stringify(resolved))throw Error('workflow_binding_changed');
 const guidance=service.store.get('workflow-guidance:'+run.id);
 if(guidance?.hash!==run.hash)throw Error('workflow_binding_changed');
 return {run,step,checkpoint,readme:guidance.text,allowed:new Set(resolved)};
}
export function workflowStepClosed(service,task){
 const run=service.store.get('workflow-run:'+task.origin.runId),checkpoint=run?.steps[task.origin.stepId];
 return !run||['complete','partial','cancelled','failed'].includes(run.status)||!!checkpoint?.candidate||checkpoint?.submissionErrors>=2;
}
export function submitStepOutput(service,task,output){
 const {run,step,checkpoint}=workflowStepContext(service,task);
 if(checkpoint.candidate||checkpoint.submissionErrors>=2)throw Error('workflow_step_closed');
 const text=JSON.stringify(output);
 if(!validStepOutput(step,output)){
  const count=(checkpoint.submissionErrors||0)+1;markStep(service.store,run.id,step.id,{submissionErrors:count});
  return {ok:false,error:'workflow_output_schema',retry:count<2,instruction:count<2?'Correct the result object once to match the declared output schema.':'Output rejected twice. Stop this step.'};
 }
 // Candidate is not completion. The runner verifies current host evidence separately.
 const key=`workflow-submission:${run.id}:${step.id}`,digest=hash(text),bytes=Buffer.byteLength(text);
 service.store.set(key,{output,hash:digest,bytes});
 markStep(service.store,run.id,step.id,{candidate:{outputRef:{key,hash:digest,bytes}}});return {ok:true,submitted:true,instruction:'Stop this step. The host will verify its completion condition.'};
}
export function validStepOutput(step,output){
 let text;try{text=JSON.stringify(output);}catch{return false;}
 if(!output||typeof output!=='object'||Array.isArray(output)||Buffer.byteLength(text)>1024*1024)return false;
 return new Ajv({strict:false,ownProperties:true,validateFormats:false}).compile(step.outputs?.schema||{type:'object'})(output);
}
export function readStepCandidate(store,checkpoint){
 const ref=checkpoint.candidate?.outputRef,record=ref&&store.get(ref.key);
 if(!record)throw Error('workflow_output_missing');
 const text=JSON.stringify(record.output);
 if(record.hash!==ref.hash||hash(text)!==ref.hash||Buffer.byteLength(text)!==ref.bytes)throw Error('workflow_output_changed');
 return structuredClone(record.output);
}
