import {randomUUID} from 'node:crypto';
import {fail} from './files.mjs';
import {cleanModelText} from './model-text.mjs';
export const SIDE_TASK_LIMIT=3;
const PATH=/[\w./-]+\.(?:mjs|cjs|js|jsx|ts|tsx|md|css|json|yml|yaml|py|ps1|java|cs)\b/;
export function proposeSideTask(task,{title,tldr,prompt,runId}={}){
 if([title,tldr,prompt,runId].some(value=>typeof value!=='string'))fail('side_task_invalid');
 const name=cleanModelText(title),summary=cleanModelText(tldr),body=cleanModelText(prompt);
 if(!name||name.length>60||!summary||summary.length>240||body.startsWith('/')||body.length<200||body.length>4000||!PATH.test(body)||!runId)fail('side_task_invalid');
 task.sideTasks=Array.isArray(task.sideTasks)?task.sideTasks:[];if(task.sideTasks.filter(row=>row.runId===runId).length>=SIDE_TASK_LIMIT)fail('side_task_limit');
 const chip={id:randomUUID(),title:name,tldr:summary,prompt:body,runId,state:'proposed',at:new Date().toISOString()};task.sideTasks.push(chip);return chip;
}
export function transitionSideTask(task,id,state){
 const chip=task.sideTasks?.find(row=>row.id===id);if(!chip)fail('side_task_missing');
 if(chip.state!=='proposed'||!['started','dismissed'].includes(state))fail('side_task_state');
 chip.state=state;chip.changedAt=new Date().toISOString();return chip;
}
// A UI decision may arrive while the agent is awaiting a model response.
export function mergeSideTasks(current=[],incoming=[]){
 const merged=new Map(current.map(chip=>[chip.id,chip]));
 for(const chip of incoming){const saved=merged.get(chip.id);if(!saved||saved.state==='proposed')merged.set(chip.id,chip);}
 return [...merged.values()];
}
function bound(service,{projectId,taskId,sideTaskId}){
 service.ready();if(projectId!==undefined&&projectId!==service.projectId)fail('project_changed');
 const task=service.task(taskId),chip=task.sideTasks?.find(row=>row.id===sideTaskId);if(!chip)fail('side_task_missing');return {task,chip};
}
export function dismissSideTask(service,args){
 const {task,chip}=bound(service,args);
 if(args.runId!==undefined&&args.runId!==chip.runId||service.sideTaskStarts?.has(chip.id))fail('side_task_state');
 transitionSideTask(task,chip.id,'dismissed');service.store.set('task:'+task.id,task);return {id:chip.id,state:chip.state};
}
export async function startSideTask(service,args){
 const {task,chip}=bound(service,args);service.sideTaskStarts ||= new Map();
 if(service.sideTaskStarts.has(chip.id))return service.sideTaskStarts.get(chip.id).promise;
 if(chip.state==='started'&&chip.startedTaskId){service.task(chip.startedTaskId);return {taskId:chip.startedTaskId};}
 if(chip.state!=='proposed')fail('side_task_state');
 const entry={taskId:task.id};service.sideTaskStarts.set(chip.id,entry);
 entry.promise=(async()=>{
  try{
   const created=await service.createTask({request:chip.prompt,origin:{kind:'side_task',taskId:task.id,sideTaskId:chip.id,runId:chip.runId}});
   const latest=service.task(task.id),started=transitionSideTask(latest,chip.id,'started');started.startedTaskId=created.id;
   service.store.set('task:'+task.id,latest);return {taskId:created.id};
  }finally{service.sideTaskStarts.delete(chip.id);}
 })();return entry.promise;
}
