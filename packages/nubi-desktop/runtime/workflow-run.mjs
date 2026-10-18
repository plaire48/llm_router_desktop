import {nextWorkflowStep} from './workflow-navigation.mjs';
import {randomUUID} from 'node:crypto';
import {hash,fail} from './files.mjs';

const INLINE_BYTES=64*1024;
const statuses=new Set(['pending','running','waiting','unconfirmed','complete','skipped','failed','cancelled']);
const ended=new Set(['complete','skipped','failed','cancelled']);

// JSON-only values, stable recursively. Reject lossy encodings and prototype hooks.
function stableJSON(value,seen=new Set()){
  if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(!value||typeof value!=='object'||seen.has(value)||(!Array.isArray(value)&&![Object.prototype,null].includes(Object.getPrototypeOf(value))))fail('workflow_data_invalid');
  seen.add(value);
  const own=key=>{const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor||!Object.hasOwn(descriptor,'value'))fail('workflow_data_invalid');return stableJSON(descriptor.value,seen);};
  let result;
  if(Array.isArray(value))result='['+Array.from({length:value.length},(_,i)=>own(String(i))).join(',')+']';
  else result='{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+own(key)).join(',')+'}';
  seen.delete(value);return result;
}
const clone=value=>JSON.parse(stableJSON(value));
export const stepCacheKey=(stepId,inputs)=>hash(stableJSON({stepId,inputs}));

export function createRun(store,{workflow,hash:workflowHash,inputs={},trigger={kind:'manual'},slug=workflow?.slug??null}){
  if(!workflow?.steps?.length||typeof workflowHash!=='string'||!workflowHash)fail('workflow_run_invalid');
  const now=new Date().toISOString();
  const run=clone({id:randomUUID(),slug,version:workflow.version,hash:workflowHash,workflow,inputs,trigger,status:'running',steps:{},cursor:workflow.steps[0].id,createdAt:now,updatedAt:now});
  store.set('workflow-run:'+run.id,clone(run));return run;
}

export function readStepOutput(store,step){
  if(!step?.outputRef)return Object.hasOwn(step||{},'output')?clone(step.output):undefined;
  const reference=step.outputRef,record=store.get(reference.key);
  if(!record)fail('workflow_output_missing');
  const text=stableJSON(record.output);
  if(record.hash!==reference.hash||hash(text)!==reference.hash||Buffer.byteLength(text)!==reference.bytes)fail('workflow_output_changed');
  return JSON.parse(text);
}

export function markStep(store,runId,stepId,patch){
  const stored=store.get('workflow-run:'+runId);if(!stored)fail('workflow_run_missing');
  const run=clone(stored),index=run.workflow.steps.findIndex(step=>step.id===stepId);
  if(index<0)fail('workflow_step_missing');
  if(!patch||Object.hasOwn(patch,'outputRef'))fail('workflow_step_invalid');
  const before=run.steps[stepId],requested=patch.status||before?.status||'running';
  if(!statuses.has(requested))fail('workflow_step_invalid');
  if(before?.status==='unconfirmed'&&['pending','running'].includes(requested))fail('workflow_unconfirmed');
  if(['complete','skipped'].includes(before?.status)&&requested!==before.status)fail('workflow_step_complete');
  if(Object.hasOwn(patch,'next')&&patch.next!==null&&!run.workflow.steps.some(step=>step.id===patch.next))fail('workflow_step_missing');
  const now=new Date().toISOString(),step={...before,...clone(patch),status:before?.status==='unconfirmed'&&requested==='waiting'?'unconfirmed':requested,startedAt:before?.startedAt||now};
  if(Object.hasOwn(patch,'output')){
    const text=stableJSON(patch.output);
    if(before?.status==='complete'&&stableJSON(readStepOutput(store,before))!==text)fail('workflow_step_complete');
    delete step.outputRef;
    if(Buffer.byteLength(text)>INLINE_BYTES){
      const digest=hash(text),key=`output-ref:workflow:${run.id}:${stepId}:${digest.slice(7)}`;
      const reference={key,hash:digest,bytes:Buffer.byteLength(text)};
      store.set(key,{runId:run.id,stepId,hash:digest,bytes:reference.bytes,output:JSON.parse(text)});
      delete step.output;step.outputRef=reference;
    }
  }
  if(ended.has(step.status))step.finishedAt=before?.finishedAt||now;
  if(!Array.isArray(step.receipts))step.receipts=[];
  run.steps[stepId]=step;run.updatedAt=now;
  if(run.cursor===stepId&&['complete','skipped'].includes(step.status))run.cursor=Object.hasOwn(step,'next')?step.next:nextWorkflowStep(run.workflow,run.workflow.steps[index]);
  if(!['cancelled','partial'].includes(run.status)){
    const states=Object.values(run.steps).map(step=>step.status);
    run.status=states.includes('failed')?'failed':states.some(state=>['waiting','unconfirmed'].includes(state))?'waiting':run.workflow.steps.every(step=>['complete','skipped'].includes(run.steps[step.id]?.status))?'complete':'running';
  }
  store.set('workflow-run:'+run.id,clone(run));return clone(run);
}

export function resumePoint(run){
  if(!run||['complete','partial','cancelled'].includes(run.status))return null;
  let cursor=run.cursor??run.workflow.steps[0]?.id;const seen=new Set();
  while(cursor){
    if(seen.has(cursor))fail('workflow_cycle');seen.add(cursor);
    const index=run.workflow.steps.findIndex(step=>step.id===cursor);if(index<0)fail('workflow_step_missing');
    const checkpoint=run.steps[cursor];
    if(!['complete','skipped'].includes(checkpoint?.status))return cursor;
    cursor=Object.hasOwn(checkpoint,'next')?checkpoint.next:nextWorkflowStep(run.workflow,run.workflow.steps[index]);
  }return null;
}

export function listRuns(store,{slug,limit=50}={}){
  if(!Number.isInteger(limit)||limit<0||limit>200)fail('workflow_run_limit');
  return store.list('workflow-run:').filter(run=>slug===undefined||run.slug===slug).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).slice(0,limit).map(clone);
}
