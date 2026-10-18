import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Store} from '../runtime/store.mjs';
import {createRun,markStep,resumePoint,stepCacheKey,listRuns,readStepOutput} from '../runtime/workflow-run.mjs';
const memory=()=>{const rows=new Map();return {get:key=>rows.get(key),set:(key,value)=>{rows.set(key,value);return value;},list:prefix=>[...rows].filter(([key])=>key.startsWith(prefix)).map(([,value])=>value)};};
const workflow={name:'합성 흐름',version:1,steps:[{id:'a',kind:'tool'},{id:'b',kind:'human'},{id:'c',kind:'agent'}]};
const start=(store,extra={})=>createRun(store,{workflow,slug:'sample',hash:'sha256:sample',inputs:{x:1},trigger:{kind:'manual'},...extra});
test('checkpoints advance in order and waiting resumes at the current step',()=>{
  const store=memory(),run=start(store);assert.equal(run.cursor,'a');assert.equal(resumePoint(run),'a');
  markStep(store,run.id,'a',{status:'complete',output:{ok:true},inputHash:stepCacheKey('a',{x:1})});
  const waiting=markStep(store,run.id,'b',{status:'waiting'});
  assert.equal(waiting.status,'waiting');assert.equal(resumePoint(waiting),'b');assert.equal(waiting.steps.c,undefined);
  assert.ok(waiting.steps.a.startedAt);assert.ok(waiting.steps.a.finishedAt);assert.ok(waiting.updatedAt);
});
test('unconfirmed execution stays unconfirmed when a hold is recorded',()=>{
  const store=memory(),run=start(store);
  markStep(store,run.id,'a',{status:'unconfirmed',receipts:['setup-action:one']});
  const held=markStep(store,run.id,'a',{status:'waiting',error:'execution_unconfirmed'});
  assert.equal(held.steps.a.status,'unconfirmed');assert.equal(held.status,'waiting');assert.equal(resumePoint(held),'a');
  assert.deepEqual(held.steps.a.receipts,['setup-action:one']);
  assert.throws(()=>markStep(store,run.id,'a',{status:'running'}),/workflow_unconfirmed/);
});
test('cache keys are stable for nested objects and sensitive to array order and inputs',()=>{
  assert.equal(stepCacheKey('a',{x:{z:1,a:2},y:[1,2]}),stepCacheKey('a',{y:[1,2],x:{a:2,z:1}}));
  assert.notEqual(stepCacheKey('a',{x:1}),stepCacheKey('a',{x:2}));
  assert.notEqual(stepCacheKey('a',{x:[1,2]}),stepCacheKey('a',{x:[2,1]}));
  assert.notEqual(stepCacheKey('a',{}),stepCacheKey('b',{}));
  for(const value of [undefined,NaN,Infinity,()=>1,1n])assert.throws(()=>stepCacheKey('a',{value}),/workflow_data_invalid/);
  const circular={};circular.self=circular;assert.throws(()=>stepCacheKey('a',circular),/workflow_data_invalid/);
});
test('64KB uses UTF-8 bytes and larger outputs move to a verified separate record',()=>{
  const store=memory(),run=start(store),small='x'.repeat(65534);
  let current=markStep(store,run.id,'a',{status:'complete',output:small});
  assert.equal(current.steps.a.output,small);assert.equal(current.steps.a.outputRef,undefined);
  const output={summary:'한'.repeat(23000)};current=markStep(store,run.id,'b',{status:'complete',output});
  assert.equal(current.steps.b.output,undefined);assert.ok(current.steps.b.outputRef.bytes>65536);
  assert.deepEqual(readStepOutput(store,current.steps.b),output);
  const key=current.steps.b.outputRef.key;store.set(key,{...store.get(key),output:{summary:'변경됨'}});
  assert.throws(()=>readStepOutput(store,current.steps.b),/workflow_output_changed/);
});
test('missing output records are explicit errors rather than empty results',()=>{
  assert.throws(()=>readStepOutput(memory(),{outputRef:{key:'output-ref:missing',hash:'x'}}),/workflow_output_missing/);
});
test('complete and failed run states follow evidence and completed steps cannot restart',()=>{
  const store=memory(),run=start(store);
  for(const id of ['a','b','c'])markStep(store,run.id,id,{status:'complete',output:null});
  assert.equal(store.get('workflow-run:'+run.id).status,'complete');assert.equal(resumePoint(store.get('workflow-run:'+run.id)),null);
  assert.throws(()=>markStep(store,run.id,'a',{status:'running'}),/workflow_step_complete/);
  const other=start(store);assert.equal(markStep(store,other.id,'a',{status:'failed',error:'verification_failed'}).status,'failed');
});
test('explicit next checkpoints preserve a branch rather than visiting the skipped step',()=>{
  const store=memory(),run=start(store);const current=markStep(store,run.id,'a',{status:'complete',next:'c'});
  assert.equal(current.cursor,'c');assert.equal(resumePoint(current),'c');
  assert.throws(()=>markStep(store,run.id,'c',{status:'complete',next:'missing'}),/workflow_step_missing/);
});
test('listRuns filters before limiting and new runs do not mutate the definition or previous checkpoints',()=>{
  const store=memory(),definition=structuredClone(workflow),first=start(store,{workflow:definition});
  definition.steps[0].id='changed';assert.equal(first.workflow.steps[0].id,'a');
  start(store,{slug:'other'});start(store,{slug:'other'});
  assert.deepEqual(listRuns(store,{slug:'sample',limit:1}).map(run=>run.id),[first.id]);
  const checkpoint=markStep(store,first.id,'a',{status:'complete',output:{ok:true}});checkpoint.steps.a.output.ok=false;
  assert.equal(store.get('workflow-run:'+first.id).steps.a.output.ok,true);
});
test('unknown runs, unknown steps and invalid status never create checkpoints',()=>{
  const store=memory(),run=start(store);assert.throws(()=>markStep(store,'missing','a',{status:'running'}),/workflow_run_missing/);
  assert.throws(()=>markStep(store,run.id,'missing',{status:'running'}),/workflow_step_missing/);
  assert.throws(()=>markStep(store,run.id,'a',{status:'done'}),/workflow_step_invalid/);
  assert.deepEqual(store.get('workflow-run:'+run.id).steps,{});
});
test('SQLite reopen retains workflow binding, output references and the human waiting point',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'nubi-workflow-store-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  let store=new Store(directory);const run=start(store);markStep(store,run.id,'a',{status:'complete',output:{summary:'가'.repeat(23000)}});markStep(store,run.id,'b',{status:'waiting'});store.close();
  store=new Store(directory);t.after(()=>store.close());const restored=store.get('workflow-run:'+run.id);
  assert.equal(restored.hash,'sha256:sample');assert.equal(restored.slug,'sample');assert.equal(resumePoint(restored),'b');assert.equal(readStepOutput(store,restored.steps.a).summary.length,23000);
});
