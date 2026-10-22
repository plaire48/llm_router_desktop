// The paused-routines notice must be seen: not under the opening intro, acknowledged only after its full time
// (final review 2026-10-22: the intro covered the 3s toast and the notice was acknowledged unseen).
import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleRoutineNotice} from '../ui/routine-notice.mjs';
function harness({ready=false,notice={show:true,text:'루틴 알림'}}={}){
 const calls=[],timers=[];let readyNow=ready,wake=null;
 const deps={api:async method=>{calls.push(method);return method==='routineNotice'?notice:{show:false};},show:text=>calls.push('show:'+text),
  isReady:()=>readyNow,whenReady:callback=>{wake=callback;return ()=>{wake=null;};},setTimer:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimer:id=>{timers[id-1].cleared=true;},visibleMs:3000};
 return {calls,timers,deps,becomeReady:async()=>{readyNow=true;wake?.();await new Promise(r=>setTimeout(r,0));}};
}
test('nothing is fetched or shown while the opening intro plays',async()=>{
 const h=harness();scheduleRoutineNotice(h.deps);await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(h.calls,[]);
 await h.becomeReady();
 assert.deepEqual(h.calls,['routineNotice','show:루틴 알림']);
});
test('acknowledged only after the notice has been on screen for its full time',async()=>{
 const h=harness({ready:true});scheduleRoutineNotice(h.deps);await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(h.calls,['routineNotice','show:루틴 알림']);assert.equal(h.timers[0].ms,3000);
 h.timers[0].fn();await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(h.calls,['routineNotice','show:루틴 알림','acknowledgeRoutineNotice']);
});
test('leaving before the time is up does not acknowledge',async()=>{
 const h=harness({ready:true});const stop=scheduleRoutineNotice(h.deps);await new Promise(r=>setTimeout(r,0));
 stop();assert.equal(h.timers[0].cleared,true);assert.ok(!h.calls.includes('acknowledgeRoutineNotice'));
});
test('no notice to show means no toast and no acknowledgement',async()=>{
 const h=harness({ready:true,notice:{show:false}});scheduleRoutineNotice(h.deps);await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(h.calls,['routineNotice']);assert.equal(h.timers.length,0);
});
