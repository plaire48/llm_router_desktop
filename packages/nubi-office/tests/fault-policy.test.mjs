// Scripted fault injection; no live model, Excel COM, NASCA or Windows claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import {retryAfterMs,transient} from '../worker/fault-policy.mjs';
import {createResilience} from '../worker/resilience.mjs';
import {createActivityLog} from '../worker/activity.mjs';
import {createProviders,safeError} from '../worker/providers.mjs';
import {startAgent} from '../worker/agent.mjs';
import {text,workbook,scriptedProvider,drive} from './harness-fixtures.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const fast={wait:async()=>{},random:()=>1};
function harness(options={}) {
  const controller=new AbortController(),activity=createActivityLog(),metrics={modelCalls:0};
  return {controller,activity,metrics,h:createResilience({signal:controller.signal,activity,metrics,...fast,...options})};
}
const manual=async fetchImpl=>{const p=createProviders({fetchImpl});await p.connect({provider:'compatible',baseUrl:'https://test.invalid/v1',token:'private-token',model:'catalog-qwen-id'});return p;};

test('Retry-After accepts seconds and HTTP dates but rejects ambiguous and malformed values',()=>{
  const now=Date.parse('2026-09-23T00:00:00Z'),read=value=>retryAfterMs(new Headers({'Retry-After':value}),now);
  assert.equal(read('90'),90000);assert.equal(read('Wed, 23 Sep 2026 00:01:00 GMT'),60000);
  assert.equal(read('Tue, 22 Sep 2026 00:00:00 GMT'),0);
  for(const value of ['-1','1.5','2026-09-23','garbage','1, 2','9'.repeat(129)])assert.equal(read(value),undefined);
});

test('HTTP classification does not blindly retry client, context, policy or unimplemented-server errors',async()=>{
  for(const status of [400,401,403,404,409,413,422,501,505]){
    let calls=0;const {h}=harness();
    await assert.rejects(h.complete({complete:async()=>{calls++;throw Object.assign(new Error('upstream'),{status});}},[]));
    assert.equal(calls,1,String(status));
  }
  for(const status of [408,425,429,500,502,503,504])assert.equal(transient(Object.assign(new Error('upstream'),{status})),true);
  for(const code of ['response_filtered','context_overflow','fabrix_tool_protocol','invalid_model','cancelled'])assert.equal(transient(Object.assign(new Error(code),{status:503})),false);
  assert.equal(transient(new Error('model_stream_incomplete')),true);
});

test('real provider HTTP errors preserve server wait and status without leaking bodies or credentials',async()=>{
  let calls=0,clock=0;const delays=[];
  const p=await manual(async()=>++calls===1?new Response('private server body',{status:429,headers:{'Retry-After':'65'}}):Response.json({choices:[{message:{content:'ok'},finish_reason:'stop'}]}));
  const {h,activity}=harness({now:()=>clock,wait:async ms=>{delays.push(ms);clock+=ms;}});
  try{assert.equal((await h.complete(p,[])).content,'ok');assert.equal(calls,2);assert.deepEqual(delays,[30000,30000,5000]);
    const log=JSON.stringify(activity.snapshot());assert.match(log,/65초/);assert.doesNotMatch(log,/private|test.invalid/);
  }finally{p.dispose();}
  const bad=await manual(async()=>new Response('private body',{status:413}));
  try{await assert.rejects(bad.complete([],[],new AbortController().signal,()=>{},()=>{}),e=>safeError(e)==='context_overflow'&&e.status===413&&!JSON.stringify(e).includes('private'));}finally{bad.dispose();}
});

test('resuming a three-failure HITL does not bypass a remaining Retry-After deadline',async()=>{
  let clock=0,calls=0,pauses=0;const delays=[];
  const {h}=harness({now:()=>clock,wait:async ms=>{if(pauses)assert.equal(h.status().state,'waiting');delays.push(ms);clock+=ms;},onStall:async()=>{pauses++;clock+=2000;}});
  const result=await h.complete({complete:async()=>{if(++calls<=3)throw Object.assign(new Error('rate_limited'),{retryAfterMs:10000});return text('ok');}},[]);
  assert.equal(result.content,'ok');assert.equal(pauses,1);assert.deepEqual(delays,[10000,10000,8000]);assert.equal(clock,30000);
});

test('cancel during a server-directed wait prevents any further model request',async()=>{
  let calls=0;const {h,controller}=harness({wait:async()=>{controller.abort();}});
  await assert.rejects(h.complete({complete:async()=>{calls++;throw Object.assign(new Error('rate_limited'),{retryAfterMs:86400000});}},[]),/cancelled/);
  assert.equal(calls,1);
});

test('timed-out and completed attempts cannot publish late text, phases or tool results',async()=>{
  let calls=0,oldText,oldPhase,resolveOld,latestText;const texts=[],phases=[];
  const {h}=harness({attemptTimeoutMs:10});
  const response=await h.complete({complete:async(_m,_t,_signal,onText,onPhase)=>{
    if(++calls===1){oldText=onText;oldPhase=onPhase;onText('unverified partial');return new Promise(r=>resolveOld=r);}
    latestText=onText;oldText('stale claim');oldPhase('stale phase');onText('verified response');return text('verified response');
  }},[],[],v=>texts.push(v),v=>phases.push(v));
  resolveOld({content:'stale',calls:[{function:{name:'apply_changes'}}]});oldText('late old');latestText('late finished');await tick();
  assert.equal(response.content,'verified response');assert.deepEqual(texts,['unverified partial','','verified response']);assert.deepEqual(phases,[]);
});

test('cut-off SSE tool arguments never become executable calls and a fresh complete attempt succeeds',async()=>{
  let calls=0;const bodies=[
    'data: '+JSON.stringify({choices:[{index:0,delta:{tool_calls:[{index:0,id:'partial',function:{name:'apply_changes',arguments:'{"plan":'}}]}}]})+'\n\n',
    'data: '+JSON.stringify({choices:[{index:0,delta:{tool_calls:[{index:0,id:'complete',function:{name:'read_selection',arguments:'{}'}}]},finish_reason:'tool_calls'}]})+'\n\ndata: [DONE]\n\n'
  ];
  const p=await manual(async()=>new Response(bodies[calls++],{headers:{'Content-Type':'text/event-stream'}}));
  const {h,metrics}=harness();try{const r=await h.complete(p,[]);assert.equal(calls,2);assert.equal(metrics.retries,1);assert.deepEqual(r.calls.map(c=>c.id),['complete']);assert.equal(r.calls[0].function.name,'read_selection');}finally{p.dispose();}
});

test('read retry allowlist rejects every mutation before invoking it',async()=>{
  const {h}=harness();let invoked=0;
  for(const name of ['apply_changes','restore_change','document_open','document_save','template_register','template_open','unknown_future_tool'])await assert.rejects(h.read(name,()=>{invoked++;}),/unsafe_tool_retry/);
  assert.equal(invoked,0);
});

test('Excel read timeout and busy recover in sequence; permanent scope errors do not retry',async()=>{
  const {h,metrics}=harness();let reads=0;
  assert.deepEqual(await h.read('read_selection',async()=>++reads<3?{error:reads===1?'office_timeout':'excel_busy'}:{values:[[42]]}),{values:[[42]]});
  assert.equal(reads,3);assert.equal(metrics.retries,2);
  for(const code of ['cells_changed','document_closed','observation_invalid','worker_disconnected']){let count=0;await assert.rejects(h.read('read_selection',async()=>{count++;return{error:code};}),new RegExp(code));assert.equal(count,1);}
});

test('lost write receipt plus two delayed reconciliation reads applies Excel changes only once',async()=>{
  const book=workbook();let readFailures=0,reconcileReads=0,applied;
  const run=startAgent({request:'A1을 42로 변경',scope:book.snapshot(),mode:'edit',providers:scriptedProvider(),resilienceOptions:fast});
  const result=await drive(run,action=>{
    if(action.name==='read_selection'&&readFailures++<1)return{error:'office_timeout'};
    if(action.name==='apply_changes'){applied=book.action(action);return{error:'office_timeout'};}
    if(action.name==='reconcile_changes')return++reconcileReads<3?{error:'office_timeout'}:{outcome:'complete',result:applied};
    return book.action(action);
  });
  assert.equal(result.state,'done',result.error);assert.equal(book.writes,1);assert.equal(reconcileReads,3);assert.equal(book.state.values[0][0],42);
});

test('a change observed after recovering a read still blocks a false completion',async()=>{
  const book=workbook();let afterWriteReads=0;
  const run=startAgent({request:'A1을 42로 변경',scope:book.snapshot(),mode:'edit',providers:scriptedProvider(),resilienceOptions:fast});
  const result=await drive(run,action=>{
    if(book.writes&&['read_selection','verify_selection'].includes(action.name)){
      if(++afterWriteReads===1){book.state.values[0][1]=999;return{error:'office_timeout'};}
    }
    return book.action(action);
  });
  assert.equal(result.state,'failed');assert.equal(result.error,'cells_changed');assert.equal(book.writes,1);
});
