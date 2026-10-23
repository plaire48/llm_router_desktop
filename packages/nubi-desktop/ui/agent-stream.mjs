import {mergeSnapshot} from './mergeSnapshot.js';
export function mergeAgentStream(project,projectId,stream){
 if(!project||project.projectId!==projectId||!stream)return project;
 const task=project.tasks?.find(item=>item.id===stream.taskId);
 if(task?.state!=='running'||task.responseTiming?.runId!==stream.runId||(task.streamRevision||0)>stream.streamRevision)return project;
 const updated={...task,streamRevision:stream.streamRevision,streamingAnswer:stream.streamingAnswer,streamingReasoning:stream.streamingReasoning,responseTiming:{...task.responseTiming,...stream.timing}};
 return mergeSnapshot(project,{tasks:project.tasks.map(item=>item===task?updated:item)});
}
