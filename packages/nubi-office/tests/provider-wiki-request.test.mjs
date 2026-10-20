import test from 'node:test';
import assert from 'node:assert/strict';
import {createProviders} from '../worker/providers.mjs';
const tools=[{type:'function',function:{name:'read_file',description:'Read a synthetic source',parameters:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}}}];
const calls=count=>Array.from({length:count},(_,i)=>({id:'call-'+i,type:'function',function:{name:'read_file',arguments:JSON.stringify({path:'source-'+i+'.txt'})}}));
async function connected(t){
 const requests=[],p=createProviders({startLogin:async()=>({result:Promise.resolve({token:'synthetic-only',models:[{id:'model-a',label:'A',contextLength:131072,maxOutputTokens:4096},{id:'model-b',label:'B',contextLength:131072,maxOutputTokens:24000}]}),cancel(){}}),fetchImpl:async(url,init)=>{const body=JSON.parse(init.body);requests.push({url,body});return Response.json({choices:[{message:body.model==='model-b'?{content:null,tool_calls:calls(9)}:{content:'done'},finish_reason:body.model==='model-b'?'tool_calls':'stop'}]});}});
 await p.login('aipro');await new Promise(r=>setImmediate(r));p.model('model-a');p.reasoning('low');t.after(()=>p.dispose());
 const connectionId=p.status().providers.find(p=>p.id==='aipro').connectionId;
 return {p,requests,options:{purpose:'wiki',provider:'aipro',model:'model-b',connectionId,effort:'auto',maxToolCalls:16,maxTokens:16384}};
}
const complete=(p,options)=>p.complete([{role:'user',content:'Read synthetic source files'}],tools,new AbortController().signal,()=>{},()=>{},()=>{},options);
test('wiki request selects a bound catalog model with 16 calls and a larger output, preserving the interactive selection',async t=>{
 const {p,requests,options}=await connected(t);const result=await complete(p,options);
 assert.equal(requests[0].body.model,'model-b');assert.equal(requests[0].body.max_tokens,16384);assert.equal(requests[0].body.reasoning_effort,'low');assert.equal(result.calls.length,9);
 assert.equal(p.status().model,'model-a');assert.equal(p.status().reasoningEffort,'low');
 await complete(p,{});assert.equal(requests[1].body.model,'model-a');assert.equal(requests[1].body.max_tokens,4096);assert.equal(requests[1].body.reasoning_effort,'low');
});
test('unknown model, stale connection, unsupported effort and unauthorized call expansion are rejected before sending',async t=>{
 const {p,requests,options}=await connected(t);
 for(const change of [{model:'missing'},{connectionId:999999},{effort:'high'},{maxToolCalls:17},{maxToolCalls:0},{purpose:'actor'}])await assert.rejects(complete(p,{...options,...change}));
 assert.equal(requests.length,0);
});
test('wiki request limited to eight refuses a ninth call without changing the interactive model',async t=>{
 const {p,requests,options}=await connected(t);
 await assert.rejects(complete(p,{...options,maxToolCalls:8}),/response_invalid/);assert.equal(requests.length,1);
 assert.equal(p.status().model,'model-a');
});

test('wiki ChatGPT effort follows the chosen model catalog even when legacy host reasoning defaults are broader',async t=>{
 const requests=[],p=createProviders({chatGPTLogin:async()=>({result:Promise.resolve({token:'synthetic',expiresAt:Date.now()+3600000}),cancel(){}}),chatGPTModels:()=>({payload:{modelList:[{name:'verified-low',supported_reasoning_levels:['low']},{name:'verified-high',supported_reasoning_levels:['low','high']}]}}),completeChatGPT:async options=>{requests.push(options);return {content:'done',calls:[],finishReason:'stop'};}});t.after(()=>p.dispose());await p.login('chatgpt');await new Promise(r=>setImmediate(r));p.model('verified-low');p.reasoning('low');const connectionId=p.status().providers.find(x=>x.id==='chatgpt').connectionId;
 const options={purpose:'wiki',provider:'chatgpt',model:'verified-low',connectionId,effort:'high',maxToolCalls:8};await assert.rejects(complete(p,options),/invalid_reasoning_effort/);assert.equal(requests.length,0);
 await complete(p,{...options,model:'verified-high',effort:'auto'});assert.equal(requests[0].reasoningEffort,'high');assert.equal(p.status().model,'verified-low');assert.equal(p.status().reasoningEffort,'low');
});

test('parallel wiki and interactive requests keep independent effort and never restore over a newer user choice',async t=>{
 let release,started;const ready=new Promise(r=>{started=r;}),held=new Promise(r=>{release=r;}),bodies=[];
 const p=createProviders({startLogin:async()=>({result:Promise.resolve({token:'synthetic',models:[{id:'model-a'},{id:'model-b'}]}),cancel(){}}),fetchImpl:async(_,init)=>{const body=JSON.parse(init.body);bodies.push(body);if(body.model==='model-b'){started();await held;}return Response.json({choices:[{message:{content:'done'},finish_reason:'stop'}]});}});t.after(()=>p.dispose());await p.login('aipro');await new Promise(r=>setImmediate(r));p.model('model-a');p.reasoning('low');const connectionId=p.status().providers.find(x=>x.id==='aipro').connectionId;
 const pending=complete(p,{purpose:'wiki',provider:'aipro',model:'model-b',connectionId,effort:'medium',maxToolCalls:8});await ready;p.reasoning('xhigh');await complete(p,{});release();await pending;
 assert.equal(bodies[0].reasoning_effort,'medium');assert.equal(bodies[1].model,'model-a');assert.equal(bodies[1].reasoning_effort,undefined);assert.equal(p.status().model,'model-a');assert.equal(p.status().reasoningEffort,'xhigh');
});
test('a delayed wiki response from a disconnected login is refused after the same model reconnects',async t=>{
 let release,started;const ready=new Promise(r=>{started=r;}),held=new Promise(r=>{release=r;});
 const p=createProviders({startLogin:async()=>({result:Promise.resolve({token:'synthetic',models:[{id:'model-a'}]}),cancel(){}}),fetchImpl:async()=>{started();await held;return Response.json({choices:[{message:{content:'stale response'},finish_reason:'stop'}]});}});t.after(()=>p.dispose());await p.login('aipro');await new Promise(r=>setImmediate(r));const connectionId=p.status().providers.find(x=>x.id==='aipro').connectionId;
 const pending=complete(p,{purpose:'wiki',provider:'aipro',model:'model-a',connectionId,effort:'auto'});await ready;p.disconnect('aipro');await p.login('aipro');await new Promise(r=>setImmediate(r));release();await assert.rejects(pending,/provider_changed/);assert.equal(p.status().verified,false);
});
test('identical model IDs in another provider use that login without changing the active provider',async t=>{
 const {p,requests}=await connected(t);await p.connect({provider:'compatible',baseUrl:'https://synthetic.invalid/v1',token:'synthetic-other',model:'model-b'});p.select('aipro');const connectionId=p.status().providers.find(x=>x.id==='compatible').connectionId;
 await complete(p,{purpose:'wiki',provider:'compatible',model:'model-b',connectionId,effort:'auto',maxToolCalls:16});assert.equal(requests[0].url,'https://synthetic.invalid/v1/chat/completions');assert.equal(p.status().provider,'aipro');assert.equal(p.status().model,'model-a');
});


test('wiki ChatGPT exposes and reports server output default without forwarding a wished cap',async t=>{
 const requests=[],p=createProviders({chatGPTLogin:async()=>({result:Promise.resolve({token:'synthetic',expiresAt:Date.now()+3600000}),cancel(){}}),chatGPTModels:()=>({payload:{modelList:[{name:'synthetic-chat',supported_reasoning_levels:['low','high']}]}}),completeChatGPT:async options=>{requests.push(options);return {content:'done',calls:[],finishReason:'stop'};}});t.after(()=>p.dispose());await p.login('chatgpt');await new Promise(r=>setImmediate(r));
 const catalog=p.wikiModels().find(c=>c.provider==='chatgpt'),options={purpose:'wiki',provider:'chatgpt',model:'synthetic-chat',connectionId:catalog.connectionId,effort:'auto',maxToolCalls:16,maxTokens:16384};
 assert.equal(catalog.models[0].pageOutputConfigurable,false);
 const resolved=p.wikiRequest(options);assert.equal(resolved.maxTokens,null);assert.equal(p.wikiRequest(resolved).maxTokens,null);
 const result=await complete(p,options);assert.equal(result.requestOptions.maxTokens,null);assert.equal(Object.hasOwn(requests[0],'maxTokens'),false);assert.equal(requests[0].maxToolCalls,16);assert.equal(requests[0].reasoningEffort,'high');
});


test('wiki ChatGPT actual SDK wire and applied metadata both retain the server output default',async t=>{
 const {chatgptToken,responsesSSE}=await import('../../../extensions/aipro-chat/tests/fixtures/chatgpt.mjs'),{zstdDecompressSync}=await import('node:zlib');let wire;
 const p=createProviders({chatGPTLogin:async()=>({result:Promise.resolve({token:chatgptToken(),expiresAt:Date.now()+3600000}),cancel(){}}),fetchImpl:async(_,request)=>{wire=JSON.parse(typeof request.body==='string'?request.body:zstdDecompressSync(request.body).toString());return new Response(responsesSSE(),{headers:{'content-type':'text/event-stream'}});}});t.after(()=>p.dispose());await p.login('chatgpt');await new Promise(r=>setImmediate(r));const catalog=p.wikiModels().find(c=>c.provider==='chatgpt');const model=catalog.models.find(m=>m.id==='gpt-5.6-sol')||catalog.models[0];
 const result=await complete(p,{purpose:'wiki',provider:'chatgpt',model:model.id,connectionId:catalog.connectionId,effort:'auto',maxToolCalls:16,maxTokens:16384});
 assert.equal(Object.hasOwn(wire,'max_output_tokens'),false);assert.equal(result.requestOptions.maxTokens,null);assert.equal(result.requestOptions.maxToolCalls,16);assert.equal(result.content,'ChatGPT 합성 응답입니다.');
});
