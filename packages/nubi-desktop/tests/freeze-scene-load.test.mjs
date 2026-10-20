import test from 'node:test';
import assert from 'node:assert/strict';
import * as subject from '../scripts/freeze-environment.mjs';
const high={stage:'during',at:'2026-10-20T00:00:00Z',loadavgStatus:'available',loadavg:[4.01,3,2]};
function environment(samples){assert.equal(typeof subject.sceneEnvironmentState,'function','scene load classifier must exist');return subject.sceneEnvironmentState(samples);}
const row=(violations=[],samples=[high])=>({violations,pageErrors:[],environmentReasons:environment(samples).reasons});
function outcome(results,errors=[]){assert.equal(typeof subject.classifyFreezeResults,'function','scene-aware outcome must exist');return subject.classifyFreezeResults({results,errors});}
test('violations under scene load over4 yield exit2 and retain the violations',()=>{const result=row(['long_tasks','missed_frames']);assert.equal(outcome([result]),2);assert.deepEqual(result.violations,['long_tasks','missed_frames']);});
test('a clean scene measured over the load limit stays a judged pass (§8 answer 15)',()=>{assert.equal(outcome([row()]),0);assert.equal(outcome([row(),row([],[])]),0);assert.equal(outcome([row(),row(['input_delay'])]),2);});
test('exactly4 remains eligible and a low-load violation stays failed',()=>{assert.equal(environment([{...high,loadavg:[4,3,2]}]).reasons.length,0);assert.equal(outcome([row(['input_delay'],[{...high,loadavg:[4,3,2]}])]),1);});
test('high load never hides page errors, malformed samples, missing data or admission failures',()=>{for(const violation of ['samples_invalid','samples_insufficient','admission_deadline','native_input_preparation'])assert.equal(outcome([row([violation])]),1);assert.equal(outcome([row()],['page error']),1);assert.equal(outcome([{...row(),pageErrors:['render failed']}]),1);});
test('a high-load scene does not erase a different low-load performance failure',()=>{assert.equal(outcome([row(),row(['input_delay'],[])]),1);});
test('unsupported Windows load and failed collectors never become zero-load samples',()=>{assert.equal(environment([{...high,loadavgStatus:'unsupported',loadavg:[0,0,0]}]).status,'unavailable');assert.equal(environment([{status:'unavailable',error:'collector_failed'}]).status,'unavailable');});
test('collector is serial, retains unavailable records, context and final sample',async()=>{
 assert.equal(typeof subject.createSceneLoadSampler,'function','scene sampler must exist');let active=0,peak=0,count=0;
 const sampler=subject.createSceneLoadSampler({intervalMs:2,context:{scene:'mail',width:440,mode:'browser'},capture:async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;if(++count===2)throw Object.assign(Error('redacted'),{code:'collector_failed'});return {...high,processes:[]};}});
 await sampler.start();await new Promise(r=>setTimeout(r,18));const samples=await sampler.stop();assert.equal(peak,1);assert.ok(samples.length>=3);assert.equal(samples[0].stage,'scene-start');assert.equal(samples.at(-1).stage,'scene-end');assert.ok(samples.some(r=>r.status==='unavailable'));assert.ok(samples.every(r=>r.scene==='mail'&&r.width===440&&r.mode==='browser'&&Number.isFinite(r.elapsedMs)&&Number.isFinite(r.captureMs)));const total=count;await new Promise(r=>setTimeout(r,10));assert.equal(count,total);assert.deepEqual(await sampler.stop(),samples);
});
