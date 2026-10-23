import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
test('disconnect during a real service read closes compute work without sending to a dead IPC channel',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-read-shutdown-')),root=path.join(directory,'project');await mkdir(root);
 await writeFile(path.join(root,'large.ts'),Array.from({length:12000},(_,i)=>`export const item${i}:number=${i};`).join('\n'));
 const child=fork(new URL('../runtime/service-entry.mjs',import.meta.url),[],{execArgv:[],env:{...process.env,NUBI_STORAGE_ROOT:path.join(directory,'state'),ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','ignore','pipe','ipc']});let stderr='';child.stderr.on('data',value=>{stderr=(stderr+value).slice(-8192);});t.after(async()=>{child.kill();await rm(directory,{recursive:true,force:true});});
 const opened=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('service_start_timeout')),15000);child.on('message',message=>{if(message.id!=='open')return;clearTimeout(timer);message.error?reject(Error(message.error)):resolve();});});
 child.send({id:'open',method:'open',args:{root,initializeWiki:false}});await opened;
 const ended=once(child,'exit');child.send({id:'read',method:'codeOutline',args:{path:'large.ts'}});child.disconnect();
 const [code,signal]=await ended;assert.equal(signal,null);assert.equal(code,0,stderr);assert(!stderr.includes('ERR_IPC_CHANNEL_CLOSED'));
});
