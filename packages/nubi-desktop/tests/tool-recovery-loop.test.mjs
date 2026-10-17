import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createToolRecoveryLoop} from '../runtime/tool-recovery-loop.mjs';
import {processRecoveryView} from '../ui/process-recovery-view.mjs';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
installAgent(ProjectService);
const create=()=>createToolRecoveryLoop({readTools:new Set(['read_source','source_search'])});
const failed={ok:false,error:'source_missing',actionIssued:false};

test('correctable failures get an alternative attempt; metadata is not recovery evidence',()=>{
 const loop=create();loop.observe('read_source',{path:'missing'},failed);
 loop.observe('update_plan',{}, {ok:true});assert.equal(loop.settle().status,'revise');
 loop.observe('source_search',{query:'entry'}, {results:[{path:'app.txt'}]});
 assert.equal(loop.settle().status,'accepted');
});
test('identical failures are not dispatched a third time; fresh evidence permits a new attempt',()=>{
 const loop=create();for(let i=0;i<2;i++)loop.observe('read_source',{path:'missing',start:1},failed);
 assert.equal(loop.before('read_source',{start:1,path:'missing'}).actionIssued,false);
 assert.equal(loop.before('read_source',{path:'app.txt',start:1}),null);
 loop.observe('inspect_path',{path:'.'},{entries:['missing']});
 assert.equal(loop.before('read_source',{path:'missing',start:1}),null);
});
test('permission, uncertain writes, cancellation and waiting never trigger recovery nudges',()=>{
 for(const result of [{error:'path_scope',actionIssued:false},{error:'tool_timeout',execution:'unconfirmed'},{error:'source_missing',cancelled:true},{error:'setup_invalid',actionIssued:true}]){
  const loop=create();loop.observe('propose_setup_action',{},result);assert.equal(loop.settle().status,'accepted');
 }
 const loop=create();loop.observe('read_source',{},failed);assert.equal(loop.settle({blocked:true}).status,'accepted');
 loop.observe('read_source',{}, {error:'path_scope',actionIssued:false});assert.equal(loop.settle().status,'accepted');
});
test('only one stall escape per failed call is granted and no more than two per run',()=>{
 const loop=create();
 for(const path of ['a','b','c']){
  loop.observe('read_source',{path},failed);
  assert.equal(loop.stall('read_source',{path}),path!=='c');
  assert.equal(loop.stall('read_source',{path}),false);
 }
 assert.equal(loop.stall('propose_setup_action',{script:'echo retry'}),false);
});

test('recovery does not create an unbounded explanation-only model loop',()=>{
 const loop=create();loop.observe('read_source',{},failed);
 assert.equal(loop.settle().status,'revise');assert.equal(loop.settle().status,'revise');assert.equal(loop.settle().status,'accepted');
});
test('automatic command review has no manual diagnosis button and finished review leaves no stale error card',()=>{
 for(const state of ['queued','diagnosing'])assert.equal(processRecoveryView({state:'failed',recoveryState:state},{connected:true}).pending,true);
 for(const state of ['review','waiting_input','cancelled'])assert.equal(processRecoveryView({state:'failed',recoveryState:state},{connected:true}),null);
 assert.equal(processRecoveryView({state:'failed',recoveryState:'attention'},{connected:true}).action,'이어서 해결');
 assert.equal(processRecoveryView({state:'failed',recoveryState:'queued'},{connected:false}).action,'AI 연결');
 assert.equal(processRecoveryView({state:'failed'},{connected:true,cancelled:true}),null);
});
const call=(name,args)=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
const status=()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:128000}]});

test('real tool loop continues an error-only answer and reads the alternate source before delivering',async t=>{
 const {service}=await fixture(t);let round=0;const reads=[],read=service.read.bind(service);
 service.read=async args=>{reads.push(args.path);return read(args);};
 service.providers={status,dispose(){},async complete(messages){
  switch(round++){
   case 0:return call('read_source',{path:'missing.txt'});
   case 1:return {content:'파일을 읽지 못했어요. 오류를 분석해 주세요.',calls:[]};
   case 2:assert.match(JSON.stringify(messages),/recoverableFailure/);return call('read_source',{path:'app.txt'});
   default:return {content:'첫 줄은 first입니다.',calls:[]};
  }
 }};
 const task=await service.createTask({request:'app.txt 첫 줄을 알려줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
 assert.deepEqual(reads,['missing.txt','app.txt']);assert.equal(service.task(task.id).state,'review');
 assert.match(service.task(task.id).messages.at(-1).content,/first/);
 assert.equal(service.task(task.id).question,null);
 assert.equal(service.store.list('process:').length,0);
});

test('real tool loop changes method after repeated search failure without repeating the backend scan',async t=>{
 const {service}=await fixture(t);let calls=0,round=0;
 service.search=async()=>{calls++;throw Error('search_unavailable');};
 service.providers={status,dispose(){},async complete(messages){
  if(round++<3)return call('source_search',{query:'first'});
  if(round===4){assert.match(messages.findLast(m=>m.role==='tool').content,/NOT executed again/);return call('read_source',{path:'app.txt'});}
  return {content:'첫 줄은 first입니다.',calls:[]};
 }};
 const task=await service.createTask({request:'첫 줄을 찾아 알려줘'});await service.startAgent({taskId:task.id});await service.agent.promise;
 assert.equal(calls,2);assert.match(service.task(task.id).messages.at(-1)?.content||'',/first/);assert.equal(service.task(task.id).question,null);
});
