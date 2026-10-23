import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopProviders} from '../runtime/desktop-providers.mjs';

const qwen='QWEN3.8-27B-FP8-256K',glm='GLM-5.2-NVFP4';
const messages=[{role:'user',content:'안녕'}];
const tools=[{type:'function',function:{name:'read_source',parameters:{type:'object',properties:{},additionalProperties:false}}}];
const answer=()=>Response.json({choices:[{message:{content:'안녕하세요.'},finish_reason:'stop'}]});
async function connected(t,{models=[{id:qwen,contextLength:262144},{id:glm,contextLength:524288}],respond=answer}={}){
  const requests=[],p=createDesktopProviders({startLogin:async()=>({result:Promise.resolve({token:'synthetic-token',models}),cancel(){}}),fetchImpl:async(url,init)=>{
    const body=JSON.parse(init.body);requests.push({url,headers:init.headers,body});return respond(body,requests.length);
  }});
  t.after(()=>p.dispose());await p.login('aipro');await new Promise(resolve=>setImmediate(resolve));
  return {p,requests};
}
const complete=(p,options={},requestTools=tools)=>p.complete(messages,requestTools,new AbortController().signal,()=>{},()=>{},()=>{},options);

test('Desktop Qwen and GLM send the supplied AI Pro request options',async t=>{
  for(const [model,effort,template] of [[qwen,'medium',{reasoning_effort:'medium'}],[glm,'high',{enable_thinking:true,clear_thinking:true,reasoning_effort:'high'}]]){
    await t.test(model,async t=>{
      const {p,requests}=await connected(t);await p.model(model);
      assert.equal(p.status().reasoningEffort,effort);
      await complete(p);
      assert.deepEqual(requests[0].body,{model,max_tokens:24576,chat_template_kwargs:template,...(model===glm?{separate_reasoning:true}:{}),messages,tools,tool_choice:'auto',stream:true,stream_options:{include_usage:true}});
      assert.equal(requests[0].url,'https://aipro.sdsdev.co.kr/api/v1/chat/completions');
      assert.equal(requests[0].headers.Authorization,'Bearer synthetic-token');
    });
  }
});

test('selected effort, summary cap and tool-free requests keep the model-specific envelope',async t=>{
  const {p,requests}=await connected(t);await p.model(qwen);await p.reasoning('medium');
  await complete(p,{maxTokens:2048},[]);await complete(p);
  assert.deepEqual(requests.map(request=>request.body.max_tokens),[2048,24576]);
  for(const {body} of requests){assert.deepEqual(body.chat_template_kwargs,{reasoning_effort:'medium'});assert.equal('reasoning_effort' in body,false);assert.equal('separate_reasoning' in body,false);}
  assert.equal('tools' in requests[0].body,false);assert.equal('tool_choice' in requests[0].body,false);
  await p.model(glm);await p.reasoning('max');await complete(p);
  assert.deepEqual(requests.at(-1).body.chat_template_kwargs,{enable_thinking:true,clear_thinking:true,reasoning_effort:'max'});
});

test('catalog and context ceilings still bound the output allowance',async t=>{
  for(const [metadata,expected] of [[{maxOutputTokens:8192},8192],[{maxOutputTokens:32768},24576],[{contextLength:64000},9600]]){
    const {p,requests}=await connected(t,{models:[{id:qwen,...metadata}]});await complete(p,{maxTokens:999999});assert.equal(requests[0].body.max_tokens,expected);
  }
});

test('wiki and background model requests use the target model envelope without changing the conversation',async t=>{
  const {p,requests}=await connected(t);await p.model(qwen);await p.reasoning('high');
  const connectionId=p.status().providers.find(provider=>provider.id==='aipro').connectionId;
  await complete(p,{purpose:'wiki',provider:'aipro',model:glm,connectionId,effort:'high',maxTokens:24576,maxToolCalls:8});
  await complete(p,{backgroundModel:{provider:'aipro',model:glm}},[]);await complete(p);
  for(const {body} of requests.slice(0,2)){assert.equal(body.model,glm);assert.deepEqual(body.chat_template_kwargs,{enable_thinking:true,clear_thinking:true,reasoning_effort:'high'});assert.equal(body.separate_reasoning,true);assert.equal(body.max_tokens,24576);}
  assert.equal(requests[2].body.model,qwen);assert.deepEqual(requests[2].body.chat_template_kwargs,{reasoning_effort:'high'});assert.equal('separate_reasoning' in requests[2].body,false);
  assert.equal(p.status().model,qwen);assert.equal(p.status().reasoningEffort,'high');
});

test('manual providers using the same model IDs do not receive AI Pro template options',async t=>{
  const {p,requests}=await connected(t);
  for(const provider of ['compatible','aipro-cli']){
    await p.connect({provider,baseUrl:'https://synthetic.invalid/v1',token:'synthetic-manual',model:glm});await complete(p);
    const body=requests.at(-1).body;assert.equal('chat_template_kwargs' in body,false);assert.equal('separate_reasoning' in body,false);assert.equal(body.max_tokens,16384);
  }
});

test('GLM separated reasoning stays out of the answer while trailing usage is retained',async t=>{
  const chunks=[{choices:[{index:0,delta:{role:'assistant',reasoning_content:'synthetic private reasoning'},finish_reason:null}]},{choices:[{index:0,delta:{content:'안녕하세요.'},finish_reason:'stop'}]},{choices:[],usage:{prompt_tokens:15,completion_tokens:9,total_tokens:24,completion_tokens_details:{reasoning_tokens:5}}}];
  const {p}=await connected(t,{models:[{id:glm}],respond:()=>new Response(chunks.map(chunk=>`data: ${JSON.stringify(chunk)}\n\n`).join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}})});
  const reasoning=[],result=await complete(p,{onReasoning:value=>reasoning.push(value)});
  assert.equal(result.content,'안녕하세요.');assert.deepEqual(reasoning,['synthetic private reasoning']);assert.equal(result.usage.total_tokens,24);assert.equal(result.usage.completion_tokens_details.reasoning_tokens,5);
});
