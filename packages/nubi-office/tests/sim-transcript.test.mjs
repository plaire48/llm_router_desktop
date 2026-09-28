import test from 'node:test';
import assert from 'node:assert/strict';
import {recordingProviders,summarize,modelRole} from '../eval/sim/transcript.mjs';

const tools=[{type:'function',function:{name:'read_selection',parameters:{type:'object',properties:{}}}},{type:'function',function:{name:'apply_changes',parameters:{type:'object',properties:{}}}}];
const call=(name,args={})=>({id:'c1',type:'function',function:{name,arguments:JSON.stringify(args)}});
function provider(reply){
  return{status:()=>({provider:'chatgpt',model:'fixture-model',connected:true}),secret:{token:'never-recorded'},complete:async(messages,requested,signal,onText)=>{onText?.('부분');return typeof reply==='function'?reply(messages,requested):reply;}};
}

test('the role comes from the system prompt prefix',()=>{
  const role=content=>modelRole([{role:'system',content}]);
  assert.deepEqual(['NUBI_TASK_PLANNER. Understand','NUBI_ACTION_REVIEWER. x','NUBI_STEP_REVIEWER. x','NUBI_RESULT_REVIEWER. x','NUBI_RECOVERY_PLANNER. x','You are Nubi for Excel 2016.','NUBI_EXCEL_ANALYST x','Summarize'].map(role),
    ['planner','action_review','step_review','result_review','recovery','actor','excel_analyst','other']);
  assert.equal(modelRole([{role:'user',content:'x'}]),'other');
});
test('a successful call records its role, tools, size, timing and response',async()=>{
  const entries=[],providers=recordingProviders(provider({content:'',calls:[call('apply_changes',{plan:'{}'})],finishReason:'tool_calls',usage:{input:10,output:2}}),entry=>entries.push(entry));
  const messages=[{role:'system',content:'You are Nubi for Excel 2016.'},{role:'user',content:'A1을 42로'}];let streamed='';
  const result=await providers.complete(messages,tools,new AbortController().signal,text=>{streamed+=text;});
  assert.equal(result.calls[0].function.name,'apply_changes');assert.equal(streamed,'부분');assert.equal(entries.length,1);
  const [entry]=entries;
  assert.deepEqual([entry.sequence,entry.role,entry.model,entry.request.toolNames,entry.request.characters],[1,'actor','fixture-model',['read_selection','apply_changes'],JSON.stringify(messages).length+JSON.stringify(tools).length]);
  assert.deepEqual(entry.request.messages,messages);assert.deepEqual(entry.response,{content:'',calls:[{name:'apply_changes',arguments:'{"plan":"{}"}'}],finishReason:'tool_calls',usage:{input:10,output:2}});
  assert.ok(Number.isFinite(entry.elapsedMs)&&entry.elapsedMs>=0);assert.match(entry.startedAt,/^\d{4}-\d{2}-\d{2}T/);assert.equal(entry.error,undefined);
});
test('a failed call records the safe error facts and rethrows the original error',async()=>{
  const failure=Object.assign(new Error('rate_limited'),{status:429,retryAfterMs:1500,body:'server said: secret'});
  const entries=[],providers=recordingProviders(provider(()=>{throw failure;}),entry=>entries.push(entry));
  await assert.rejects(providers.complete([{role:'system',content:'NUBI_TASK_PLANNER.'}],[],new AbortController().signal),error=>error===failure);
  assert.deepEqual(entries[0].error,{code:'rate_limited',status:429,retryAfterMs:1500});assert.equal(entries[0].response,undefined);assert.equal(entries[0].role,'planner');
});
test('nothing from the provider object other than status reaches the record',async()=>{
  const entries=[],providers=recordingProviders(provider({content:'ok',calls:[],finishReason:'stop'}),entry=>entries.push(entry));
  await providers.complete([{role:'user',content:'x'}],[],new AbortController().signal);
  assert.doesNotMatch(JSON.stringify(entries),/never-recorded|token|credential|authorization/i);
  assert.equal(providers.status().model,'fixture-model');
});
test('a record sink failure never breaks the model call',async()=>{
  const providers=recordingProviders(provider({content:'ok',calls:[],finishReason:'stop'}),()=>{throw new Error('disk full');});
  assert.equal((await providers.complete([{role:'user',content:'x'}],[],new AbortController().signal)).content,'ok');
});
test('the summary counts calls by role, tool and error',()=>{
  const entry=(role,extra)=>({sequence:1,role,elapsedMs:100,request:{characters:50,toolNames:[]},...extra});
  const summary=summarize([entry('planner',{response:{calls:[]}}),entry('actor',{response:{calls:[{name:'read_selection'}]}}),entry('actor',{response:{calls:[{name:'apply_changes'}]}}),entry('actor',{response:{calls:[{name:'apply_changes'}]}}),entry('result_review',{error:{code:'rate_limited',status:429}})]);
  assert.deepEqual(summary,{modelCalls:5,byRole:{planner:1,actor:3,result_review:1},elapsedMs:500,requestCharacters:250,peakRequestCharacters:50,toolCalls:{read_selection:1,apply_changes:2},errors:{rate_limited:1}});
});
