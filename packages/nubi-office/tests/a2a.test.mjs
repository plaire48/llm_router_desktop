import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorker} from '../worker/main.mjs';

// Office A2A is explicitly deferred. Do not start a collaboration server or
// turn a rejected endpoint into a test requirement for protocol implementation.
for(const host of ['excel','word','powerpoint'])test(`${host} rejects deferred A2A actions without creating a model or native run`,async t=>{
  const providerCalls=[];
  const forbidden=name=>()=>{providerCalls.push(name);throw new Error('unexpected_provider_call');};
  const worker=createWorker({status:()=>({provider:'aipro',model:'test'}),
    complete:forbidden('complete'),connect:forbidden('connect'),login:forbidden('login'),
    dispose:()=>{}},{host});
  t.after(()=>worker.dispose());
  const requestId='deferred-a2a-contract';
  for(const payload of [
    {action:'connect',url:'http://127.0.0.1:9/not-an-invite'},
    {action:'import',id:'external-task',conversationId:'chat-1',draft:'',requestId,request:'외부 요청'},
    {action:'result',id:'external-task',text:'외부 결과',requestId}
  ]){
    await assert.rejects(worker.dispatch('a2a',payload),error=>error.message==='unknown_method');
    // Native actions are emitted only by an active run. Rejected A2A actions
    // must not create a hidden run or an action awaiting native execution.
    await assert.rejects(worker.dispatch('runLookup',{requestId}),/run_expired/);
    await assert.rejects(worker.dispatch('runStatus',{id:'external-task'}),/run_expired/);
    assert.deepEqual(providerCalls,[]);
  }
  assert.deepEqual(await worker.dispatch('session'),{provider:'aipro',model:'test',host});
});
