import path from 'node:path';
import {humanDecisions} from '../ui/human-decisions.mjs';

// Called only after a run persists its delivered answer, never from polling or
// history replay. Notification transport must not affect the saved answer.
export function notifyDeliveredAnswer(service,task,runId){
  if(typeof service.notifyAnswer!=='function'||task.state!=='review'||task.error||task.question||
    task.responseTiming?.runId!==runId||task.responseTiming.state!=='completed')return;
  const message=task.messages?.at(-1);
  if(message?.role!=='assistant'||message.runId!==runId||message.questionId||message.error||!message.content?.trim())return;
  try{
    const state=service.state({taskId:task.id});
    if(humanDecisions({...state,projectId:service.projectId,tasks:[task]}).length)return;
    const notice={projectId:service.projectId,taskId:task.id,runId,workspaceKind:service.workspaceKind==='conversation'?'conversation':'project',
      projectName:service.workspaceKind==='conversation'?'개인 대화':path.basename(service.root),
      taskTitle:String(task.request||'').slice(0,200)};
    Promise.resolve(service.notifyAnswer(notice)).catch(()=>{});
  }catch{/* OS/IPC failures never change task completion. */}
}
