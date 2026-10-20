import {randomUUID} from 'node:crypto';
import {wikiChatBlocked} from './wiki-chat-admission.mjs';
import {humanDecisions} from '../ui/human-decisions.mjs';
import {loadWorkflowPackage,saveWorkflowSchedule,formatWorkflowSchedule} from './workflow-package.mjs';
const SLUG=/^[a-z0-9][a-z0-9-]{0,79}$/;
const fail=code=>{throw Error(code);};
const iso=value=>new Date(value).toISOString();
function slot(routine,now,next){
 const s=routine.schedule,m=/^(\d{2}):(\d{2})$/.exec(s?.time||'');
 if(!m||+m[1]>23||+m[2]>59||!['daily','weekly'].includes(s.kind)||s.kind==='weekly'&&(!Number.isInteger(s.weekday)||s.weekday<0||s.weekday>6))fail('routine_invalid');
 const date=new Date(now);if(!Number.isFinite(+date))fail('routine_invalid');date.setHours(+m[1],+m[2],0,0);
 if(s.kind==='weekly')date.setDate(date.getDate()+s.weekday-date.getDay());
 const days=s.kind==='weekly'?7:1;
 if(next&&+date<=+new Date(now))date.setDate(date.getDate()+days);
 if(!next&&+date>+new Date(now))date.setDate(date.getDate()-days);
 return date;
}
export const nextRun=(routine,now=new Date())=>slot(routine,now,true).toISOString();
export function dueRoutines(store,now=new Date()){
 return store.list('routine:').filter(r=>{try{const at=+slot(r,now,false);return r.enabled===true&&(!r.createdAt||Date.parse(r.createdAt)<=at)&&(!r.lastRunAt||Date.parse(r.lastRunAt)<at);}catch{return false;}});
}
export function createRoutineScheduler({store,run,now=()=>Date.now(),interval=60000,isBusy=()=>false,canRun=()=>true}){
 let timer,stopped=false,queue=Promise.resolve(),pending=0;
 const serial=work=>{const result=queue.then(work);queue=result.catch(()=>{});return result;};
 const update=(id,values)=>{const current=store.get('routine:'+id);if(current)store.set('routine:'+id,{...current,...values});};
 async function execute(id,manual){
  if(stopped)return {skipped:true};
  const routine=store.get('routine:'+id);if(!routine)fail('routine_missing');const revision=JSON.stringify(routine);
  if(!manual&&!dueRoutines(store,now()).some(row=>row.id===id))return {skipped:true};
  if(await isBusy(routine)){if(manual)fail('routine_busy');return {skipped:true};}
  if(!await canRun(routine)){if(manual)fail('routine_not_ready');return {skipped:true};}
  if(stopped||JSON.stringify(store.get('routine:'+id))!==revision){if(manual)fail('routine_changed');return {skipped:true};}
  // Reserve before any task/model side effect. Restart never repeats this slot.
  update(id,{lastRunAt:iso(now()),lastProjectId:routine.projectId,lastSettledTaskId:null,lastError:null});pending++;
  try{const result=await run(routine,{recordTask:taskId=>update(id,{lastTaskId:taskId})});update(id,{lastTaskId:result.taskId,lastError:null});return result;}
  catch(error){const code=/^[a-z_]{3,50}$/.test(error.message)?error.message:'routine_failed';update(id,{lastError:code});if(manual)fail(code);return {error:code};}
  finally{pending--;}
 }
 return {get busy(){return pending>0;},runNow:id=>serial(()=>execute(id,true)),tick:()=>serial(async()=>{if(stopped)return;for(const r of dueRoutines(store,now())){try{await execute(r.id,false);}catch{update(r.id,{lastError:'routine_not_ready'});}}}),
  start(){stopped=false;if(timer)return;void this.tick().catch(()=>{});timer=setInterval(()=>{void this.tick().catch(()=>{});},interval);timer.unref?.();},stop(){stopped=true;clearInterval(timer);timer=null;}};
}
export function createRoutineManager({store,listProjects,serviceFor,now=()=>Date.now(),canStart=()=>true,onActivity=()=>{}}){
 const owner=async routine=>{const project=(await listProjects()).find(p=>p.id===routine.projectId);if(!project)fail('project_missing');return serviceFor(project);};
 const watched=new WeakSet();
 const notify=(service,taskId,phase)=>{try{onActivity({projectId:service.projectId,taskId,phase});}catch{/* UI delivery never replays work. */}};
 const notifySupervision=(service,r)=>{try{onActivity({projectId:service.projectId,routineId:r.id,routineName:r.name,slug:r.slug,phase:'supervision_required'});}catch{/* see above */}};
 const pending=(service,r)=>{
  const tasks=service.store.list('task:').filter(task=>task.id===r.lastTaskId||task.routineId===r.id);
  const decisions=humanDecisions({...service.state(),projectId:service.projectId});
  return tasks.some(task=>!['review','completed','failed','cancelled'].includes(task.state)||decisions.some(d=>d.taskId===task.id));
 };
 // Host-observed settlement is bound to the last task. A later resume clears it
 // before project removal; user input cannot supply this proof.
 function observe(service){
  if(!service?.store)return;
  for(const r of store.list('routine:').filter(r=>r.lastProjectId===service.projectId&&r.lastTaskId)){
   const settled=service.store.get('task:'+r.lastTaskId)&&!pending(service,r)?r.lastTaskId:null;
   if(r.lastSettledTaskId===settled)continue;
   const task=settled?service.store.get('task:'+settled):null,success=!!task&&['completed','review'].includes(task.state)&&!task.routineError&&r.kind!=='workflow';
   const successCount=(r.successCount||0)+(success?1:0);store.set('routine:'+r.id,{...r,lastSettledTaskId:settled,successCount});
   // A free request that keeps succeeding is proposed as a workflow exactly once (§3.5 import entry).
   if(success&&successCount>=3&&!service.store.get('workflow-promotion:'+r.id))service.store.set('workflow-promotion:'+r.id,{routineId:r.id,name:r.name,request:r.request,projectId:service.projectId,count:successCount,state:'proposed',createdAt:iso(now())});
  }
  const promise=service.agent?.promise,taskId=service.agent?.taskId;
  if(promise&&typeof promise.then==='function'&&!watched.has(promise)&&store.list('routine:').some(r=>r.lastProjectId===service.projectId&&r.lastTaskId===taskId)){
   watched.add(promise);void Promise.resolve(promise).catch(()=>{}).then(()=>{observe(service);notify(service,taskId,'settled');}).catch(()=>{});
  }
 }
 const scheduler=createRoutineScheduler({store,now,
  isBusy:async r=>{
   const previousId=r.lastProjectId||r.projectId;
   if(!(await listProjects()).some(p=>p.id===previousId)){
    if(r.lastTaskId&&r.lastSettledTaskId===r.lastTaskId)return false;
    fail(r.lastProjectId?'routine_previous_project_missing':'project_missing');
   }
   return pending(await owner({...r,projectId:previousId}),r);
  },
  canRun:async r=>{const service=await owner(r);return canStart()&&service.providers?.status().connected&&!service.agent?.running&&!service.wikiResetting&&!wikiChatBlocked(service);},
  run:async(r,{recordTask})=>{
   const service=await owner(r);
   if(r.kind==='workflow'){
    let run;
    try{run=await service.startWorkflow({slug:r.slug,inputs:r.inputs||{},trigger:{kind:'routine',routineId:r.id,routineName:r.name}});}
    catch(error){
     // One notice per reserved slot: the scheduler does not retry this slot (design §3.8).
     if(error.message==='workflow_supervision_required')notifySupervision(service,r);
     throw error;
    }
    recordTask(run.taskId);notify(service,run.taskId,'started');observe(service);return {taskId:run.taskId,runId:run.id,projectId:service.projectId};
   }
   const task=await service.createTask({request:r.request},{id:r.id,name:r.name});recordTask(task.id);
   try{await service.startAgent({taskId:task.id});}
   catch(error){service.store.set('task:'+task.id,{...service.task(task.id),state:'failed',routineError:'routine_not_ready'});observe(service);notify(service,task.id,'settled');throw error;}
   notify(service,task.id,'started');observe(service);return {taskId:task.id,projectId:service.projectId};
  }
 });
 return {observe,get busy(){return scheduler.busy;},start:()=>scheduler.start(),stop:()=>scheduler.stop(),tick:()=>scheduler.tick(),runNow:({id})=>scheduler.runNow(id),
  async list(){return {items:store.list('routine:').map(r=>({...r,nextRunAt:r.enabled?nextRun(r,now()):null})),projects:await listProjects()};},
  async save(input){
   const kind=input?.kind??'prompt';
   if(!['prompt','workflow'].includes(kind)||typeof input?.name!=='string'||!input.name.trim()||input.name.length>80||typeof input.projectId!=='string'||typeof input.enabled!=='boolean')fail('routine_invalid');
   if(kind==='prompt'&&(typeof input.request!=='string'||!input.request.trim()||input.request.length>16000))fail('routine_invalid');
   if(kind==='workflow'&&(!SLUG.test(input.slug||'')||input.request!==undefined||input.inputs!==undefined&&(!input.inputs||typeof input.inputs!=='object'||Array.isArray(input.inputs)||JSON.stringify(input.inputs).length>16000)))fail('routine_invalid');
   if(!(await listProjects()).some(p=>p.id===input.projectId))fail('project_missing');nextRun(input,now());
   const previous=input.id?store.get('routine:'+input.id):null;if(input.id&&!previous)fail('routine_missing');
   if(previous&&(previous.kind||'prompt')!==kind)fail('routine_invalid');
   const schedule={kind:input.schedule.kind,time:input.schedule.time,...(input.schedule.kind==='weekly'?{weekday:input.schedule.weekday}:{})};
   const value={...previous,id:previous?.id||randomUUID(),name:input.name.trim(),projectId:input.projectId,kind,schedule,enabled:input.enabled,createdAt:previous?.createdAt||iso(now())};
   if(kind==='workflow'){
    value.slug=input.slug;value.inputs=structuredClone(input.inputs||previous?.inputs||{});delete value.request;
    // YAML is the truth: the routine screen writes only trigger.schedule back (§3.8).
    const service=await owner(value),pkg=await loadWorkflowPackage(service.root,value.slug);
    if(pkg.workflow.trigger?.kind!=='routine')fail('workflow_trigger_invalid');
    if(pkg.workflow.trigger.schedule!==formatWorkflowSchedule(schedule))await saveWorkflowSchedule(service.root,value.slug,schedule);
   }else{value.request=input.request.trim();delete value.slug;delete value.inputs;}
   store.set('routine:'+value.id,value);return value;
  },
  delete({id,confirmed}){if(confirmed!==true)fail('routine_confirmation');store.delete('routine:'+id);return {deleted:true};}
 };
}
