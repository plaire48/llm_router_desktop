import {readFile} from 'node:fs/promises';
import {setImmediate} from 'node:timers/promises';

export const fixture=JSON.parse(await readFile(new URL('../eval/WD-EDIT-01.json',import.meta.url),'utf8'));
export const task={taskId:'task-1',runId:'run-1',request:fixture.request,targetRef:fixture.targetRef};
export const copy=value=>structuredClone(value);
export function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
export async function until(fn){for(let i=0;i<100;i++){if(fn())return;await setImmediate();}throw Error('condition not reached');}

export function createHost({records=new Map()}={}){
  const c={snapshot:copy(fixture.snapshot),records,grants:new Map(),prompts:[],events:[],leases:new Set(),modelCalls:0,writes:0,releases:0,
    receipt:null,lostResponse:false,corruptReadback:false,failStore:false,applyGate:null,modelGate:null,presentGate:null,claimOnly:false,mutateBeforeApply:false,visiblePrompts:new Set()};
  const key=scope=>JSON.stringify([scope.projectId,scope.taskId]);
  const host={apiVersion:'1.0.0',instanceId:'host-1',
    model:{stream(request,cb){c.modelCalls++;let cancelled=false;
      queueMicrotask(async()=>{
        if(c.modelGate)await c.modelGate.promise;
        if(cancelled)return;
        if(c.claimOnly){cb.onDelta('수정을 완료했습니다.');cb.onDone();return;}
        const results=request.messages.filter(x=>x.role==='tool').flatMap(x=>x.results);
        if(!results.some(x=>x.name==='read_word_document'))cb.onToolCall({id:'model-read',name:'read_word_document',input:{}});
        else if(!results.some(x=>x.name==='propose_replacement'))cb.onToolCall({id:'model-proposal',name:'propose_replacement',input:{blockId:'p2',oldText:'3월 12일',newText:'3월 19일'}});
        else cb.onDelta('날짜 변경안을 준비했습니다.');
        cb.onDone();
      });
      return {cancel(){cancelled=true;cb.onDone();}};
    }},
    store:{async read(scope){return copy(records.get(key(scope))??null);},async compareAndSet(scope,expected,next){
      if(c.failStore)throw Error('private store failure');
      const old=records.get(key(scope));if((old?.version??0)!==expected)return false;
      records.set(key(scope),copy(next));return true;
    }},
    human:{async present(prompt,signal){if(c.presentGate)await c.presentGate.promise;if(signal?.aborted)return;c.prompts.push(copy(prompt));c.visiblePrompts.add(prompt.approvalId);},async dismiss(id){c.visiblePrompts.delete(id);}},
    policy:{async authorize({approvalId,fingerprint}){return c.grants.get(approvalId)===fingerprint;}},
    events:{emit(event){c.events.push(copy(event));}},
    document:{
      async acquire(scope,targetRef,signal){if(signal.aborted||scope.projectId!=='project-1'||targetRef!==fixture.targetRef)throw Error('target_denied');const leaseId=crypto.randomUUID();c.leases.add(leaseId);return {leaseId,binding:copy(c.snapshot.binding)};},
      async read(ctx,signal){if(signal.aborted||!c.leases.has(ctx.leaseId))throw Error('lease_invalid');return copy(c.snapshot);},
      async apply(ctx,patch,signal){
        if(c.applyGate)await c.applyGate.promise;
        if(c.mutateBeforeApply)c.snapshot.binding.revision='user-r2';
        if(signal.aborted||!c.leases.has(ctx.leaseId))throw Error('dispatch_cancelled');
        if(c.snapshot.binding.revision!==patch.binding.revision)return {operationId:patch.operationId,status:'not_started'};
        const run=c.snapshot.blocks.find(x=>x.id===patch.blockId)?.runs.find(x=>x.id===patch.runId);
        if(!run||run.text.slice(patch.start,patch.end)!==patch.oldText)return {operationId:patch.operationId,status:'not_started'};
        c.writes++;run.text=run.text.slice(0,patch.start)+patch.newText+run.text.slice(patch.end);c.snapshot.binding.revision='r2';
        if(c.corruptReadback)c.snapshot.blocks[0].runs[0].style.bold=false;
        c.receipt={operationId:patch.operationId,status:'confirmed'};
        if(c.lostResponse)throw Error('private native response lost');return copy(c.receipt);
      },
      async reconcile(_ctx,operationId){return c.receipt?.operationId===operationId?copy(c.receipt):{operationId,status:'unconfirmed'};},
      async release(ctx){c.leases.delete(ctx.leaseId);c.releases++;}
    }
  };
  function grant(checkpoint){c.grants.set(checkpoint.proposal.approvalId,checkpoint.proposal.fingerprint);}
  return {host,c,grant};
}
