import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as nextTurn} from 'node:timers/promises';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {modelTransport} from '../runtime/recovery.mjs';
import {IMAGE_MODEL_WAIT_POLICY} from '../../../extensions/aipro-chat/model-recovery.js';
import {Store} from '../runtime/store.mjs';
import {createRunMetrics,readRunMetrics} from '../runtime/run-metrics.mjs';
const messages=[{role:'user',content:'Keep the current receipts.'}];
const failure=(status=502,extra={})=>Object.assign(Error('upstream'),{status,...extra});
function host(complete,options={}){return {providers:{status:()=>({model:'fixture'}),complete},recoveryOptions:{model:options}};}

test('one transport has three retries with 2/4/8 second base delays and stops after four attempts',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});t.mock.method(Math,'random',()=>0);
 const controller=new AbortController();t.after(()=>controller.abort());let calls=0;const retries=[];
 const invoke=modelTransport(host(async()=>{calls++;throw failure();}),{signal:controller.signal,onRetry:attempt=>retries.push(attempt)});
 const done=assert.rejects(invoke(messages,[]),/upstream/);done.catch(()=>{});await nextTurn();assert.equal(calls,1);
 for(const [index,delay] of [2000,4000,8000].entries()){
  t.mock.timers.tick(delay-1);await nextTurn();assert.equal(calls,index+1,'no early retry');
  t.mock.timers.tick(1);await nextTurn();assert.equal(calls,index+2,'one inference attempt per retry');
 }
 await done;assert.equal(calls,4);assert.deepEqual(retries,[1,2,3]);
});

test('recovered inference uses the same messages and counts each actual attempt once',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'nubi-wave2-retry-')),store=new Store(directory);
 t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});
 const metrics=createRunMetrics({store,taskId:'task',runId:'run'}),seen=[];
 const invoke=modelTransport(host(async wire=>{seen.push(structuredClone(wire));if(seen.length<4)throw failure();return {content:'ok',calls:[]};},{minTimeout:1}),{signal:new AbortController().signal,metrics});
 assert.equal((await invoke(messages,[])).content,'ok');assert.equal(seen.length,4);assert.ok(seen.every(wire=>JSON.stringify(wire)===JSON.stringify(messages)));
 const {summary}=readRunMetrics(store,{taskId:'task',runId:'run'});assert.equal(summary.modelCalls,4);assert.equal(summary.retries,3);assert.equal(summary.toolCalls,0);
});

test('lower call budgets and zero/image policies are never raised by the default',async()=>{
 for(const {options={},waitPolicy,callOptions={},expected} of [
  {callOptions:{retries:1},expected:2},{callOptions:{retries:0},expected:1},
  {callOptions:{retries:99},expected:4},{options:{retries:1},callOptions:{retries:99},expected:2},
  {waitPolicy:IMAGE_MODEL_WAIT_POLICY,callOptions:{retries:99},expected:1},
 ]){
  let calls=0;const invoke=modelTransport(host(async()=>{calls++;throw failure();},{minTimeout:1,...options}),{signal:new AbortController().signal,waitPolicy});
  await assert.rejects(invoke(messages,[],undefined,'actor',callOptions));assert.equal(calls,expected);
 }
});

test('authentication and rejected requests are not retried; 408 and malformed responses retain recovery',async()=>{
 for(const status of [400,401,403,404,422]){
  let calls=0;const invoke=modelTransport(host(async()=>{calls++;throw failure(status);},{minTimeout:1}),{signal:new AbortController().signal});
  await assert.rejects(invoke(messages,[]));assert.equal(calls,1,String(status));
 }
 for(const error of [failure(408),Error('model_timeout'),Error('response_invalid')]){
  const wires=[];const invoke=modelTransport(host(async wire=>{wires.push(structuredClone(wire));if(wires.length===1)throw error;return {content:'ok',calls:[]};},{minTimeout:1}),{signal:new AbortController().signal});
  assert.equal((await invoke(messages,[])).content,'ok');assert.equal(wires.length,2);
  if(error.message==='response_invalid')assert.match(wires[1].at(-1).content,/No tool.*was executed/);
 }
 let calls=0;const invoke=modelTransport(host(async()=>{calls++;throw Error('response_invalid');},{minTimeout:1}),{signal:new AbortController().signal});
 await assert.rejects(invoke(messages,[],undefined,'actor',{retryInvalidResponse:false}));assert.equal(calls,1);
});

test('a long server cooldown is not capped or bypassed by a later call in the same run',async()=>{
 for(const status of [429,503]){
  let calls=0,retries=0;const invoke=modelTransport(host(async()=>{calls++;throw failure(status,{retryAfterMs:120000});},{minTimeout:1}),{signal:new AbortController().signal,onRetry:()=>retries++});
  await assert.rejects(invoke(messages,[]),error=>error.retryAfterMs===120000);
  await assert.rejects(invoke(messages,[]),error=>error.retryAfterMs===120000);
  assert.equal(calls,1);assert.equal(retries,0);
 }
});

test('cancel before inference and during backoff never dispatches another attempt',async()=>{
 for(const before of [true,false]){
  const controller=new AbortController();if(before)controller.abort();let calls=0;
  const invoke=modelTransport(host(async()=>{calls++;throw failure();},{minTimeout:1}),{signal:controller.signal,onRetry:()=>controller.abort()});
  await assert.rejects(invoke(messages,[]),/cancelled|abort/i);assert.equal(calls,before?0:1);
 }
});

test('short server Retry-After remains a minimum wait before inference resumes',async()=>{
 for(const status of [429,503]){
  const times=[];const invoke=modelTransport(host(async()=>{times.push(performance.now());if(times.length===1)throw failure(status,{retryAfterMs:30});return {content:'ok',calls:[]};},{minTimeout:1}),{signal:new AbortController().signal});
  await invoke(messages,[]);assert.equal(times.length,2);assert.ok(times[1]-times[0]>=29,'server minimum wait');
 }
});
