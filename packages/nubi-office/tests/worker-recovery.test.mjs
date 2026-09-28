import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverWorkerRead} from '../src/worker-recovery.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const base={cancelled:()=>false,onRetry:()=>{},wait:async()=>{}};

test('lost acknowledgement pauses after three failures and redelivers only the identical receipt after HITL',async()=>{
  const receipt={id:'same-run',callId:'same-native-action',result:{applied:true}},attempts=[],states=[];
  let resume;const result=recoverWorkerRead('toolResult',receipt,{...base,onRetry:r=>states.push(r),
    call:async(method,payload)=>{attempts.push({method,payload});if(attempts.length<=3)throw new Error('worker_timeout');return{accepted:true};},
    onStall:()=>new Promise(resolve=>resume=resolve)});
  for(let i=0;i<20&&!resume;i++)await tick();assert.ok(resume);assert.equal(attempts.length,3);assert.equal(states.at(-1).paused,true);
  await tick();assert.equal(attempts.length,3);resume({approved:true});assert.deepEqual(await result,{accepted:true});
  assert.equal(attempts.length,4);assert.ok(attempts.every(a=>a.method==='toolResult'&&a.payload===receipt));
});

test('cancellation during reconnect backoff makes no further worker request',async()=>{
  let stopped=false,calls=0;
  await assert.rejects(recoverWorkerRead('runStatus',{id:'same'},{...base,cancelled:()=>stopped,
    call:async()=>{calls++;throw new Error('office_timeout');},wait:async()=>{stopped=true;},onStall:()=>assert.fail('No prompt before third failure')}),/cancelled/);
  assert.equal(calls,1);
});

test('declining reconnect HITL ends delivery without replaying the tool',async()=>{
  let calls=0;
  await assert.rejects(recoverWorkerRead('toolResult',{id:'same',callId:'same'},{...base,call:async()=>{calls++;throw new Error('worker_timeout');},onStall:async()=>({approved:false})}),/cancelled/);
  assert.equal(calls,3);
});

test('new runs, mutations, disconnected workers and expired runs are never automatically replayed',async()=>{
  let calls=0;const options={...base,call:async()=>{calls++;},onStall:()=>assert.fail('Unexpected HITL')};
  for(const method of ['runStart','apply','document_save','restore','template_register'])await assert.rejects(recoverWorkerRead(method,{},options),/unsafe_tool_retry/);
  assert.equal(calls,0);
  for(const code of ['worker_disconnected','run_expired']){
    await assert.rejects(recoverWorkerRead('runStatus',{}, {...options,call:async()=>{calls++;throw new Error(code);}}),new RegExp(code));
  }
  assert.equal(calls,2);
});

test('reconnection rejects another run snapshot or an unconfirmed receipt acknowledgement',async()=>{
  let calls=0;const options={...base,onStall:()=>assert.fail('Unexpected HITL')};
  await assert.rejects(recoverWorkerRead('runStatus',{id:'original'},{...options,call:async()=>{calls++;return{id:'another',state:'done'};}}),/run_expired/);
  await assert.rejects(recoverWorkerRead('toolResult',{id:'original',callId:'original-action'},{...options,call:async()=>{calls++;return{accepted:false};}}),/receipt_unconfirmed/);
  assert.equal(calls,2);
});
