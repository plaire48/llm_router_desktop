import {fork} from 'node:child_process';
import {AsyncResource} from 'node:async_hooks';

// Trusted local parsers only. This is resource isolation, not a security sandbox.
export function readTaskEnvironment(source=process.env){
 const result={ELECTRON_RUN_AS_NODE:'1'};
 for(const key of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','TMPDIR','HOME','USERPROFILE','LANG','LC_ALL'])if(typeof source[key]==='string')result[key]=source[key];
 return result;
}
function inputSize(value,limit,seen=new Set()){
 if(value==null)return 0;
 if(typeof value==='string')return value.length*2;
 if(typeof value==='number'||typeof value==='boolean')return 8;
 if(typeof value!=='object'||seen.has(value))throw Error('read_task_limit');
 if(ArrayBuffer.isView(value))return value.byteLength;
 seen.add(value);let size=0;
 for(const key of Object.keys(value)){size+=key.length*2+inputSize(value[key],limit-size,seen);if(size>limit)break;}
 seen.delete(value);return size;
}
export class ReadTaskPool{
 constructor({workerFile=new URL('./read-task-worker.mjs',import.meta.url),lanes=['interactive','repository'],maxQueue=16,maxInputBytes=96*1024*1024,maxQueuedBytes=128*1024*1024,idleTimeoutMs=45000}={}){
  this.workerFile=workerFile;this.maxQueue=maxQueue;this.maxInputBytes=maxInputBytes;this.maxQueuedBytes=maxQueuedBytes;this.queuedBytes=0;this.idleTimeoutMs=idleTimeoutMs;this.sequence=0;this.closed=false;
  this.lanes=new Map(lanes.map(name=>[name,{name,queue:[],child:null,active:null,retiring:null,idle:null,starts:0,completed:0}]));
  this.emergencyStop=()=>{for(const lane of this.lanes.values())lane.child?.kill();};process.once('exit',this.emergencyStop);
 }
 snapshot(){return Object.fromEntries([...this.lanes].map(([name,lane])=>[name,{pid:lane.child?.pid||null,phase:lane.active?.phase||'idle',queued:lane.queue.length,starts:lane.starts,completed:lane.completed,rssBytes:lane.rssBytes||0}]));}
 run(name,task,input,{signal,timeoutMs=120000}={}){
  const lane=this.lanes.get(name);let bytes;
  try{if(this.closed)throw Error('read_task_closed');if(!lane||typeof task!=='string')throw Error('read_task_invalid');if(signal?.aborted)throw Error('read_task_cancelled');if(lane.queue.length>=this.maxQueue)throw Error('read_task_queue_full');bytes=inputSize(input,this.maxInputBytes);if(bytes>this.maxInputBytes)throw Error('read_task_limit');if(this.queuedBytes+bytes>this.maxQueuedBytes)throw Error('read_task_queue_full');if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw Error('read_task_timeout');}catch(error){return Promise.reject(error);}
  return new Promise((resolve,reject)=>{
   const job={id:++this.sequence,task,input,bytes,resolve,reject,signal,phase:'queued',deadline:performance.now()+timeoutMs,resource:new AsyncResource('NubiReadTask')};this.queuedBytes+=bytes;
   job.abort=()=>this.finish(lane,job,Error('read_task_cancelled'),undefined,lane.active===job);
   job.timer=setTimeout(()=>this.finish(lane,job,Error('read_task_timeout'),undefined,lane.active===job),timeoutMs);
   signal?.addEventListener('abort',job.abort,{once:true});lane.queue.push(job);this.pump(lane);
  });
 }
 pump(lane){
  if(this.closed||lane.active||lane.retiring||!lane.queue.length)return;
  clearTimeout(lane.idle);lane.idle=null;
  const job=lane.active=lane.queue.shift();job.phase='starting';
  try{
   if(!lane.child){
    const child=lane.child=fork(this.workerFile,[],{execArgv:[`--max-old-space-size=${lane.name==='repository'?512:384}`],env:readTaskEnvironment(),serialization:'advanced',stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});lane.starts++;
    child.on('message',message=>{
     const active=lane.active;if(lane.child!==child||!active||active.id!==message?.id)return;
     if(message.type==='started'){active.phase='running';return;}
     if(message.type==='result'){lane.rssBytes=Number.isFinite(message.rssBytes)?message.rssBytes:0;if(performance.now()>=active.deadline)this.finish(lane,active,Error('read_task_timeout'));else this.finish(lane,active,null,message.result);}
     else if(message.type==='error')this.finish(lane,active,Error(/^[a-z_]{3,80}$/.test(message.error)?message.error:'read_task_failed'));
    });
    child.on('error',()=>{if(lane.child===child&&lane.active)this.finish(lane,lane.active,Error('read_task_unavailable'),undefined,true);});
    child.on('exit',()=>{if(lane.child!==child)return;lane.child=null;if(lane.active)this.finish(lane,lane.active,Error('read_task_stopped'));else this.pump(lane);});
   }
   const child=lane.child;child.ref();child.channel?.ref();
   child.send({id:job.id,task:job.task,input:job.input},error=>{if(error&&lane.child===child&&lane.active===job)this.finish(lane,job,Error('read_task_unavailable'),undefined,true);});
  }catch{this.finish(lane,job,Error('read_task_unavailable'),undefined,!!lane.child);}
 }
 finish(lane,job,error,result,kill=false){
  if(job.finished)return;job.finished=true;this.queuedBytes-=job.bytes;clearTimeout(job.timer);job.signal?.removeEventListener('abort',job.abort);
  if(lane.active===job)lane.active=null;else lane.queue=lane.queue.filter(item=>item!==job);
  if(kill)this.retire(lane);
  if(!error)lane.completed++;
  job.resource.runInAsyncScope(error?job.reject:job.resolve,null,error||result);job.resource.emitDestroy();
  job.input=null;
  if(lane.queue.length)this.pump(lane);
  else if(lane.child&&!lane.active){lane.child.unref();lane.child.channel?.unref();clearTimeout(lane.idle);lane.idle=setTimeout(()=>this.retire(lane),this.idleTimeoutMs);lane.idle.unref();}
 }
 retire(lane){
  if(lane.retiring)return lane.retiring;clearTimeout(lane.idle);lane.idle=null;const child=lane.child;if(!child)return Promise.resolve();lane.child=null;
  child.ref();child.channel?.ref();
  lane.retiring=new Promise(resolve=>{
   let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(force);resolve();};
   const force=setTimeout(()=>child.kill('SIGKILL'),1000);force.unref();child.once('exit',finish);child.once('close',finish);
   if(child.exitCode!==null||child.signalCode)finish();else child.kill();
  }).then(()=>{lane.retiring=null;this.pump(lane);});return lane.retiring;
 }
 async close(){
  this.closed=true;process.removeListener('exit',this.emergencyStop);
  for(const lane of this.lanes.values()){for(const job of [...lane.queue,...(lane.active?[lane.active]:[])])this.finish(lane,job,Error('read_task_closed'));}
  await Promise.all([...this.lanes.values()].map(lane=>this.retire(lane)));
 }
}
export const readTasks=new ReadTaskPool();
