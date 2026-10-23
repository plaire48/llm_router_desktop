import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceOperation} from '../ui/workspace-operation.mjs';
const runId='run',task=(extra={})=>({id:'t',state:'running',responseTiming:{runId},trace:[],...extra});
const labels={read_source:'소스 읽기',review_task:'요구사항과 결과 확인'};
test('the footer describes the current tool, not an earlier run or raw tool arguments',()=>{
 const current=task({trace:[{runId:'old',tool:'review_task',status:'running'},{runId,tool:'read_source',status:'running',arguments:{password:'private'}}]});
 const value=workspaceOperation({task:current},labels);assert.equal(value.label,'소스 읽기 중');assert.equal(value.state,'running');assert.doesNotMatch(JSON.stringify(value),/private/);
});
test('writing, model waiting, answers and approval are distinct real states',()=>{
 assert.equal(workspaceOperation({task:task({streamingAnswer:'partial'})},labels).label,'답변 작성 중');
 assert.equal(workspaceOperation({task:task()},labels).label,'모델 응답 기다리는 중');
 assert.equal(workspaceOperation({task:task({state:'waiting_input',question:{toolRequest:{}}})},labels).label,'승인 대기');
 assert.equal(workspaceOperation({task:task({state:'waiting_input',question:{text:'답변?' }})},labels).label,'답변 대기');
 assert.equal(workspaceOperation({task:task({state:'review'})},labels),null);
});
test('a pending user operation and an actually running command stay visible after the actor stops',()=>{
 assert.equal(workspaceOperation({task:task({state:'review'}),action:{taskId:'t',label:'저장한 내용을 다시 확인하고 있어요'},busy:true},labels).label,'저장한 내용을 다시 확인하고 있어요');
 assert.equal(workspaceOperation({task:task({state:'review'}),processes:[{taskId:'t',state:'running'}]},labels).label,'명령 실행 중');
 assert.equal(workspaceOperation({task:task({state:'review'}),processes:[{taskId:'other',state:'running'}]},labels),null);
});
