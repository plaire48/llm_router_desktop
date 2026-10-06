import test from 'node:test';
import assert from 'node:assert/strict';
import {createReviewExecution,projectReviewExecution} from '../review-execution.js';
const result=()=>({ok:true,actionIssued:true,selectionTargetReceipt:{dataKind:'selection_target_dispatch',version:1,status:'observed',actionIssued:true,
  target:{tabId:1,frameId:0,documentId:'document',topDocumentId:'document',role:'combobox',name:'Attendance',tag:'select'}}});
test('selection dispatch preserves bounded targets, not chosen values or a no-submit verdict',()=>{
  const run=createReviewExecution({taskStartObserved:true}),id=run.record('select_option'),r=result();
  assert(run.complete(id,r));r.selectionTargetReceipt.target.name='Changed';
  const projected=projectReviewExecution(run.snapshot());
  assert.equal(projected.interactionTargetCoverage,'complete');
  assert.equal(projected.selectionTargetReceipts[0].target.name,'Attendance');
  assert.equal(projected.selectionTargetReceipts[0].value,undefined);
  assert.equal(projected.noSubmission,undefined);assert.deepEqual(projected.absenceCertificates,[]);
  assert.equal(run.complete(id,result()),false);
});
test('selection coverage fails closed for unobserved, missing, invalid, failed, cancelled, omitted or resumed operations',()=>{
  for(const mutate of [r=>delete r.selectionTargetReceipt,r=>{r.selectionTargetReceipt.target.tag='button';},r=>{r.error='cancelled';},r=>{r.cancelled=true;},r=>{r.unresolvedAction=true;},r=>{r.actionIssued=false;},r=>{r.selectionTargetReceipt.target.documentId='';}]){
    const run=createReviewExecution({taskStartObserved:true}),id=run.record('select_option'),r=result();mutate(r);run.complete(id,r);
    assert.equal(projectReviewExecution(run.snapshot()).interactionTargetCoverage,'not_established');
  }
  for(const taskStartObserved of [false,true]){
    const run=createReviewExecution({taskStartObserved}),id=run.record('select_option');
    assert.equal(projectReviewExecution(run.snapshot()).interactionTargetCoverage,'not_established');
    run.complete(id,result());if(taskStartObserved)run.record('run_playwright');
    assert.equal(projectReviewExecution(run.snapshot()).interactionTargetCoverage,'not_established');
  }
  const run=createReviewExecution({taskStartObserved:true});for(let i=0;i<65;i++)run.complete(run.record('select_option'),result());
  assert.equal(run.snapshot().selectionTargetReceiptsOmitted,1);assert.equal(projectReviewExecution(run.snapshot()).interactionTargetCoverage,'not_established');
});
