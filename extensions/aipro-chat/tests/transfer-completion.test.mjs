import test from 'node:test';import assert from 'node:assert/strict';
import {createHarness} from '../agent-harness.js';import {taskReceipt} from '../context-state.js';
const issued={ok:true,actionIssued:true,transfer:{kind:'download',transfer_id:'owned-transfer',state:'in_progress'}};
const complete={dataKind:'download_status',transfer_id:'owned-transfer',state:'complete',filename:'training.txt',completionVerified:true,verified:false,contentIntegrityVerified:false};
test('only the matching native completion resolves download debt, never an unchanged page',()=>{
 const h=createHarness([]);h.observe('apply_approved_action',issued);assert(h.needsCheck());
 h.observe('verify_page',{ok:true,verified:true});assert(h.needsCheck());
 for(const wrong of [{...complete,transfer_id:'foreign'},{...complete,state:'interrupted'},{...complete,completionVerified:false},{...complete,error:'download_missing'}]){h.observe('download_status',wrong);assert(h.needsCheck());}
 h.observe('download_status',complete);assert(!h.needsCheck());
});
test('a completed download cannot clear an earlier or later unresolved page write',()=>{
 for(const earlier of [true,false]){
  const h=createHarness([]);if(earlier)h.observe('click_element',{ok:true,actionIssued:true});
  h.observe('apply_approved_action',issued);if(!earlier)h.observe('click_element',{ok:true,actionIssued:true});
  h.observe('download_status',complete);assert(h.needsCheck());
 }
 const resumed=createHarness([],{resumeVerification:true});resumed.observe('download_status',complete);assert(resumed.needsCheck());
});
test('the persisted host task follows the same typed receipt and preserves unrelated debt',()=>{
 const initial={requestId:'run',steps:[],verification:{status:'passed'}};
 let task=taskReceipt(initial,'apply_approved_action','start');task=taskReceipt(task,'apply_approved_action','end',issued);assert.equal(task.pendingDownload,'owned-transfer');
 task=taskReceipt(task,'download_status','start');task=taskReceipt(task,'download_status','end',{...complete,transfer_id:'other'});assert.equal(task.verification.status,'pending');
 task=taskReceipt(task,'verify_page','start');task=taskReceipt(task,'verify_page','end',{ok:true,verified:true});assert.equal(task.verification.status,'failed');
 task=taskReceipt(task,'download_status','start');task=taskReceipt(task,'download_status','end',complete);assert.equal(task.verification.status,'passed');assert.equal(task.verification.source,'chrome_download_completion');assert.equal(task.pendingDownload,undefined);
 let unrelated=taskReceipt({...initial,verification:{status:'pending'}},'apply_approved_action','start');unrelated=taskReceipt(unrelated,'apply_approved_action','end',issued);unrelated=taskReceipt(unrelated,'download_status','end',complete);assert.equal(unrelated.verification.status,'pending');
});

test('approval continuation seeds only a current owned download with settled prior verification',()=>{
 const receipt={name:'apply_approved_action',result:issued,priorVerification:{status:'passed'}};
 const h=createHarness([],{resumeVerification:true,approvedActionReceipt:receipt});assert(h.needsCheck());h.observe('download_status',complete);assert(!h.needsCheck());
 for(const options of [{approvedActionReceipt:{...receipt,priorVerification:{status:'pending'}}},{approvedActionReceipt:{...receipt,result:{...issued,actionIssued:false}}},{approvedActionReceipt:receipt,resumeUncertainAction:true}]){
  const h=createHarness([],{resumeVerification:true,...options});h.observe('download_status',complete);assert(h.needsCheck());
 }
});
