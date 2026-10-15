import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {wikiChatBlocked,wikiChatJob} from '../runtime/wiki-chat-admission.mjs';
import {canDrainInputs} from '../runtime/agent-input.mjs';
installAgent(ProjectService);
const provider={status:()=>({connected:true,provider:'aipro',model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},complete:async()=>({content:'확인했습니다.',calls:[]})};
function writing(service){
  service.wikiInitOwner=service.store;service.wikiInitController=new AbortController();
  service.store.set('wiki-init',{id:'wiki-running',projectId:service.projectId,state:'running',stage:'generating',startedAt:new Date().toISOString(),percent:25,total:4,completed:1});
}
test('a live writer blocks all chat admissions without changing answers, questions or queued requests',async t=>{
  const {service}=await fixture(t);service.providers={...provider};
  const task=await service.createTask({request:'보존할 요청'});
  const saved={...task,state:'review',messages:[{id:'answer',role:'assistant',content:'보존할 답변'}],inbox:[{id:'queued',text:'보존할 대기 요청'}],resultReview:{status:'ready'}};
  service.store.set('task:'+task.id,saved);writing(service);
  const blocked=[['createTask',{request:'추가 요청'}],['startAgent',{taskId:task.id,answer:'추가 질문'}],['regenerateAnswer',{taskId:task.id,messageId:'answer'}],
    ...['enqueue','steer','start'].map(action=>['agentInput',{taskId:task.id,action,id:'queued',text:'새 요청'}])];
  for(const [method,args] of blocked)await assert.rejects(service[method](args),/^Error: wiki_chat_blocked$/);
  assert.deepEqual(service.store.get('task:'+task.id),saved);assert.equal(service.store.list('task:').length,1);assert.equal(service.store.list('answer-revision:').length,0);
  const question={...saved,state:'waiting_input',question:'어떤 결과가 필요한가요?'};service.store.set('task:'+task.id,question);
  await assert.rejects(service.answerAgent({taskId:task.id,answer:'문장'}),/wiki_chat_blocked/);assert.deepEqual(service.store.get('task:'+task.id),question);
  service.store.set('task:'+task.id,{...saved,state:'paused'});await assert.rejects(service.resumeAgent({taskId:task.id}),/wiki_chat_blocked/);
  assert.equal(service.state().wikiChatBlocked,true);assert.equal(service.state().wikiChatJob.percent,25);
});
test('the other project runs its own agent while this project writes its wiki; completion unlocks it',async t=>{
  const a=(await fixture(t)).service,b=(await fixture(t)).service;
  a.providers={...provider};b.providers={...provider};const preserved=await a.createTask({request:'나중에 시작할 요청'});writing(a);
  assert.equal(wikiChatBlocked(a),true);assert.equal(wikiChatBlocked(b),false);
  const task=await b.createTask({request:'다른 프로젝트에서 설명해 주세요.'});await b.startAgent({taskId:task.id});await b.agent.promise;
  assert.equal(b.task(task.id).state,'review');assert.equal(b.task(task.id).messages.at(-1).role,'assistant');
  a.store.set('wiki-init',{...a.store.get('wiki-init'),state:'completed'});assert.equal(a.state().wikiChatBlocked,false);
  await a.startAgent({taskId:preserved.id});await a.agent.promise;assert.equal(a.task(preserved.id).state,'review');
});
test('cancelled, failed and orphaned runs do not leave chat locked, and reading wiki evidence is not a writer',async t=>{
  const {service}=await fixture(t);writing(service);service.wikiInitController.abort();assert.equal(wikiChatBlocked(service),false);
  service.wikiInitController=null;assert.equal(wikiChatBlocked(service),false);
  service.wikiInitController=new AbortController();for(const state of ['attention','cancelled','completed','waiting_model']){service.store.set('wiki-init',{state});assert.equal(wikiChatBlocked(service),false);}
  service.documentResearch={state:'running'};assert.equal(wikiChatBlocked(service),false);
});
test('running wiki updates expose only real counts and preserve the queue until the writer finishes',async t=>{
  const {service}=await fixture(t);const task=await service.createTask({request:'요청'}),ready={...task,state:'review',resultReview:{status:'ready'}};
  service.wikiUpdateRun={id:'update',controller:new AbortController(),owner:service.store};
  service.store.set('wiki-update:update',{id:'update',state:'running',startedAt:new Date().toISOString(),events:[{type:'progress',stage:'generating',index:5,total:5,completed:2}]});
  assert.equal(wikiChatBlocked(service),true);assert.equal(canDrainInputs(service,ready),false);assert.equal(wikiChatJob(service).percent,40);assert.equal(wikiChatJob(service).kind,'update');
  service.store.set('wiki-update:update',{id:'update',state:'ready'});assert.equal(wikiChatBlocked(service),false);assert.equal(canDrainInputs(service,ready),true);
});
test('resume validation reserves the writer before async source checks without claiming page progress',async t=>{
  const {service}=await fixture(t);
  service.wikiUpdateRun={id:'update',owner:service.store,controller:new AbortController(),preparing:true,startedAt:new Date().toISOString()};
  service.store.set('wiki-update:update',{id:'update',state:'failed'});
  assert.equal(wikiChatBlocked(service),true);assert.equal(wikiChatJob(service).percent,null);
  service.wikiUpdateRun.controller.abort();assert.equal(wikiChatBlocked(service),false);
});
test('writer admission is rechecked after asynchronous mail validation before creating or starting chat',async t=>{
  const {service}=await fixture(t);service.providers={...provider};const task=await service.createTask({request:'보존할 요청'});
  const reference={id:'mail',sourceHash:'hash'};service.mail=async()=>{writing(service);return reference;};
  await assert.rejects(service.createTask({request:'불허할 새 요청',mailReferences:[reference]}),/wiki_chat_blocked/);assert.equal(service.store.list('task:').length,1);
  service.wikiInitController.abort();service.store.set('wiki-init',{state:'cancelled'});
  await assert.rejects(service.startAgent({taskId:task.id,answer:'불허할 후속 질문',mailReferences:[reference]}),/wiki_chat_blocked/);assert.deepEqual(service.task(task.id),task);
});
test('source synchronization blocks only its owning project and cancellation releases admission',async t=>{
 const {service}=await fixture(t);const controller=new AbortController();service.wikiRefreshOwner=service.store;service.wikiRefreshJob={id:'refresh',kind:'update',state:'running',stage:'syncing',startedAt:new Date().toISOString(),controller};
 assert.equal(wikiChatBlocked(service),true);assert.equal(wikiChatJob(service).stage,'syncing');assert.equal('controller' in wikiChatJob(service),false);
 await service.wikiUpdate({method:'cancel',id:'refresh'});assert(controller.signal.aborted);assert.equal(wikiChatBlocked(service),false);
});
