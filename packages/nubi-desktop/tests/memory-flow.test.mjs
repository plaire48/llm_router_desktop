import test from 'node:test';import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {memoryStores,listMemories,saveMemory,updateMemory,deleteMemory,memoryReference,validateMemoryReferences,queueMemoryExtraction,closeUserMemoryStore} from '../runtime/memory.mjs';
import {stopProjectWork} from '../runtime/project-navigation.mjs';
installAgent(ProjectService);
const status=()=>({connected:true,provider:'chatgpt',model:'fixture',models:[{id:'fixture',contextLength:32000}]});
const gate=()=>{let release;return {promise:new Promise(resolve=>{release=resolve;}),release:()=>release()};};
async function setup(t){const result=await fixture(t);t.after(()=>closeUserMemoryStore(result.service.storageRoot));return result;}

test('selected memories are canonical, versioned and scoped, even with automatic memory off',async t=>{
 const {service}=await setup(t),stores=memoryStores(service),row=saveMemory(stores,{text:'답변은 표로 정리해 주세요.',scope:'user'}),ref=memoryReference(row);
 const canonical=validateMemoryReferences(service,[{...ref,text:'forged renderer text'}]);assert.equal(canonical[0].text,row.text);
 stores.project.set('memory-setting',{enabled:false});let received;
 service.providers={status,dispose(){},complete:async wire=>{received=wire;return {content:'표로 정리하겠습니다.',calls:[]};}};
 const task=await service.createTask({request:'내가 지정한 선호로 답해 주세요.',memoryReferences:[ref]});assert.deepEqual(task.requestMemoryReferences,[ref]);
 await service.startAgent({taskId:task.id});await service.agent.promise;
 assert(JSON.stringify(received).includes(row.text));assert.match(JSON.stringify(received),/reference data|not instructions/);
 const answer=service.task(task.id).messages.findLast(message=>message.role==='assistant');assert.equal(answer.memoryReferences[0].id,row.id);
 updateMemory(stores,row.id,'답변은 문장으로 정리해 주세요.');await assert.rejects(service.createTask({request:'오래된 참조',memoryReferences:[ref]}),/memory_changed/);
 deleteMemory(stores,row.id);assert.throws(()=>validateMemoryReferences(service,[ref]),/memory_missing/);
});

test('queued memory references survive editing and are revalidated before starting',async t=>{
 const {service}=await setup(t),stores=memoryStores(service),ref=memoryReference(saveMemory(stores,{text:'큐의 기억 참조'}));
 service.providers={status,dispose(){},complete:async(wire,tools,signal)=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}))};
 const task=await service.createTask({request:'진행 중인 요청'});await service.startAgent({taskId:task.id});
 const args={taskId:task.id,action:'enqueue',id:'memory-queued-input',runId:service.agent.runId,text:'참조한 기억으로 답변',memoryReferences:[ref]};
 await service.agentInput(args);assert.equal(service.task(task.id).inbox[0].memoryReferences[0].id,ref.id);
 const edited=await service.agentInput({taskId:task.id,action:'remove',id:args.id});assert.deepEqual(edited.memoryReferences,[ref]);
 await service.agentInput(args);await service.stopAgent({taskId:task.id});updateMemory(stores,ref.id,'사용자가 바꾼 기억');
 await assert.rejects(service.agentInput({taskId:task.id,action:'start',id:args.id}),/memory_changed/);
 assert.equal(service.task(task.id).inbox.length,1);
});

test('steering delivers new reference text and retains the original reference snapshot',async t=>{
 const {service}=await setup(t),stores=memoryStores(service),first=memoryReference(saveMemory(stores,{text:'처음 선택한 프로젝트 사실'})),second=memoryReference(saveMemory(stores,{text:'중간에 선택한 별도 사실'})),entered=gate();let rounds=0,wire;
 service.providers={status,dispose(){},complete:async(messages,_tools,signal)=>{
  if(++rounds===1){entered.release();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));}
  wire=JSON.stringify(messages);return {content:'중간 요청과 참조를 반영했습니다.',calls:[]};
 }};
 const task=await service.createTask({request:'선택한 사실을 참고합니다.',memoryReferences:[first]});await service.startAgent({taskId:task.id});await entered.promise;
 await service.agentInput({taskId:task.id,action:'enqueue',id:'steer-memory',runId:service.agent.runId,text:'추가 사실도 참고해 주세요.',mode:'steer',memoryReferences:[second]});await service.agent.promise;
 assert(wire.includes(second.text),'the steered model must receive the canonical memory text');
 const saved=service.task(task.id),answer=saved.messages.findLast(row=>row.role==='assistant');assert.deepEqual(new Set(answer.memoryReferences.map(row=>row.id)),new Set([first.id,second.id]));assert.equal(saved.messages.find(row=>row.inputId==='steer-memory').content,'추가 사실도 참고해 주세요.');
});

test('background memory completion updates notes without replacing a newer conversation',async t=>{
 const {service}=await setup(t),entered=gate(),release=gate();t.after(()=>release.release());service.memoryExtraction=true;let turns=0,memoryCalls=0;
 service.providers={status,dispose(){},complete:async wire=>{
  if(wire[0].content.startsWith('You maintain a short memory')){if(memoryCalls++===0){entered.release();await release.promise;return {content:'{"add":[{"text":"한국어로 답변하는 것을 선호한다","scope":"user"}]}',calls:[]};}return {content:'{}',calls:[]};}
  return {content:++turns===1?'첫 번째 답변':'두 번째 답변',calls:[]};
 }};
 const task=await service.createTask({request:'나는 한국어 답변을 좋아해.'});await service.startAgent({taskId:task.id});await service.agent.promise;await entered.promise;
 await service.startAgent({taskId:task.id,answer:'다음 요청도 처리해 주세요.'});await service.agent.promise;
 release.release();await Promise.all([...service.memoryJobs.values()].map(job=>job.promise));
 const saved=service.task(task.id);assert(saved.messages.some(message=>message.content==='두 번째 답변'));assert.equal(saved.state,'review');assert.equal(saved.memoryNotes.length,1);assert.equal(saved.memoryNotes[0].saved[0].text,'한국어로 답변하는 것을 선호한다');
});

for(const action of ['stop','navigate','provider','cancelled'])test(`pending extraction cannot save after ${action}`,async t=>{
 const {service}=await setup(t),task=await service.createTask({request:'기억할 사용자 선호'}),entered=gate(),release=gate();t.after(()=>release.release());let model='fixture',signal;
 service.store.set('task:'+task.id,{...task,state:'review',messages:[{id:'completed',role:'assistant',content:'이미 완료한 답변'}]});
 service.providers={status:()=>({...status(),model}),dispose(){}};
 const pending=queueMemoryExtraction(service,{taskId:task.id,runId:'pending-'+action,request:task.request,invoke:async(_wire,_tools,active)=>{signal=active;entered.release();await release.promise;return {content:'{"add":[{"text":"저장하면 안 되는 선호"}]}'};}});
 await entered.promise;let navigation;
 if(action==='stop')await service.stopAgent({taskId:task.id});
 else if(action==='navigate'){navigation=stopProjectWork(service);await new Promise(resolve=>setImmediate(resolve));assert(signal.aborted);}
 else if(action==='provider')model='different-model';
 else service.store.set('task:'+task.id,{...service.task(task.id),state:'cancelled'});
 release.release();await pending;await navigation;
 assert.equal(listMemories(memoryStores(service)).length,0);assert.equal(service.memoryJobs.size,0);assert.equal(service.task(task.id).memoryNotes?.length||0,0);
 if(action==='navigate')assert.equal(service.task(task.id).state,'review','stopping optional memory must not cancel a completed answer');
});
