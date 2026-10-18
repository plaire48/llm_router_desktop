import test from 'node:test';
import assert from 'node:assert/strict';
import {freezeMetrics,freezeViolations,FREEZE_SCENES} from '../scripts/freeze-metrics.mjs';
test('freeze measurements retain every late task and frame instead of filtering out freezes',()=>{
 const result=freezeMetrics({tasks:[{startTime:10,duration:51},{startTime:20,duration:201}],frames:[16.6,16.7,220],inputs:[12,60],heapBytes:42});
 assert.equal(result.longTasks,2);assert.equal(result.freezes,1);assert.equal(result.maxTaskMs,201);assert.equal(result.frameP95Ms,220);assert.equal(result.inputMaxMs,60);assert.equal(result.heapBytes,42);
 assert.deepEqual(freezeViolations(result),['long_tasks','freezes','frame_p95','input_delay']);
});
test('all six scenes require input and frame samples, including the full 60 second poll scene',()=>{
 assert.equal(FREEZE_SCENES.length,6);assert.equal(FREEZE_SCENES.find(x=>x.id==='workflow').durationMs,60000);
 assert.deepEqual(freezeViolations(freezeMetrics({tasks:[],frames:[],inputs:[]})),['samples_missing']);
});
