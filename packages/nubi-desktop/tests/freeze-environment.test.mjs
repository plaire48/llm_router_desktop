import test from 'node:test';
import assert from 'node:assert/strict';
const subject=await import('../scripts/freeze-environment.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
test('an empty-shell missed ratio above one percent stops qualification with exit2',()=>{
 const result=subject.calibrationState([...Array(178).fill(16.7),33.4,33.4]);
 assert.equal(result.status,'environment_unstable');assert.equal(result.metrics.missedFrames,2);assert.equal(result.metrics.frameSamples,180);
 assert.equal(subject.freezeExitCode({code:'environment_unstable'}),2);
});
test('exactly one percent stays eligible without subtracting idle intervals from scene data',()=>{
 const frames=[...Array(198).fill(16.7),33.4,33.4],result=subject.calibrationState(frames);
 assert.equal(result.status,'ready');assert.equal(result.metrics.missedFrameRatio,.01);assert.deepEqual(result.metrics.frames,frames);
});
test('an invalid or absent empty-shell sample is a measurement failure rather than environment instability',()=>{
 for(const frames of [[],[16.7,NaN],[16.7,0]])assert.throws(()=>subject.calibrationState(frames),/calibration_invalid/);
 assert.equal(subject.freezeExitCode(new Error('calibration_invalid')),1);
});
test('an unstable environment cannot erase an already observed product failure',()=>{
 const error={code:'environment_unstable'};
 assert.equal(subject.freezeExitCode(error,{results:[{violations:['input_delay']}]}),1);
 assert.equal(subject.freezeExitCode(error,{errors:['render failed']}),1);
 assert.equal(subject.freezeExitCode(error,{results:[{violations:['input_delay']}],baseline:true}),2);
 assert.equal(subject.freezeExitCode(new Error('P1 limits')),1);
});
test('load diagnostics retain high CPU processes in descending order using names without arguments',()=>{
 const rows=subject.parseProcessLoad(' 12 1 27.0 2.0 /System/Library/corespotlightd\n 11 1 85.5 1.0 /System/Library/mediaanalysisd\n 13 1 0.0 0.5 /Applications/Google Chrome\n invalid row\n');
 assert.deepEqual(rows.map(x=>[x.pid,x.cpuPercent]),[[11,85.5],[12,27],[13,0]]);
 assert.equal(rows[2].command,'/Applications/Google Chrome');assert.equal(rows[0].parentPid,1);
});
test('real host load diagnostics report loadavg and bounded process data without command arguments',async()=>{
 const result=await subject.captureSystemLoad();assert.equal(result.loadavg.length,3);assert.ok(result.loadavg.every(Number.isFinite));
 if(process.platform==='win32'){assert.equal(result.loadavgStatus,'unsupported');assert.equal(result.processError,'process_load_unsupported');assert.deepEqual(result.processes,[]);return;}
 assert.ok(result.cpuCount>0);assert.ok(result.processes.length>0&&result.processes.length<=10);assert.equal(result.processError,null);
 assert.ok(result.processes.every(x=>Number.isInteger(x.pid)&&Number.isFinite(x.cpuPercent)&&!Object.hasOwn(x,'args')));
});
