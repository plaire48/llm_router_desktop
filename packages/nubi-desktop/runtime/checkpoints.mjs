// Task checkpoints and revert adopted from opencode (MIT License, Copyright (c) 2025 opencode),
// packages/core/src/session/revert.ts at commit d93568f3, over the shadow snapshots of snapshot.mjs. nubi changes files
// when the user applies an edit or a new file or runs a command, so a checkpoint is taken just before each of those.
// Reverting restores every file that changed since the checkpoint and keeps the current state, so the revert itself can
// be undone, as opencode's staged revert and clear. Capture is best effort: a failure never blocks the change.
import {randomUUID} from 'node:crypto';
import {fail} from './files.mjs';
import {createSnapshotStore,snapshotDirectory} from './snapshot.mjs';
const stores=new WeakMap();
function snapshotStore(service,root){
 let byRoot=stores.get(service);if(!byRoot){byRoot=new Map();stores.set(service,byRoot);}
 const directory=snapshotDirectory(service.store.directory,root),key=directory;
 if(!byRoot.has(key))byRoot.set(key,createSnapshotStore({worktree:root,directory}));
 return byRoot.get(key);
}
const rows=(service,taskId)=>service.store.list('checkpoint:').filter(row=>row.taskId===taskId).sort((a,b)=>b.seq-a.seq);
export async function checkpoint(service,taskId,reason,detail={}){
 const root=await service.target(taskId),tree=await snapshotStore(service,root).capture();
 if(!tree)return null;
 const all=service.store.list('checkpoint:'),last=rows(service,taskId)[0];
 if(last&&last.tree===tree&&last.root===root)return last;
 const row={id:randomUUID(),taskId,root,tree,reason,...detail,seq:Math.max(0,...all.map(item=>item.seq||0))+1,createdAt:new Date().toISOString()};
 service.store.set('checkpoint:'+row.id,row);service.store.event('checkpoint_created',{checkpointId:row.id,taskId,reason});
 return row;
}
// Before a change: never let a snapshot failure stop the user's edit or command.
export async function checkpointBefore(service,taskId,reason,detail){
 try{return await checkpoint(service,taskId,reason,detail);}catch(error){service.store.event?.('checkpoint_failed',{taskId,reason,message:String(error?.message||error).slice(0,200)});return null;}
}
function idle(service,taskId){
 if(service.agent?.running||service.newFileBusy||service.setupBusy||service.computerBusy||service.unsettledOperations?.size||service.processes?.active?.size)fail('agent_busy');
 if(['running','stopping'].includes(service.task(taskId).state))fail('agent_busy');
}
export async function revertCheckpoint(service,{taskId,checkpointId}){
 service.task(taskId);
 const point=service.store.get('checkpoint:'+checkpointId);
 if(!point||point.taskId!==taskId)fail('checkpoint_missing');
 idle(service,taskId);
 const task=service.task(taskId),store=snapshotStore(service,point.root);
 // An earlier revert of this task is undone first, as opencode restores its original before staging another.
 if(task.revert)await undoRevert(service,{taskId});
 const current=await store.capture();if(!current)fail('checkpoint_unavailable');
 const files=await store.files({from:point.tree,to:current});
 if(files.length)await store.restore({files:new Map(files.map(file=>[file,point.tree]))});
 const revert={checkpointId,root:point.root,snapshot:current,files,at:new Date().toISOString()};
 service.store.set('task:'+taskId,{...service.task(taskId),revert});service.store.event('checkpoint_reverted',{taskId,checkpointId,files:files.length});
 return {checkpointId,files};
}
export async function undoRevert(service,{taskId}){
 const task=service.task(taskId),revert=task.revert;
 if(!revert)fail('revert_missing');
 idle(service,taskId);
 if(revert.files.length)await snapshotStore(service,revert.root).restore({files:new Map(revert.files.map(file=>[file,revert.snapshot]))});
 const {revert:_removed,...rest}=service.task(taskId);service.store.set('task:'+taskId,rest);service.store.event('checkpoint_revert_undone',{taskId,checkpointId:revert.checkpointId});
 return {checkpointId:revert.checkpointId,files:revert.files};
}
export function installCheckpoints(ProjectService){
 ProjectService.prototype.checkpoints=async function({taskId}){this.ready();const revert=this.task(taskId).revert;return {items:rows(this,taskId).map(({id,reason,proposalId,setupActionId,createdAt})=>({id,reason,proposalId,setupActionId,createdAt})),revert:revert?{checkpointId:revert.checkpointId,files:revert.files,at:revert.at}:null};};
 ProjectService.prototype.revertCheckpoint=function(args){this.ready();return revertCheckpoint(this,args);};
 ProjectService.prototype.undoRevert=function(args){this.ready();return undoRevert(this,args);};
}
