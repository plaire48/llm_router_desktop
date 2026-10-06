import test from 'node:test';
import assert from 'node:assert/strict';
import {createHarness} from '../agent-harness.js';
import {runAgent} from '../agent-runtime.js';
import {taskReceipt} from '../context-state.js';
const receipt={name:'apply_approved_action',result:{ok:true,actionIssued:true,transfer:{kind:'upload'},verified:false},priorVerification:{status:'not_required'}};

test('an approval applied before the runner starts still requires its own fresh outcome verification',()=>{
  const h=createHarness([],{approvedActionReceipt:receipt});assert(h.needsCheck());
  h.observe('browser_snapshot',{ok:true});assert(h.needsCheck());
  h.observe('verify_page',{ok:true,verified:false});assert(h.needsCheck());
  h.observe('verify_page',{ok:true,verified:true});assert(!h.needsCheck());
});

test('approval seeding cannot remove pre-existing unknown action debt',()=>{
  const h=createHarness([],{resumeVerification:true,resumeUncertainAction:true,approvedActionReceipt:receipt});
  h.observe('verify_page',{ok:true,verified:true});assert(h.needsCheck());
});

test('runner withholds a premature post-approval answer until actual checks settle the durable host receipt',async()=>{
  let host={steps:[],verification:{status:'not_required'}},round=0,checks=0,reviews=0;
  host=taskReceipt(host,receipt.name,'start');host=taskReceipt(host,receipt.name,'end',receipt.result);
  const tool={type:'function',function:{name:'verify_page',parameters:{type:'object',properties:{checks:{type:'array'}},required:['checks']}}};
  const result=await runAgent({goal:'Select the supplied file and verify its visible selection without submitting.',
    messages:[{role:'user',content:'Select the supplied file and verify its visible selection without submitting.'}],
    tools:[tool],harness:true,stepwise:false,signal:new AbortController().signal,approvedActionReceipt:receipt,
    complete:async()=>++round===2?{calls:[{id:'check',type:'function',function:{name:'verify_page',arguments:JSON.stringify({checks:[{kind:'text_present',expected:'training.txt / 60 bytes'}]})}}]}:{content:'File selected; no submission.'},
    execute:async(name,args)=>{assert.equal(name,'verify_page','Never reapply the approved operation');checks++;
      const result={ok:true,verified:true,checks:args.checks.map((check,index)=>({...check,index,passed:true}))};
      host=taskReceipt(host,name,'start');host=taskReceipt(host,name,'end',result);return result;},
    reviewGoal:async()=>{reviews++;assert.equal(host.verification.status,'passed');return {status:'complete'};},
  });
  assert.equal(result.content,'File selected; no submission.');assert.equal(checks,1);assert.equal(reviews,1);assert.equal(round,3);
});


test('a failed explicit read-only check blocks completion until a fresh goal check passes',()=>{
  const h=createHarness([]);assert(!h.needsCheck());
  h.observe('verify_page',{ok:false,verified:false,error:'verification_failed'});assert(h.needsCheck());
  h.observe('browser_snapshot',{ok:true});assert(h.needsCheck());
  h.observe('verify_page',{ok:true,verified:true});assert(!h.needsCheck());
});


test('a read-only assertion failure reaches correction instead of a host-blocked final answer',async()=>{
  let round=0,checks=0,reviews=0,host={steps:[],verification:{status:'not_required'}};
  const tool={type:'function',function:{name:'verify_page',parameters:{type:'object',properties:{checks:{type:'array'}},required:['checks']}}};
  const result=await runAgent({goal:'Confirm the visible training.txt filename.',messages:[{role:'user',content:'Confirm the visible training.txt filename.'}],
    tools:[tool],harness:true,stepwise:false,signal:new AbortController().signal,
    complete:async()=>[1,3].includes(++round)?{calls:[{id:String(round),type:'function',function:{name:'verify_page',arguments:JSON.stringify({checks:[{kind:'text_present',expected:'training.txt'}]})}}]}:{content:'training.txt is visible.'},
    execute:async name=>{assert.equal(name,'verify_page');checks++;const result={ok:checks>1,verified:checks>1,...(checks===1?{error:'verification_failed'}:{}),checks:[{kind:'text_present',expected:'training.txt',passed:checks>1}]};host=taskReceipt(host,name,'start');host=taskReceipt(host,name,'end',result);return result;},
    reviewGoal:async()=>{reviews++;assert.equal(host.verification.status,'passed');return {status:'complete'};},
  });
  assert.equal(result.content,'training.txt is visible.');assert.equal(checks,2);assert.equal(reviews,1);assert.equal(round,4);
});
