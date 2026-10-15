import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {COMMAND_IDLE_MS} from '../runtime/processes.mjs';
import {humanDecisions} from '../ui/human-decisions.mjs';
import {decisionNoticeContent} from '../electron-app/decision-notices.cjs';
installAgent(ProjectService);
const wait=async check=>{for(let i=0;i<300;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}assert.fail('idle state did not settle');};
async function quiet(t,script='printf ORIGINAL; sleep 10'){
  const f=await fixture(t);f.service.processes.idleMs=80;
  const task=await f.service.createTask({request:'설치 결과 확인'});
  const record=await f.service.run({taskId:task.id,script,profile:'bash'});
  await wait(()=>f.service.task(task.id).question?.processIdle);
  return {...f,task,record};
}
const choose=(service,task,optionId)=>service.answerAgent({taskId:task.id,choice:{questionId:service.task(task.id).question.id,optionId}});

test('default idle interval is five minutes; continue keeps the same command without requiring AI login',async t=>{
  assert.equal(COMMAND_IDLE_MS,300000);
  const {service,task,record}=await quiet(t),q=service.task(task.id).question;
  const [notice]=humanDecisions({projectId:service.projectId,tasks:[service.task(task.id)]});
  assert.match(decisionNoticeContent(notice).body,/새 출력이 없어요/);
  assert.equal(q.inputMode,'none');assert.equal(q.options.length,2);
  const lastOutput=service.processes.poll(record.id).lastOutputAt;
  await choose(service,task,'option-1');
  assert.equal(service.task(task.id).question,null);
  assert.equal(service.processes.poll(record.id).lastOutputAt,lastOutput,'waiting is not output');
  assert.equal(service.processes.poll(record.id).state,'running');
  await assert.rejects(service.answerAgent({taskId:task.id,choice:{questionId:q.id,optionId:'option-2'}}),/question_changed/);
  await wait(()=>service.task(task.id).question);
  assert.notEqual(service.task(task.id).question.id,q.id);
  assert.equal(service.store.list('process:').length,1);
});

test('stop and diagnose waits for real exit, preserves output and never replays the command',async t=>{
  const {service,task,record}=await quiet(t);let calls=0;
  service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async messages=>{
    assert.equal(service.processes.active.has(record.id),false);
    assert.match(JSON.stringify(messages),/ORIGINAL/);assert.match(JSON.stringify(messages),/process_idle_stopped/);
    calls++;return {content:'중지 전 출력을 확인했습니다. 원인은 아직 미확인입니다.',calls:[]};
  }};
  await choose(service,task,'option-2');
  await wait(()=>service.processes.poll(record.id).recoveryState==='review');
  assert.equal(calls,1);assert.equal(service.processes.poll(record.id).state,'interrupted');
  assert.equal(service.store.list('process:').length,1);
});

test('new output withdraws the question and stale decisions cannot stop the running command',async t=>{
  const {service,task,record,root}=await quiet(t,'printf ORIGINAL; while [ ! -f release ]; do sleep .02; done; printf RESUMED; sleep 10');
  const q=service.task(task.id).question;
  await writeFile(path.join(root,'release'),'go');
  await wait(()=>service.processes.poll(record.id).output.includes('RESUMED'));
  assert.equal(service.task(task.id).question,null);
  await assert.rejects(service.answerAgent({taskId:task.id,choice:{questionId:q.id,optionId:'option-2'}}),/question_changed/);
  assert.equal(service.processes.poll(record.id).state,'running');
});

test('completion clears an outstanding idle question before result analysis',async t=>{
  const {service,task,record,root}=await quiet(t,'while [ ! -f release ]; do sleep .02; done');
  await writeFile(path.join(root,'release'),'go');
  await wait(()=>service.processes.poll(record.id).state==='completed');
  assert.equal(service.task(task.id).question,null);
  assert.equal(service.processes.poll(record.id).recoveryState,'queued');
});

test('servers, manual commands and user cancellations do not create idle recovery prompts',async t=>{
  const {service}=await fixture(t);service.processes.idleMs=40;
  const task=await service.createTask({request:'서버와 터미널 유지'});
  const server=await service.processes.start({cwd:service.root,taskId:task.id,profile:'bash',script:'sleep 10',idleCheck:false});
  const manual=await service.processes.start({cwd:service.root,taskId:task.id,profile:'bash',script:'sleep 10',terminalRequestId:'manual'});
  const stopped=await service.run({taskId:task.id,profile:'bash',script:'sleep 10'});
  service.processes.stop(stopped.id);
  await new Promise(r=>setTimeout(r,120));
  assert.equal(service.task(task.id).question,undefined);
  assert.equal(service.processes.poll(stopped.id).state,'cancelled');
  assert.equal(service.recoveryQueue.size,0);
  assert.equal(service.processes.poll(server.id).state,'running');assert.equal(service.processes.poll(manual.id).state,'running');
});

test('an existing human question and an active model turn are never overwritten',async t=>{
  const {service}=await fixture(t);service.processes.idleMs=40;
  const task=await service.createTask({request:'질문 유지'});
  await service.run({taskId:task.id,profile:'bash',script:'sleep 10'});
  service.store.set('task:'+task.id,{...task,state:'waiting_input',question:{id:'existing',text:'기존 질문'}});
  await new Promise(r=>setTimeout(r,100));assert.equal(service.task(task.id).question.id,'existing');
  service.store.set('task:'+task.id,{...task,state:'running'});
  service.agent={taskId:task.id,running:true};await service.drainRecovery();
  assert.equal(service.task(task.id).question,undefined);
  service.agent.running=false;await service.drainRecovery();
  assert(service.task(task.id).question.processIdle);
});

test('host restart removes stale wait choices without claiming the previous command stopped',async t=>{
  const {service,task,record,root}=await quiet(t);
  const savedTask=service.task(task.id),savedProcess=service.processes.poll(record.id);
  service.dispose();await wait(()=>!service.processes.active.size);
  // Simulate the disk records left by a crash after cleaning the test subprocess.
  service.store.set('task:'+task.id,savedTask);service.store.set('process:'+record.id,savedProcess);
  service.store.close();await service.open(root);
  assert.equal(service.task(task.id).question,null);
  assert.equal(service.task(task.id).state,'interrupted');
  assert.equal(service.processes.poll(record.id).execution,'unknown');
  assert.equal(service.recoveryQueue.size,0);
});

test('an approved server repair retains the server idle exemption',async t=>{
  const {service}=await fixture(t);service.processes.idleMs=40;
  const task=await service.createTask({request:'서버 실행 오류 수정'});
  const original=await service.processes.start({cwd:service.root,taskId:task.id,profile:'bash',script:'exit 1',autoDiagnose:false,idleCheck:false});
  await wait(()=>service.processes.poll(original.id).state==='failed');
  const repair=await service.proposeCommandRepair({taskId:task.id,processId:original.id,script:'sleep 10',reason:'Correct the server command'});
  const approved=await service.applyCommandRepair({id:repair.id});
  await new Promise(r=>setTimeout(r,120));
  const record=service.processes.poll(approved.resultProcessId);
  assert.equal(record.state,'running');assert.equal(record.idleCheck,false);
  assert.equal(service.task(task.id).question,undefined);
});
