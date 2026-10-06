import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeBrowserRuns} from '../evaluation/merge-browser-runs.mjs';
const tasks=[{id:'A',goal:'Read',readOnly:true,environment:'public-live'},{id:'B',goal:'Fill',readOnly:false,environment:'local-fixture'}];
const source=(trials,patch={})=>({path:'fixture.json',sha256:'b'.repeat(64),report:{suite:'browser-30-v1',candidateSha256:'a'.repeat(64),model:'sol',provider:'chatgpt',status:'trials_recorded',trials:trials.map(([id,status])=>({id,status,goal:tasks.find(t=>t.id===id)?.goal,model:'sol'})),...patch}});
test('disjoint fixed-candidate trials combine with original hash provenance',()=>{
 const result=mergeBrowserRuns(tasks,[source([['A','answered']]),source([['B','agent_error']])]);
 assert.deepEqual(result.trials.map(t=>t.status),['answered','agent_error']);assert.equal(result.provenance.length,2);assert.equal(result.accuracy,null);
 for(const patch of [{candidateSha256:'c'.repeat(64)},{model:'luna'},{status:'running'}])assert.throws(()=>mergeBrowserRuns(tasks,[source([['A','answered']]),source([['B','answered']],patch)]));
 assert.throws(()=>mergeBrowserRuns(tasks,[source([['A','answered']])]),/incomplete/);
});
test('only explicitly named public read-only technical errors can be replaced',()=>{
 const retry=source([['A','answered']]);
 const result=mergeBrowserRuns(tasks,[source([['A','runner_error'],['B','answered']]),retry],{technicalRetries:['A']});
 assert.equal(result.technicalRetries[0].status,'runner_error');assert.equal(result.trials[0].status,'answered');
 for(const status of ['answered','agent_error','timeout','awaiting_user'])assert.throws(()=>mergeBrowserRuns(tasks,[source([['A',status],['B','answered']]),retry],{technicalRetries:['A']}),/duplicate/);
 assert.throws(()=>mergeBrowserRuns(tasks,[source([['A','runner_error'],['B','answered']]),retry]),/duplicate/);
 assert.throws(()=>mergeBrowserRuns(tasks,[source([['A','answered'],['B','runner_error']]),source([['B','answered']])],{technicalRetries:['B']}),/duplicate/);
});
