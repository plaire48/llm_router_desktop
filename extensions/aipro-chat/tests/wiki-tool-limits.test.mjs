import test from 'node:test';
import assert from 'node:assert/strict';
import {readCompletion} from '../completion-reader.js';
import {fabrixToolMessage,fabrixRequest} from '../fabrix.js';
import {completeChatGPT} from '../chatgpt-api.js';
import {chatgptToken} from './fixtures/chatgpt.mjs';
const tools=[{type:'function',function:{name:'read_file',description:'Read a source',parameters:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}}}];
const calls=n=>Array.from({length:n},(_,i)=>({id:'call-'+i,type:'function',function:{name:'read_file',arguments:JSON.stringify({path:'src-'+i})}}));
const wiki={purpose:'wiki',maxToolCalls:16};
async function read(items,options){let observed;await readCompletion(Response.json({choices:[{message:{content:null,tool_calls:items},finish_reason:'tool_calls'}]}),undefined,undefined,undefined,undefined,value=>{observed=value;},undefined,undefined,options);return observed;}
test('completion reader accepts up to sixteen wiki calls while default remains eight',async()=>{
 await assert.rejects(read(calls(9)),/response_invalid/);assert.equal((await read(calls(16),wiki)).length,16);await assert.rejects(read(calls(17),wiki),/response_invalid/);await assert.rejects(read(calls(9),{purpose:'actor',maxToolCalls:16}),/response_invalid/);
});
test('expanded wiki reader still rejects duplicate ids and oversized arguments',async()=>{
 const duplicate=calls(9);duplicate[8].id=duplicate[0].id;await assert.rejects(read(duplicate,wiki),/response_invalid/);
 const large=calls(9);large[8].function.arguments='x'.repeat(32001);await assert.rejects(read(large,wiki),/response_invalid/);
});
const envelope=n=>JSON.stringify({protocol:'aipro-fabrix-tools-v1',request_id:'synthetic-request',type:'tool_calls',tool_calls:Array.from({length:n},()=>({name:'read_file',arguments:{path:'source'}}))});
test('FabriX request and envelope share the wiki sixteen-call contract without broadening ordinary requests',()=>{
 assert.throws(()=>fabrixToolMessage(envelope(9),'synthetic-request',tools));
 assert.equal(fabrixToolMessage(envelope(16),'synthetic-request',tools,wiki).tool_calls.length,16);
 assert.throws(()=>fabrixToolMessage(envelope(17),'synthetic-request',tools,wiki));
 const payload=fabrixRequest({model:'model',messages:[{role:'user',content:'Read sources'}],tools},{modelId:'model'},'synthetic-request',undefined,wiki);
 assert.match(JSON.stringify(payload),/at most 16 calls/);
});
function multiSSE(n){
 const output=calls(n).map((call,i)=>({type:'function_call',id:'fc-'+i,call_id:call.id,name:'read_file',arguments:call.function.arguments,status:'completed'}));
 const events=[{type:'response.created',response:{id:'resp-wiki'}}];
 output.forEach((item,i)=>events.push({type:'response.output_item.added',output_index:i,item:{...item,arguments:''}},{type:'response.function_call_arguments.delta',output_index:i,delta:item.arguments},{type:'response.output_item.done',output_index:i,item}));
 events.push({type:'response.completed',response:{id:'resp-wiki',status:'completed',output,usage:{input_tokens:20,output_tokens:20}}});
 return events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join('');
}
test('ChatGPT SDK route permits sixteen only for a wiki request',async()=>{
 const options={messages:[{role:'user',content:'Read sources'}],tools,modelId:'gpt-5.6-sol',credential:{token:chatgptToken()},signal:new AbortController().signal,onText:()=>{},onPhase:()=>{},fetchImpl:async()=>new Response(multiSSE(9),{headers:{'content-type':'text/event-stream'}})};
 await assert.rejects(completeChatGPT(options),/response_invalid/);
 assert.equal((await completeChatGPT({...options,...wiki})).calls.length,9);
 await assert.rejects(completeChatGPT({...options,purpose:'actor',maxToolCalls:16}),/response_invalid/);
});
