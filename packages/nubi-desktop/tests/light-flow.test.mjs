// Condition A verdict (design light-flow §6): judged locally, recorded only on a shared runner (§8 답 15).
import test from 'node:test';
import assert from 'node:assert/strict';
import {judgeLightFlow} from '../scripts/check-light-flow.mjs';
const row=(over={})=>({scene:'chat',width:1280,missedFrameRatio:0.02,longTasks:2,styleRecalcMaxMs:12,...over});
test('each target failure is named once, boundary values pass',()=>{
 assert.deepEqual(judgeLightFlow([row()],{env:{}}),{pass:true,failures:[]});
 assert.deepEqual(judgeLightFlow([row({missedFrameRatio:0.05,longTasks:5,styleRecalcMaxMs:16})],{env:{}}),{pass:true,failures:[]});
 assert.deepEqual(judgeLightFlow([row({missedFrameRatio:0.051})],{env:{}}).failures,['chat:1280 missed frames 5.1% > 5%']);
 assert.deepEqual(judgeLightFlow([row({scene:'mail',longTasks:6})],{env:{}}).failures,['mail:1280 long tasks 6 > 5']);
 assert.deepEqual(judgeLightFlow([row({width:440,styleRecalcMaxMs:16.1})],{env:{}}).failures,['chat:440 style recalculation 16.1ms > 16ms']);
});
test('missed frames are judged on the chat scene only; skipped scenes are ignored',()=>{
 assert.equal(judgeLightFlow([row({scene:'wiki',missedFrameRatio:0.2})],{env:{}}).pass,true);
 assert.equal(judgeLightFlow([row(),{scene:'workflow',width:1280,skipped:'workflows_feature_off'}],{env:{}}).pass,true);
});
test('a shared runner records without judging',()=>{
 assert.deepEqual(judgeLightFlow([row({longTasks:99})],{env:{NUBI_SHARED_RUNNER:'1'}}),{pass:true,failures:[],unjudged:true});
});
test('a run without any measured row cannot pass',()=>{
 assert.deepEqual(judgeLightFlow([],{env:{}}),{pass:false,failures:['no measured scene']});
});
// Plan 2a: the verdict takes the median of three runs and a missing scene fails (plan 1 deferred minor).
import {judgeLightFlowRuns} from '../scripts/check-light-flow.mjs';
test('light-flow takes the median of three runs and fails on a missing scene',()=>{
 const r=m=>({scene:'chat',width:1280,missedFrameRatio:m,longTasks:1,styleRecalcMaxMs:10});
 assert.equal(judgeLightFlowRuns([[r(0.02)],[r(0.09)],[r(0.03)]],{env:{},expected:['chat:1280']}).pass,true);
 assert.deepEqual(judgeLightFlowRuns([[r(0.02)]],{env:{},expected:['chat:1280','mail:1280']}).failures,['mail:1280 missing']);
 assert.equal(judgeLightFlowRuns([[r(0.09)],[r(0.08)],[r(0.02)]],{env:{},expected:['chat:1280']}).pass,false);
});
