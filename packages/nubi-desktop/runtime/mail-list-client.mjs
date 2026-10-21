import {Worker} from 'node:worker_threads';
import path from 'node:path';
export class MailListClient {
 constructor(directory){this.directory=directory;this.sequence=0;this.pending=new Map();}
 request(action,args){
  if(this.closed)return Promise.reject(Error('mail_cancelled'));
  if(!this.worker){
   const worker=this.worker=new Worker(new URL('./mail-list-worker.mjs',import.meta.url),{workerData:{database:path.join(this.directory,'workspace.db')},resourceLimits:{maxOldGenerationSizeMb:192},execArgv:[]});
   worker.on('message',({id,result,error})=>{const call=this.pending.get(id);if(!call)return;this.pending.delete(id);error?call.reject(Error(error)):call.resolve(result);if(!this.pending.size)worker.unref();});
   const fail=error=>{if(this.worker!==worker)return;this.worker=null;for(const call of this.pending.values())call.reject(error);this.pending.clear();};
   worker.on('error',fail);worker.on('exit',()=>fail(Error('mail_list_worker_stopped')));
  }
  this.worker.ref();const id=++this.sequence;
  return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.worker.postMessage({id,action,args});});
 }
 close(){this.closed=true;for(const call of this.pending.values())call.reject(Error('mail_cancelled'));this.pending.clear();const worker=this.worker;this.worker=null;return worker?.terminate();}
}
