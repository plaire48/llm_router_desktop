import test from 'node:test';
import assert from 'node:assert/strict';
import {createInputDelivery} from '../src/input-delivery.js';
import {answerLimit, validateAnswer} from '../worker/input-contract.mjs';
const action = {callId:'question-1',payload:{options:[{id:'one',label:'10명'}],inputLimit:10000}};
const choice = {questionId:action.callId,text:'답변'};
const base = {cancelled:()=>false,onAccepted:()=>{}};

test('answer is accepted only after acknowledgement, and double submits cannot change it',async()=>{
  let ack,accepted=0,calls=0;
  const input=createInputDelivery(action,{...base,deliver:()=>{calls++;return new Promise(resolve=>ack=resolve);},onAccepted:()=>accepted++});
  const first=input.choose(choice);
  assert.equal(accepted,0);assert.equal(await input.choose({...choice,text:'different'}),false);assert.equal(calls,1);
  ack({accepted:true});assert.equal(await first,true);assert.deepEqual(await input.promise,{delivered:true});assert.equal(accepted,1);
  assert.equal(await input.choose(choice),false);
});
test('invalid or rejected answers preserve the pending question and can be corrected',async()=>{
  let calls=0,accepted='';
  const input=createInputDelivery(action,{...base,deliver:async()=>{if(++calls===1)throw new Error('input_context_limit');},onAccepted:text=>accepted=text});
  await assert.rejects(input.choose({...choice,text:'x'.repeat(10001)}),/invalid_question/);assert.equal(calls,0);
  await assert.rejects(input.choose(choice),/input_context_limit/);assert.equal(accepted,'');
  assert.equal(await input.choose({...choice,text:'short'}),true);await input.promise;assert.equal(accepted,'short');
});
test('cancelled answers and late receipts cannot restart or record a cancelled task',async()=>{
  let ack,accepted=0,stopped=false;
  const input=createInputDelivery(action,{cancelled:()=>stopped,deliver:()=>new Promise(resolve=>ack=resolve),onAccepted:()=>accepted++});
  const pending=input.choose(choice);stopped=true;input.cancel();await input.promise;ack();
  assert.equal(await pending,false);assert.equal(accepted,0);assert.equal(await input.choose(choice),false);
});
test('stale questions make no call; fatal delivery failure ends the waiter',async()=>{
  let calls=0;const input=createInputDelivery(action,{...base,deliver:async()=>{calls++;throw new Error('run_expired');}});
  assert.equal(await input.choose({...choice,questionId:'another'}),false);assert.equal(calls,0);
  await Promise.all([assert.rejects(input.promise,/run_expired/),assert.rejects(input.choose(choice),/run_expired/)]);
});
test('history budget includes current question and matches the submitted answer contract',()=>{
  const limit=answerLimit([{question:'q',text:'x'.repeat(63990)}],'12345');assert.equal(limit,4);
  assert.doesNotThrow(()=>validateAnswer({text:'1234'},limit));assert.throws(()=>validateAnswer({text:'12345'},limit),/input_context_limit/);
  assert.equal(answerLimit([{question:'q',text:'x'.repeat(63999)}],'q'),0);
});
