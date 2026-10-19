import test from 'node:test';import assert from 'node:assert/strict';
import {runFreezeEnvironments} from '../scripts/check-freeze-both.mjs';
test('native measurement still runs after a Chrome failure and neither failure is hidden',async()=>{
 const called=[];const result=await runFreezeEnvironments(async mode=>{called.push(mode);return mode==='browser'?1:0;});assert.deepEqual(called,['browser','electron']);assert.equal(result.exitCode,1);assert.deepEqual(result.results,[{mode:'browser',code:1},{mode:'electron',code:0}]);
});
test('both environments must pass; unstable Chrome remains a distinct non-pass',async()=>{
 assert.equal((await runFreezeEnvironments(async()=>0)).exitCode,0);
 assert.equal((await runFreezeEnvironments(async mode=>mode==='browser'?2:0)).exitCode,2);
 assert.equal((await runFreezeEnvironments(async mode=>mode==='electron'?1:2)).exitCode,1);
});
