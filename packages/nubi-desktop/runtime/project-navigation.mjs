import {humanDecisions} from '../ui/human-decisions.mjs';

// Cancellation belongs to the original service and its journals. Never dispose
// that service or change a run's root while its response is still settling.
export function stopProjectWork(service,{timeoutMs=15000}={}){
 if(!service.root)return Promise.resolve();
 if(!service.navigationStop){
  service.navigationEpoch=(service.navigationEpoch||0)+1;
  service.navigationStopping=true;
  const operation=Promise.resolve().then(async()=>{
   const tasks=new Set(humanDecisions({...service.state(),projectId:service.projectId}).map(item=>item.taskId));
   const memories=[...service.memoryJobs?.values()||[]];for(const job of memories)job.controller.abort();
   for(const run of service.agentRuns?.values()||[])if(run.running)tasks.add(run.taskId);
   if(service.agent?.running)tasks.add(service.agent.taskId);
   for(const pending of service.repairStarts?.values()||[])tasks.add(pending.taskId);
   for(const id of service.afterEditChecks?.keys()||[])tasks.add(id);
   const processes=service.processes;
   for(const id of new Set([...processes?.pending||[],...processes?.active.keys()||[]])){
    const record=processes.records.get(id)||service.store.get('process:'+id);if(record?.taskId)tasks.add(record.taskId);
   }
   service.store.event('project_navigation_stopping',{taskIds:[...tasks]});
   const stopping=[...tasks].map(taskId=>service.stopAgent({taskId}));
   for(const id of new Set([...processes?.pending||[],...processes?.active.keys()||[]]))processes.stop(id);
   const results=await Promise.allSettled(stopping);
   await Promise.allSettled([...(service.afterEditChecks?.values()||[]),...[...service.sideTaskStarts?.values()||[]].map(item=>item.promise),...memories.map(job=>job.promise)]);
   while(processes?.pending.size||processes?.active.size||service.repairStarts?.size||[...service.agentRuns?.values()||[]].some(run=>run.running))await new Promise(resolve=>setTimeout(resolve,25));
   if(results.some(result=>result.status==='rejected'))throw Error('project_navigation_stop_failed');
   service.store.event('project_navigation_stopped',{taskIds:[...tasks]});
  });
  service.navigationStop=operation;
  const clear=()=>{if(service.navigationStop===operation){service.navigationStop=null;service.navigationStopping=false;}};
  void operation.then(clear,clear);
 }
 let timer;
 return Promise.race([service.navigationStop,new Promise((resolve,reject)=>{timer=setTimeout(()=>reject(Error('project_navigation_stop_pending')),timeoutMs);})]).finally(()=>clearTimeout(timer));
}
