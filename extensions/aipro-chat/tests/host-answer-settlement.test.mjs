import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent,HOST_ANSWER_SETTLEMENT_VERSION} from '../agent-runtime.js';
const base=()=>({messages:[{role:'user',content:'Read the requested state'}],tools:[],signal:new AbortController().signal});
test('opt-in host settlement repairs rejected final text through existing Pi follow-up',async()=>{
  assert.equal(HOST_ANSWER_SETTLEMENT_VERSION,1);let calls=0,checks=0;
  const result=await runAgent({...base(),complete:async messages=>{calls++;if(calls===2)assert.ok(JSON.stringify(messages).includes('missing original field'));return {content:calls===1?'unsupported':'verified',calls:[]};},settleAnswer:async()=>++checks===1?{status:'revise',feedback:'missing original field'}:{status:'accepted'}});
  assert.equal(result.content,'verified');assert.equal(calls,2);assert.equal(checks,2);
});
test('host settlement waiting suppresses final text without an extra model call',async()=>{
  let calls=0;const result=await runAgent({...base(),complete:async()=>{calls++;return {content:'candidate',calls:[]};},settleAnswer:async()=>({status:'waiting'})});assert.equal(result.content,'');assert.equal(result.awaitingUser,true);assert.equal(calls,1);
});
test('unknown host verdict fails closed while existing callers retain normal return behavior',async()=>{
  await assert.rejects(runAgent({...base(),complete:async()=>({content:'x'}),settleAnswer:async()=>({status:'unknown'})}),/host_settlement_invalid/);
  assert.equal((await runAgent({...base(),complete:async()=>({content:'old caller'})})).content,'old caller');
});
