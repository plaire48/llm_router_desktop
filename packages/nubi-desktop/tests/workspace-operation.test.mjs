import test from 'node:test';
import assert from 'node:assert/strict';
import {workspaceOperation} from '../ui/workspace-operation.mjs';
const runId='run',task=(extra={})=>({id:'t',state:'running',responseTiming:{runId},trace:[],...extra});
const labels={read_source:'소스 읽기',review_task:'요구사항과 결과 확인'};
test('the footer describes the current tool, not an earlier run or raw tool arguments',()=>{
 const current=task({trace:[{runId:'old',tool:'review_task',status:'running'},{runId,tool:'read_source',status:'running',arguments:{password:'private'}}]});
 const value=workspaceOperation({task:current},labels);assert.equal(value.label,'소스 읽기 중');assert.equal(value.state,'running');assert.equal(value.icon,'file');assert.doesNotMatch(JSON.stringify(value),/private/);
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

test('command stages and external tools retain their actual identity without publishing arguments',()=>{
 for(const tool of ['propose_setup_action','propose_command_repair','propose_process_input','read_process_output']){
  const value=workspaceOperation({task:task({trace:[{runId,tool,status:'running',arguments:{script:'PRIVATE_COMMAND'}}]})},{[tool]:'명령 확인'});
  assert.equal(value.icon,'terminal');assert.doesNotMatch(JSON.stringify(value),/PRIVATE_COMMAND/);
 }
 const external=workspaceOperation({task:task({trace:[{runId,tool:'mcp__playwright__browser_navigate',status:'running'}]})},labels);
 assert.equal(external.icon,'browser');assert.notEqual(external.label,'도구 실행 중');
 assert.equal(workspaceOperation({task:task({state:'review'}),processes:[{taskId:'t',state:'running'}]},labels).icon,'terminal');
 const executing=workspaceOperation({task:task(),processes:[{taskId:'t',state:'running'}]},labels);
 assert.equal(executing.label,'명령 실행 중','a live process must not appear as idle model waiting between tool calls');
 assert.equal(executing.icon,'terminal');
 assert.equal(workspaceOperation({task:task({streamingAnswer:'작성 중인 실제 응답'}),processes:[{taskId:'t',state:'running'}]},labels).label,'답변 작성 중','a persistent server does not hide public answer streaming');
});
