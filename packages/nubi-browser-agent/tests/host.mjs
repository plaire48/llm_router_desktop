import {setImmediate} from 'node:timers/promises';

export const task={taskId:'task-1',runId:'run-1',request:'Find the matching issue and report it',criteria:['issue-found']};
export function hostFixture({records=new Map()}={}){
  const controls={revision:'r1',mode:'ready',policy:'allow',grants:new Set(),writes:0,acquires:0,releases:0,failWrites:false,failFlush:false,leaseIds:new Set(),present:new Map(),events:[],records};
  const key=scope=>JSON.stringify(scope);
  const host={apiVersion:'1.0.0',capabilities:['browser','policy','human','task-store','events'],
    browser:{
      async acquire(){controls.acquires++;const lease=crypto.randomUUID();controls.leaseIds.add(lease);return lease;},
      async release(lease){controls.releases++;controls.leaseIds.delete(lease);},
      async tools(){return [{name:'find',effect:'read'},{name:'fill',effect:'write'}];},
      async observe(_ctx,tabId){return {state:controls.mode,binding:{tabId,documentId:'doc-1',revision:controls.revision},observationId:crypto.randomUUID(),data:{title:'Issue list'}};},
      async validate(ctx,binding){return controls.leaseIds.has(ctx.lease) && !ctx.signal.aborted && binding.revision===controls.revision;},
      async execute(_ctx,action){if(action.tool==='fill')controls.writes++;return {status:'confirmed',evidenceRefs:['receipt:'+action.actionId]};},
      async reconcile(){return {status:'confirmed',evidenceRefs:['server:readback']};},
      async verify(_ctx,checkpoint){return {criteria:checkpoint.criteria.map(id=>({id,satisfied:controls.writes===1,evidenceRefs:controls.writes===1?['server:issue']:[]}))};},
    },
    store:{
      async read(scope){return structuredClone(records.get(key(scope))??null);},
      async compareAndSet(scope,expected,next){if(controls.failWrites)throw Error('private store details');const old=records.get(key(scope));if((old?.version??null)!==expected)return false;records.set(key(scope),structuredClone(next));return true;},
      async flush(){if(controls.failFlush)throw Error('private flush details');},
    },
    policy:{async decide(context){if(controls.policy==='ask'&&context.approvalRequestId&&controls.grants.has(context.approvalRequestId))return 'allow';return controls.policy;}},
    human:{async present(r){controls.present.set(r.requestId,structuredClone(r));},async dismiss(id){controls.present.delete(id);}},
    events:{emit(event){controls.events.push(structuredClone(event));}},
  };
  return {host,controls};
}
export function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
export async function until(fn){for(let i=0;i<100;i++){if(fn())return;await setImmediate();}throw Error('condition not reached');}
export async function ready(addon,host){const session=await addon.attach(host,{projectId:'project-1'});await session.openTask(task);const observation=await session.observe(task.taskId,'tab-1');return {session,observation};}
export function action(session,observation,extra={}){return {actionId:'action-1',tool:'fill',arguments:{value:'Issue 123'},binding:observation.binding,catalogVersion:session.catalog().version,...extra};}
