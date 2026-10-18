import {test} from 'node:test';import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';import {installAgent} from '../runtime/agent.mjs';import {readRunMetrics} from '../runtime/run-metrics.mjs';
installAgent(ProjectService);
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
test('host research retains purpose, metadata-only history and no leader edit observations',async t=>{
 const {service}=await fixture(t);const current=await service.read({path:'app.txt'});let child=0,leader=0;const parentResults=[];
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},complete:async(messages)=>{
  if(String(messages[0].content).startsWith('You are a read-only research assistant.'))return ++child===1?call('read_source',{path:'app.txt',start:1,end:1}):{content:'{"summary":"첫 줄은 first","findings":[{"claim":"첫 줄은 first","source":{"path":"app.txt","range":"1-1"}}],"unresolved":[]}',calls:[]};
  parentResults.push(...messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content)));
  if(++leader===1)return call('delegate_research',{goal:'첫 줄 확인',scope:{paths:['app.txt']}});
  if(leader===2)return call('propose_patch',{path:'app.txt',expectedHash:current.hash,edits:[{oldText:'first',newText:'changed'}],reason:'출처 읽기 없이 수정 시도'});
  return {content:'조사 결과를 참고했습니다. 원문 확인이 남았습니다.',calls:[]};
 }};
 const task=await service.createTask({request:'app.txt의 첫 줄을 조사해 줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
 assert.equal(child,2);assert.ok(parentResults.some(r=>r.advisory&&r.findings?.length===1));assert.ok(parentResults.some(r=>r.error==='source_read_required'),JSON.stringify(parentResults));
 const history=service.store.list('analysis-history:').find(r=>r.kind==='roles');assert.equal(history.workers[0].tool,'analysis_research');assert.equal(history.workers[0].analysis.calls,2);assert.equal(history.workers[0].analysis.delivered,true);
 const metrics=readRunMetrics(service.store,{taskId:task.id});assert.equal(metrics.summary.subagentCalls,2);assert.equal(metrics.summary.byPurpose.research.calls,2);
 assert.equal(service.store.list('proposal:').length,0);
});
test('F6 research model rejection reaches the leader and history with its code',async t=>{
 const {service}=await fixture(t);let leader=0;const returned=[];
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:200000}]}),dispose(){},complete:async messages=>{
  if(String(messages[0].content).startsWith('You are a read-only research assistant.'))throw Error('rate_limited');
  returned.push(...messages.filter(m=>m.role==='tool').map(m=>JSON.parse(m.content)));
  return ++leader===1?call('delegate_research',{goal:'첫 줄 확인',scope:{paths:['app.txt']}}):{content:'요청 한도 때문에 조사를 완료하지 못했어요.',calls:[]};
 }};
 const task=await service.createTask({request:'app.txt를 조사해 줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
 assert(returned.some(r=>r.error==='rate_limited'));
 const history=service.store.list('analysis-history:').find(r=>r.kind==='roles');assert.equal(history.workers[0].error,'rate_limited');
});
