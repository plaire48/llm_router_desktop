import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';
import {ProjectService} from '../runtime/project-service.mjs';
import {installAgent} from '../runtime/agent.mjs';
import {McpRegistry} from '../runtime/mcp.mjs';
import {approvalPolicy} from '../runtime/approval-policy.mjs';
installAgent(ProjectService);
const name='mcp__playwright__browser_open';
const call=args=>({content:'',calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(args)}}]});
async function setup(t){
 const f=await fixture(t),calls=[];
 const registry=new McpRegistry({file:f.directory+'/mcp.json',playwright:async()=>({listTools:async()=>({tools:[{name:'browser_open',inputSchema:{type:'object',properties:{url:{type:'string'}},required:['url']},annotations:{readOnlyHint:false}}]}),callTool:async args=>{calls.push(args);return {content:[{type:'text',text:JSON.stringify({tabId:'actual-tab',documentId:'doc'})}]};},close:async()=>{}})});
 await registry.connectEnabled();f.service.mcpRegistry=()=>registry;f.service.mcpDefinitions=async()=>registry.definitions();t.after(()=>registry.dispose());
 return {...f,calls,registry};
}
for(const label of ['실행','항상 허용','취소'])test(`MCP ${label}: exact approval continues before another model turn`,async t=>{
 const {service,calls}=await setup(t),task=await service.createTask({request:'웹 페이지를 열어 확인해 주세요'});let turn=0;
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},async complete(messages){
  if(turn++===0)return call({url:'https://example.invalid/one'});
  assert.equal(calls.length,label==='취소'?0:1,'approval must execute without asking the model to recreate the call');
  assert.match(JSON.stringify(messages),label==='취소'?/cancelled/:/actual-tab/);
  if(turn===2)return call({url:'https://example.invalid/one'});
  return {content:label==='취소'?'요청한 실행을 취소했습니다.':'브라우저를 열었습니다.',calls:[]};
 }};
 await service.startAgent({taskId:task.id});await service.agent.promise;
 const question=service.task(task.id).question;assert.equal(calls.length,0);assert.equal(service.task(task.id).pendingMcp.name,name);
 await service.answerAgent({taskId:task.id,choice:{questionId:question.id,optionId:question.options.find(o=>o.label===label).id}});await service.agent.promise;
 assert.equal(turn,3);assert.equal(service.task(task.id).state,'review',JSON.stringify({error:service.task(task.id).error,continuation:service.task(task.id).mcpContinuation,calls}));assert.equal(calls.length,label==='취소'?0:1);
 assert.equal(approvalPolicy(service.store).allowedMcpTools.length,label==='항상 허용'?1:0);
 if(label==='항상 허용'){
  service.store.close();await service.open(service.root);
  assert.equal(approvalPolicy(service.store).allowedMcpTools[0].tool,'browser_open');
  const second=await service.createTask({request:'다른 웹페이지 열기'});let next=0;
  service.providers={...service.providers,complete:async()=>next++===0?call({url:'https://example.invalid/two'}):{content:'열었습니다.',calls:[]}};
  await service.startAgent({taskId:second.id});await service.agent.promise;
  assert.equal(calls.length,2);assert.equal(service.task(second.id).question,null);
 }
});

test('an uncertain approved call is not replayed when the model asks again',async t=>{
 const {service,calls,registry}=await setup(t),task=await service.createTask({request:'웹 열기'});let turn=0;
 registry.call=async(...args)=>{calls.push(args);throw Error('mcp_call_timeout');};
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},async complete(messages){
  if(turn++<2)return call({url:'https://example.invalid/uncertain'});
  assert.match(JSON.stringify(messages),/unconfirmed/);return {content:'실행 결과를 확인하지 못했습니다.',calls:[]};
 }};
 await service.startAgent({taskId:task.id});await service.agent.promise;
 const q=service.task(task.id).question;
 await assert.rejects(service.answerAgent({taskId:task.id,choice:{questionId:q.id,text:'실행\n취소'}}),/answer_invalid/);
 await service.answerAgent({taskId:task.id,choice:{questionId:q.id,optionId:q.options[0].id}});await service.agent.promise;
 assert.equal(calls.length,1);assert.equal(service.task(task.id).mcpContinuation.result.execution,'unconfirmed');
});

test('MCP call identity ignores object key order but preserves target and array order',()=>{
 const registry=new McpRegistry({file:'unused'});
 assert.equal(registry.fingerprint(name,{tabId:'a',fields:{x:1,y:2}}),registry.fingerprint(name,{fields:{y:2,x:1},tabId:'a'}));
 assert.notEqual(registry.fingerprint(name,{tabId:'a'}),registry.fingerprint(name,{tabId:'b'}));
 assert.notEqual(registry.fingerprint(name,{values:[1,2]}),registry.fingerprint(name,{values:[2,1]}));
});

test('an interrupted dispatch is evidence of uncertainty, never permission to replay',async t=>{
 const {service,calls,registry}=await setup(t),task=await service.createTask({request:'중단한 웹 작업 확인'}),args={url:'https://example.invalid/interrupted'};
 task.mcpContinuation={name,args,fingerprint:registry.fingerprint(name,args),state:'executing'};service.store.set('task:'+task.id,task);let turn=0;
 service.providers={status:()=>({connected:true,model:'fixture',models:[{id:'fixture',contextLength:32000}]}),dispose(){},async complete(messages){assert.match(JSON.stringify(messages),/unconfirmed/);return turn++===0?call(args):{content:'이전 실행의 결과 확인이 필요합니다.',calls:[]};}};
 await service.startAgent({taskId:task.id});await service.agent.promise;assert.equal(calls.length,0);assert.equal(turn,2);
});
