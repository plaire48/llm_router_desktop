import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {once} from 'node:events';
import os from 'node:os';
import path from 'node:path';
test('the actual service worker pushes project invalidation before returning a persisted task',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-realtime-worker-')),root=path.join(directory,'project');await mkdir(root);
 const child=fork(new URL('../runtime/service-entry.mjs',import.meta.url),[],{env:{...process.env,NUBI_STORAGE_ROOT:path.join(directory,'state')},stdio:['ignore','ignore','pipe','ipc']}),messages=[];let sequence=0;
 const pending=new Map();child.on('message',message=>{messages.push(message);const entry=pending.get(message.id);if(entry){pending.delete(message.id);clearTimeout(entry.timer);message.error?entry.reject(Error(message.error)):entry.resolve(message.result);}});
 const request=(method,args={})=>new Promise((resolve,reject)=>{const id=String(++sequence),timer=setTimeout(()=>{pending.delete(id);reject(Error('worker timeout: '+method));},15000);pending.set(id,{resolve,reject,timer});child.send({id,method,args});});
 try{
  const project=await request('open',{root,initializeWiki:false});messages.length=0;
  const task=await request('createTask',{request:'private task content'});
  assert(messages.some(message=>message.workspaceActivity?.projectId===project.projectId),'push arrives without a poll');
  for(const message of messages.filter(message=>message.workspaceActivity))assert.deepEqual(message.workspaceActivity,{projectId:project.projectId});
  const state=await request('state',{taskId:task.id});assert.equal(state.tasks.find(row=>row.id===task.id).request,'private task content');
 }finally{
  for(const entry of pending.values())clearTimeout(entry.timer);
  const exited=once(child,'exit');child.disconnect();await exited;await rm(directory,{recursive:true,force:true});
 }
});
