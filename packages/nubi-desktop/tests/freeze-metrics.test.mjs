import test from 'node:test';
import assert from 'node:assert/strict';
import {freezeMetrics,freezeViolations,FREEZE_SCENES,displayInterval,freezeRunOptions,styleRecalcStats} from '../scripts/freeze-metrics.mjs';
const measure=raw=>freezeMetrics({displayIntervalMs:1000/60,...raw});
test('freeze measurements retain every late task and frame instead of filtering out freezes',()=>{
 const result=measure({tasks:[{startTime:10,duration:51},{startTime:20,duration:201}],frames:[16.6,16.7,220],inputs:[12,60],heapBytes:42});
 assert.equal(result.longTasks,2);assert.equal(result.freezes,1);assert.equal(result.maxTaskMs,201);assert.equal(result.frameP95Ms,220);assert.equal(result.inputMaxMs,60);assert.equal(result.heapBytes,42);
 assert.deepEqual(freezeViolations(result),['long_tasks','freezes','missed_frames','frame_max','input_delay','samples_insufficient']);
});
test('the five retained scenes require input and frame samples',()=>{
 assert.equal(FREEZE_SCENES.length,5);assert.ok(!FREEZE_SCENES.some(x=>x.id==='workflow'));
 assert.deepEqual(freezeViolations(measure({tasks:[],frames:[],inputs:[]})),['samples_missing']);
});
test('p95 is recorded against the measured display interval without discarding frames',()=>{
 const result=measure({frames:[16.7,16.8],inputs:[30]});
 assert.deepEqual(freezeViolations(result),['samples_insufficient']);
 assert.equal(result.frameP95Ms,16.8);assert.equal(result.frames.length,2);assert.equal(result.frameP95Ratio,16.8/(1000/60));
});
test('invalid or negative timing samples fail instead of becoming a fast result',()=>{
 assert.ok(freezeViolations(measure({frames:[16.7,NaN],inputs:[-3]})).includes('samples_invalid'));
});
test('initial rAF scheduling is retained separately and a startup freeze still fails',()=>{
 const result=measure({frames:[16.7],inputs:[30],startupDelayMs:201});
 assert.equal(result.startupDelayMs,201);assert.ok(freezeViolations(result).includes('startup_freeze'));
 assert.ok(freezeViolations(measure({frames:[16.7],inputs:[30],startupDelayMs:-1})).includes('samples_invalid'));
});
test('display cadence is the median of every valid empty-shell interval',()=>{
 assert.equal(displayInterval([22,20,21,23]),21.5);assert.equal(displayInterval([17,16,18]),17);
 assert.equal(displayInterval([]),null);assert.equal(displayInterval([16,NaN]),null);
 assert.ok(freezeViolations(freezeMetrics({frames:[16.7],inputs:[30]})).includes('display_interval_missing'));
});
test('one percent missed frames is allowed, two percent and intervals above100ms fail',()=>{
 const frames=Array(599).fill(20);assert.deepEqual(freezeViolations(measure({displayIntervalMs:20,frames:[...frames,100],inputs:[50]})),[]);
 const excessive=[...Array(586).fill(20),...Array(7).fill([31,20]).flat()];
 assert.deepEqual(freezeViolations(measure({displayIntervalMs:20,frames:excessive,inputs:[50]})),['missed_frames']);
 assert.deepEqual(freezeViolations(measure({displayIntervalMs:20,frames:[...frames,100.1],inputs:[50]})),['frame_max']);
 assert.deepEqual(freezeViolations(measure({displayIntervalMs:20,frames:Array(600).fill(30),inputs:[50]})),[]);
});
test('Electron records every frame but judges tasks, startup freezes and calibrated input',()=>{
 const result=measure({displayIntervalMs:21,frames:[21,150],inputs:[52]});assert.deepEqual(freezeViolations(result,{judgeFrames:false}),['samples_insufficient']);
 assert.equal(result.frameMaxMs,150);assert.equal(result.inputLimitMs,52);
 assert.ok(freezeViolations(measure({displayIntervalMs:21,frames:[21],inputs:[52.1]}),{judgeFrames:false}).includes('input_delay'));
 assert.ok(freezeViolations(measure({displayIntervalMs:21,frames:[21],inputs:[40],tasks:[{duration:51}]}),{judgeFrames:false}).includes('long_tasks'));
});
test('frame ratio judgment requires at least600 samples and retains the exact minimum boundary',()=>{
 assert.ok(freezeViolations(measure({frames:Array(599).fill(16.7),inputs:[30]})).includes('samples_insufficient'));
 assert.deepEqual(freezeViolations(measure({frames:Array(600).fill(16.7),inputs:[30]})),[]);
});
test('three consecutive missed frames fail even below the one percent ratio',()=>{
 const result=measure({frames:[...Array(597).fill(16.7),34,34,34],inputs:[30]});assert.equal(result.maxConsecutiveMissedFrames,3);assert.ok(freezeViolations(result).includes('consecutive_missed_frames'));
 const separated=measure({frames:[...Array(594).fill(16.7),34,16.7,34,16.7,34,16.7],inputs:[30]});assert.equal(separated.maxConsecutiveMissedFrames,1);assert.deepEqual(freezeViolations(separated),[]);
});

test('conversation admission preserves first4, bounded batches and the exact300ms deadline',async()=>{
 const {conversationAdmissionViolations}=await import('../scripts/freeze-metrics.mjs');
 const rows=Array.from({length:10},(_,i)=>({count:(i+1)*4,at:i*300/9}));
 assert.deepEqual(conversationAdmissionViolations(rows),[]);
 assert.deepEqual(conversationAdmissionViolations(rows.map((r,i)=>i===9?{...r,at:306.8}:r)),['admission_deadline']);
 assert(conversationAdmissionViolations([{count:8,at:0},{count:40,at:100}]).includes('admission_first_rows'));
 assert(conversationAdmissionViolations(rows.slice(0,-1)).includes('admission_incomplete'));
 assert(conversationAdmissionViolations([]).includes('admission_samples_missing'));
 assert(conversationAdmissionViolations([{count:4,at:0},{count:40,at:100}]).includes('admission_batch'));
});

// Condition A (design 2026-10-22 §6): GPU off and a slower CPU are opt-in run options; defaults keep today's run.
test('freeze run options default to today and read condition A from the environment',()=>{
 assert.deepEqual(freezeRunOptions({}),{chromeArgs:[],cpuThrottle:1});
 assert.deepEqual(freezeRunOptions({FREEZE_CHROME_ARGS:'--disable-gpu  --foo',FREEZE_CPU_THROTTLE:'4'}),{chromeArgs:['--disable-gpu','--foo'],cpuThrottle:4});
 assert.throws(()=>freezeRunOptions({FREEZE_CPU_THROTTLE:'0'}),/freeze_throttle_invalid/);
 assert.throws(()=>freezeRunOptions({FREEZE_CPU_THROTTLE:'2.5'}),/freeze_throttle_invalid/);
});
test('style recalculation stats come from complete UpdateLayoutTree events only',()=>{
 const events=[{ph:'X',name:'UpdateLayoutTree',dur:12000},{ph:'X',name:'UpdateLayoutTree',dur:79400},{ph:'B',name:'UpdateLayoutTree'},{ph:'X',name:'Layout',dur:50000}];
 assert.deepEqual(styleRecalcStats(events),{styleRecalcCount:2,styleRecalcMaxMs:79.4,styleRecalcTotalMs:91.4});
 assert.deepEqual(styleRecalcStats([]),{styleRecalcCount:0,styleRecalcMaxMs:0,styleRecalcTotalMs:0});
});
