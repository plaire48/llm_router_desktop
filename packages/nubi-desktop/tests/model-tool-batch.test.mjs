import test from 'node:test';
import assert from 'node:assert/strict';
import {completeChatGPT} from '../../../extensions/aipro-chat/chatgpt-api.js';
import {chatgptToken} from '../../../extensions/aipro-chat/tests/fixtures/chatgpt.mjs';
import {modelTransport} from '../runtime/recovery.mjs';
const tools=[{type:'function',function:{name:'read_source',description:'Read source',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}}}];
function callsSSE(count){
 const events=[{type:'response.created',response:{id:'resp_batch'}}],output=[];
 for(let i=0;i<count;i++){
  const item={type:'function_call',id:'fc_'+i,call_id:'call_'+i,name:'read_source',arguments:JSON.stringify({path:`record-${i}.md`}),status:'completed'};output.push(item);
  events.push({type:'response.output_item.added',output_index:i,item:{...item,arguments:''}},{type:'response.function_call_arguments.delta',output_index:i,delta:item.arguments},{type:'response.output_item.done',output_index:i,item});
 }
 events.push({type:'response.completed',response:{id:'resp_batch',status:'completed',output}});
 return events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}
const complete=count=>completeChatGPT({messages:[{role:'user',content:'Read the source records'}],tools,modelId:'gpt-5.6-sol',credential:{token:chatgptToken()},signal:new AbortController().signal,onText(){},onPhase(){},fetchImpl:async()=>new Response(callsSSE(count),{headers:{'content-type':'text/event-stream'}})});
test('the actual ChatGPT adapter accepts eight calls but refuses nine before any tool execution',async()=>{
 assert.equal((await complete(8)).calls.length,8);await assert.rejects(complete(9),/response_invalid/);
});
test('actor and delegated transport communicate the batch limit and repair only unexecuted malformed responses',async()=>{
 for(const purpose of ['actor','analysis']){
  const requests=[],messages=[{role:'system',content:'Keep original scope.'},{role:'user',content:'Read nine records without changing them.'}];
  const service={recoveryOptions:{model:{minTimeout:1,maxTimeout:1}},providers:{status:()=>({model:'fixture'}),complete:async wire=>{requests.push(structuredClone(wire));if(requests.length===1)throw Error('response_invalid');return {content:'Done',calls:[]};}}};
  await modelTransport(service,{signal:new AbortController().signal})(messages,tools,undefined,purpose);
  assert.match(JSON.stringify(requests[0]),/at most 8 tool calls/);assert.match(JSON.stringify(requests[1]),/No tool from the rejected response was executed/);
  assert.deepEqual(requests[0][1],messages[1],'structured planner payload stays in its original position');
  assert.equal(requests[1].filter(m=>m.content.includes('at most 8 tool calls')).length,1);
  assert.deepEqual(messages,[{role:'system',content:'Keep original scope.'},{role:'user',content:'Read nine records without changing them.'}]);
 }
});
