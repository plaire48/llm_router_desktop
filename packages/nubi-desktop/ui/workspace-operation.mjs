import {currentActivityRunId} from './conversation-activity.mjs';
import {contextProgressLabel} from './context-progress.mjs';
import {toolIcon} from './tool-icon.mjs';
import {mcpActivityLabels} from './mcp-activity.mjs';
export function workspaceOperation({task,action,busy=false,processes=[]},toolLabels={}){
 if(!task)return null;
 const commandRunning=processes.some(row=>row.taskId===task.id&&['checking','running','stopping'].includes(row.state));
 const result=(label,state='running',icon)=>({label,state,taskId:task.id,...(icon?{icon}:{})});
 if(busy&&action?.taskId===task.id)return result(action.label||'요청한 동작 처리 중');
 if(task.state==='waiting_input'&&task.question)return result(task.question.toolRequest||task.question.nativeOfficeApproval?'승인 대기':'답변 대기','waiting');
 if(task.state==='running'){
  const context=contextProgressLabel(task.context);if(context)return result(context);
  const runId=currentActivityRunId(task),step=runId?(task.trace||[]).findLast(row=>row.status==='running'&&(row.runId===runId||row.id?.startsWith(runId+':'))&&row.tool!=='progress_note'&&row.tool!=='update_plan'):null;
  if(step){const label=toolLabels[step.tool]||mcpActivityLabels([step])[step.tool];return result(label?`${label} 중`:'도구 실행 중','running',toolIcon(step.tool));}
  if(task.streamingAnswer?.trim())return result('답변 작성 중');
  if(commandRunning)return result('명령 실행 중','running','terminal');
  if(task.checkpoint?.phase==='planning')return result('작업 계획 정리 중');
  return result('모델 응답 기다리는 중');
 }
 if(commandRunning)return result('명령 실행 중','running','terminal');
 return null;
}
