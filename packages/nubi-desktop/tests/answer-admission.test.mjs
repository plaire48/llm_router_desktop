import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const status=()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000,maxInputTokens:24000,maxOutputTokens:4096}]});

// An answer the host cannot start yet must not consume the question: the card would keep the typed answer, a retry
// would fail with question_changed, and the answer would never reach the conversation.
test('a busy host refuses an answer without consuming the question, and the same answer works once it is free',async t=>{
  const {service}=await fixture(t);let round=0;
  service.providers={status,dispose(){},async complete(){return round++===0?call('ask_user',{question:'설정 파일 경로는 어디인가요?',input_mode:'text'}):{content:'경로를 확인했습니다. 실행 검증은 아직 하지 않았습니다.',calls:[]};}};
  const task=await service.createTask({request:'설정 파일을 고쳐 주세요'});await service.startAgent({taskId:task.id});await service.agent.promise;
  const question=service.task(task.id).question;assert.equal(service.task(task.id).state,'waiting_input');
  service.setupBusy=true;
  await assert.rejects(service.answerAgent({taskId:task.id,answer:'config/app.json'}),/agent_busy/);
  const kept=service.task(task.id);assert.equal(kept.state,'waiting_input');assert.equal(kept.question?.id,question.id);assert.deepEqual(kept.questionHistory||[],[]);
  service.setupBusy=false;
  await service.answerAgent({taskId:task.id,answer:'config/app.json'});await service.agent.promise;
  const done=service.task(task.id);assert.equal(done.question,null);assert.equal(done.questionHistory.length,1);assert.equal(done.questionHistory[0].answer.text,'config/app.json');
});

// Steering admitted in the moment before the run stored its question stays bound to that run's input chain. The run
// the answer starts continues that chain, so it reaches the model instead of staying behind as a 보류 bubble (user
// decision 2026-10-23). The test builds the stored state that race leaves.
test('steering left from the run that asked a question reaches the run that the answer starts',async t=>{
  const {enqueueInput}=await import('../../../extensions/aipro-chat/agent-inbox.js');const {inputBinding}=await import('../runtime/agent-input.mjs');
  const {service}=await fixture(t);let round=0,askingChain;const seen=[];
  service.providers={status,dispose(){},async complete(messages){
    seen.push(JSON.stringify(messages));
    if(round++===0){askingChain=service.agent.inputChain;return call('ask_user',{question:'설정 파일 경로는 어디인가요?',input_mode:'text'});}
    return {content:'경로와 추가 요청을 반영하겠습니다. 실행 검증은 아직 하지 않았습니다.',calls:[]};
  }};
  const task=await service.createTask({request:'설정 파일을 고쳐 주세요'});await service.startAgent({taskId:task.id});await service.agent.promise;
  const asked=service.task(task.id);assert.equal(asked.state,'waiting_input');
  asked.inbox=enqueueInput(asked.inbox||[],{id:'steer-1',text:'테스트 파일도 같이 고쳐 주세요',mode:'steer'},{...inputBinding(service,task.id),runId:askingChain});service.store.set('task:'+task.id,asked);
  await service.answerAgent({taskId:task.id,answer:'config/app.json'});await service.agent.promise;
  const done=service.task(task.id);
  assert.deepEqual(done.inbox||[],[],'nothing is left behind as 보류');
  assert(done.messages.some(message=>message.role==='user'&&message.content==='테스트 파일도 같이 고쳐 주세요'),'the steering is in the conversation');
  assert(seen.at(-1).includes('테스트 파일도 같이 고쳐 주세요'),'the model of the answered run saw it');
});
