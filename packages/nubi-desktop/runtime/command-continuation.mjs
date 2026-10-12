import {createHash} from 'node:crypto';
import {planningRequests,workIntent,workPlanSteps} from './work-plan.mjs';

// Reuse an interpretation, never observations, permission or a completion claim.
export function continuationBinding({task,workspace,rules,scope,skills}) {
  return createHash('sha256').update(JSON.stringify({
    requests:planningRequests(task),criteria:task.criteria,answers:task.questionHistory||[],
    workspace,rules,scope,mail:task.mailReferences||[],
    skills:skills.map(({path,hash})=>({path,hash})).sort((a,b)=>a.path.localeCompare(b.path)),
  })).digest('hex');
}

export function continueCommandPlan({task,process,action,binding,runId,capabilities}) {
  const plan=task.workPlan,held=plan?.commandContinuation;
  if(!held||held.binding!==binding||held.actionId!==action?.id||action.taskId!==task.id||
    action.state!=='started'||action.resultProcessId!==process?.id||
    process.taskId!==task.id||process.setupActionId!==action.id||process.execution!=='started'||
    process.state!=='completed'||process.exitCode!==0||process.stopReason||task.state==='cancelled')return null;
  try {
    const intent=workIntent(plan.intent,capabilities);
    const steps=workPlanSteps({steps:plan.steps.map((step,index)=>({...step,status:index?'pending':'in_progress'}))},{initial:true});
    return {...plan,intent,steps,runId,continuedFrom:plan.runId,commandContinuation:null};
  }catch{return null;}
}
