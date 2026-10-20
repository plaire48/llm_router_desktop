import test from 'node:test';
import assert from 'node:assert/strict';
import {timingVerdict,assertAdmissionTiming,admissionBudget} from '../scripts/admission-calibration.mjs';

// Release plan R1 rule (2026-10-20): on a shared runner every timing limit is
// recorded as unjudged; the target hardware (local Mac, Windows) judges it.
test('a shared runner never judges timing, whatever the calibration says',()=>{
 assert.equal(timingVerdict(false,{sharedRunner:true}),'unjudged');
 assert.equal(timingVerdict(true,{sharedRunner:true}),'unjudged');
});
test('target hardware judges timing even when the calibration ratio is high',()=>{
 assert.equal(timingVerdict(false,{sharedRunner:false}),'judged');
 assert.equal(timingVerdict(true,{sharedRunner:false}),'judged');
});
test('an over-limit sample is recorded on a shared runner and fails on target hardware; the contract stays 300ms',()=>{
 const budget=admissionBudget({measuredMs:35.8,referenceMs:34.7});
 assert.equal(budget.contractMs,300);assert.equal(budget.status,'stable');
 const recorded=assertAdmissionTiming({...budget,timingVerdict:'unjudged'},{check:'all100',actualMs:334.4});
 assert.deepEqual([recorded.verdict,recorded.actualMs],['unjudged',334.4]);
 assert.throws(()=>assertAdmissionTiming({...budget,timingVerdict:'judged'},{check:'all100',actualMs:334.4}),/all100/);
 assert.equal(assertAdmissionTiming({...budget,timingVerdict:'judged'},{check:'all100',actualMs:299}).verdict,'passed');
});
