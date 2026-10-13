import {test} from 'node:test';import assert from 'node:assert/strict';
import {openAIChatToMessages,completionToOpenAI,startOpenAIShim} from '../eval/openai-shim.mjs';
test('OpenAI chat requests map onto the relay transport and back',()=>{
  const {messages,tools,options}=openAIChatToMessages({messages:[{role:'developer',content:'be brief'},{role:'user',content:[{type:'text',text:'hi'},{type:'image_url',image_url:{url:'x'}}]}],tools:[{type:'function',function:{name:'f',parameters:{}}},{type:'other'}],tool_choice:'required',response_format:{type:'json_schema'},max_tokens:300});
  assert.deepEqual(messages,[{role:'system',content:'be brief'},{role:'user',content:'hi\n'}]);assert.equal(tools.length,1);assert.deepEqual(options,{toolChoice:'required',responseFormat:{type:'json_object'},maxTokens:300});
  assert.throws(()=>openAIChatToMessages({messages:[]}),/messages required/);
  const reply=completionToOpenAI({content:'',calls:[{id:'c1',function:{name:'f',arguments:'{}'}}],usage:{prompt_tokens:3,completion_tokens:2,total_tokens:5}},'m','abc');
  assert.equal(reply.choices[0].finish_reason,'tool_calls');assert.equal(reply.choices[0].message.content,null);assert.equal(reply.usage.total_tokens,5);assert.equal(reply.id,'chatcmpl-abc');
  assert.equal(completionToOpenAI({content:'ok',finishReason:'length'},'m').choices[0].finish_reason,'length');
});
test('the loopback server needs the token, serves models and completions, and streams one final chunk',async t=>{
  const seen=[];const providers={status:()=>({provider:'aipro',model:'fixture-model'}),complete:async(messages,tools,signal,a,b,c,options)=>{seen.push({messages,tools,options});return {content:'답',usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}};}};
  const shim=await startOpenAIShim({providers,port:0});t.after(()=>shim.close());
  const call=(path,init={})=>fetch(shim.baseUrl+path,{...init,headers:{'content-type':'application/json',...(init.headers||{})}});
  assert.equal((await call('/models')).status,401);
  const auth={authorization:'Bearer '+shim.token};
  assert.deepEqual((await (await call('/models',{headers:auth})).json()).data[0].id,'fixture-model');
  const reply=await (await call('/chat/completions',{method:'POST',headers:auth,body:JSON.stringify({model:'x',messages:[{role:'user',content:'질문'}],response_format:{type:'json_object'}})})).json();
  assert.equal(reply.choices[0].message.content,'답');assert.deepEqual(seen[0].options,{responseFormat:{type:'json_object'}});assert.equal(reply.model,'x');
  const stream=await call('/chat/completions',{method:'POST',headers:auth,body:JSON.stringify({messages:[{role:'user',content:'질문'}],stream:true})});
  assert.match(stream.headers.get('content-type'),/text\/event-stream/);const text=await stream.text();assert.match(text,/"delta":\{"role":"assistant","content":"답"\}/);assert.match(text,/\[DONE\]/);
  assert.equal((await call('/embeddings',{method:'POST',headers:auth,body:'{}'})).status,404);
  assert.equal((await call('/chat/completions',{method:'POST',headers:auth,body:'{bad'})).status,400);
});
