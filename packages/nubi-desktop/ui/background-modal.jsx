import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {Icon} from './LucideIcon.jsx';
import {backgroundTasks,taskIsActive} from './background-task-queue.mjs';

const owners=new Map(),subscribers=new Set(),empty=()=>{};
let enabled=0;
const emit=()=>{for(const listen of subscribers)listen();};
const getOwner=panel=>{
 if(!owners.has(panel))owners.set(panel,{panel,hidden:false,jobs:new Set(),automatic:new Set(),seen:new Set(),sources:new Map(),parents:[],previousOpen:new Map()});
 return owners.get(panel);
};
function hide(owner){
 if(owner.hidden)return;
 owner.hidden=true;emit();
}
function reveal(owner){
 if(!owner.panel.isConnected)return;
 owner.hidden=false;emit();
}
export function enableBackgroundTasks(){enabled++;return()=>{enabled--;};}
export function useBackgroundModal(panel,busy,onClose){
 const hidden=useSyncExternalStore(listen=>{subscribers.add(listen);return()=>subscribers.delete(listen);},()=>owners.get(panel.current)?.hidden||false,()=>false);
 const [registered,setRegistered]=useState(false);
 useEffect(()=>{
  const node=panel.current;if(!node)return;const owner=getOwner(node);setRegistered(true);
  return()=>{owners.delete(node);const parent=owner.parents.findLast(item=>item.panel.isConnected);for(const id of owner.jobs){backgroundTasks.controls(id,{open:parent?()=>reveal(parent):owner.previousOpen.get(id)});if(owner.automatic.has(id)&&taskIsActive(backgroundTasks.get(id)?.state))backgroundTasks.update(id,{state:'interrupted',label:'진행 화면이 닫혔어요. 결과를 확인해 주세요.'});}if(!owner.hidden&&parent)reveal(parent);emit();};
 },[]);
 const owner=registered&&owners.get(panel.current);
 if(owner){owner.close=onClose;owner.busy=busy;}
 return {hidden,canBackground:!!owner&&[...owner.jobs].some(id=>taskIsActive(backgroundTasks.get(id)?.state)),hide:()=>owner&&hide(owner)};
}
export function BackgroundModalAction({controller}){
 if(!controller.canBackground)return null;
 return <button type="button" className="cx-kit-button nubi-icon-button nubi-background-modal-action" aria-label="백그라운드에서 계속" title="백그라운드에서 계속" onClick={controller.hide}><Icon name="minimize" size={18}/></button>;
}
export function bindModalProgress(node,{id,label,value,max,phase,active=true}){
 if(!enabled||!active)return empty;
 const panel=node.closest('.cx-detail-panel[aria-modal="true"]');
 if(!panel||panel.classList.contains('nubi-background-tasks-dialog'))return empty;
 const owner=getOwner(panel),automatic=!id;
 id ||= backgroundTasks.begin({title:label,label});
 if(automatic)owner.automatic.add(id);
 if(!owner.jobs.has(id))owner.previousOpen.set(id,backgroundTasks.controlsFor(id).open);
 owner.jobs.add(id);owner.sources.set(node,id);
 backgroundTasks.update(id,{title:backgroundTasks.get(id)?.title||label,state:backgroundTasks.get(id)?.state||'running',label,value:Number.isFinite(value)?value:null,max,phase});
 backgroundTasks.controls(id,{open:()=>reveal(owner),release:()=>{for(const item of [owner,...owner.parents])if(item.panel.isConnected&&item.hidden&&!item.busy&&![...item.jobs].some(key=>taskIsActive(backgroundTasks.get(key)?.state)))item.close?.();}});
 if(!owner.seen.has(id)){
  owner.seen.add(id);
  owner.parents=[...new Set([...owner.parents.filter(other=>other.panel.isConnected),...[...owners.values()].filter(other=>other!==owner&&!other.hidden&&other.panel.isConnected&&!other.panel.classList.contains('nubi-background-tasks-dialog'))])];
  for(const parent of owner.parents)hide(parent);
  hide(owner);
 }
 return()=>{
  owner.sources.delete(node);
  if(automatic&&taskIsActive(backgroundTasks.get(id)?.state))backgroundTasks.update(id,{state:'waiting',label:'처리 결과 확인'});
 };
}
export function updateModalProgress(node,patch){
 const panel=node?.closest('.cx-detail-panel'),owner=owners.get(panel),id=owner?.sources.get(node);if(id&&taskIsActive(backgroundTasks.get(id)?.state))backgroundTasks.update(id,patch);
}
export function useBackgroundOperation(options){
 const [id,setId]=useState(null),current=useRef(options),pending=useRef(null),idRef=useRef(null);current.current=options;
 useEffect(()=>()=>{const id=idRef.current;if(!id)return;backgroundTasks.controls(id,{cancel:undefined});if(!pending.current&&backgroundTasks.get(id)?.state==='waiting')backgroundTasks.update(id,{state:'interrupted',label:'입력 화면이 닫혔어요. 다시 확인해 주세요.'});},[]);
 const run=(operation,success={state:'completed',label:'완료'})=>{
  if(pending.current)return pending.current;
  if(backgroundTasks.get(idRef.current)?.state==='waiting')backgroundTasks.update(idRef.current,{state:'completed',label:'다음 단계로 이어짐'});
  const {title,risk,cancel}=current.current,job=backgroundTasks.begin({title,risk},{cancel});idRef.current=job;setId(job);
  const result=Promise.resolve().then(operation).then(value=>{backgroundTasks.update(job,value?.cancelled?{state:'cancelled',label:'취소됨'}:success);return value;},error=>{backgroundTasks.update(job,{state:error?.message==='mail_cancelled'?'cancelled':'failed',label:error?.message==='mail_cancelled'?'취소됨':'완료하지 못했어요. 결과를 확인해 주세요.'});throw error;}).finally(()=>{if(pending.current===result)pending.current=null;});
  pending.current=result;return result;
 };
 return {id,run,update:patch=>idRef.current&&backgroundTasks.update(idRef.current,patch)};
}
// Host state, including terminal state, owns these records. Merely removing a
// progress bar never asserts completion or replays an operation.
export function useBackgroundTaskState(task,controls){
 const controlsRef=useRef(null);controlsRef.current={...controls,id:task?.id};
 useEffect(()=>{
  if(!task?.id)return;
  backgroundTasks.update(task.id,task);
 },[task?.id,task?.title,task?.label,task?.risk,task?.state,task?.value,task?.max,task?.startedAt,task?.finishedAt]);
 useEffect(()=>{
  const id=task?.id;if(!id)return;const bound={};
  for(const key of ['open','cancel'])if(controlsRef.current[key])bound[key]=()=>{if(controlsRef.current.id===id)return controlsRef.current[key]?.();};
  backgroundTasks.controls(id,bound);
  return()=>{const current=backgroundTasks.controlsFor(id),clear={};for(const [key,value]of Object.entries(bound))if(current[key]===value)clear[key]=undefined;backgroundTasks.controls(id,clear);};
 },[task?.id]);
}

const watchers=new Map();
// Monitoring reads state only. It outlives the dialog and never retries a write.
export function watchBackgroundTask(id,read){
 if(watchers.has(id)){watchers.get(id).read=read;return;}
 const monitor={read,failures:0};watchers.set(id,monitor);
 const poll=async()=>{
  if(!taskIsActive(backgroundTasks.get(id)?.state)){watchers.delete(id);return;}
  try{const patch=await monitor.read();monitor.failures=0;if(patch)backgroundTasks.update(id,patch);if(patch?.state==='waiting'){watchers.delete(id);return;}}catch{if(++monitor.failures>=3)backgroundTasks.update(id,{state:'interrupted',label:'상태를 확인하지 못했어요. 작업 화면에서 결과를 확인해 주세요.'});}
  if(taskIsActive(backgroundTasks.get(id)?.state))setTimeout(poll,1500);else watchers.delete(id);
 };
 setTimeout(poll,1500);
}
