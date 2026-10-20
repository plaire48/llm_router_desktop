import test from 'node:test';
import assert from 'node:assert/strict';
import {createProviders, manualConnection, PROVIDERS} from '../worker/providers.mjs';
import {PROVIDER_LABELS} from '../../../extensions/aipro-chat/core.js';
import {createWorker} from '../worker/main.mjs';
import {readFile} from 'node:fs/promises';
import {fetchModels} from '../worker/aipro-auth.mjs';

test('every current Nubi provider appears in Office',()=>{for(const id of Object.keys(PROVIDER_LABELS)) assert.equal(PROVIDERS[id],PROVIDER_LABELS[id]);});
test('manual endpoint accepts local gateways and rejects credential-bearing URLs',()=>{
  assert.equal(manualConnection({baseUrl:'http://127.0.0.1:8787/v1',token:'secret',model:'my-model'}).endpoint,'http://127.0.0.1:8787/v1/chat/completions');
  for(const baseUrl of ['http://external.example/v1','https://user:pass@example.test','https://example.test/?key=a']) assert.throws(()=>manualConnection({baseUrl,token:'secret',model:'m'}));
});
test('manual models use exact IDs, CLI alone adds AIPROCLI, tokens stay out of status',async()=>{
  const calls=[]; const p=createProviders({fetchImpl:async(url,options)=>{calls.push({url,...options}); return Response.json({choices:[{message:{content:'done'},finish_reason:'stop'}]});}});
  for(const provider of ['aipro-cli','compatible']) {
    await p.connect({provider,baseUrl:'https://llm.example/v1',token:'sensitive',model:'custom/model'});
    const result=await p.complete([{role:'user',content:'hi'}],[],new AbortController().signal,()=>{},()=>{});
    assert.equal(result.content,'done');assert.equal(JSON.parse(calls.at(-1).body).model,'custom/model');
    assert.equal(calls.at(-1).headers['User-Agent'],provider==='aipro-cli'?'AIPROCLI':undefined);
    assert.ok(!JSON.stringify(p.status()).includes('sensitive'));assert.equal(p.status().verified,true);
  }
  p.dispose();
});
test('AI Pro uses its own SSO catalog and bearer endpoint',async()=>{
  let request;const p=createProviders({startLogin:async()=>({result:Promise.resolve({token:'private-token',models:[{id:'aipro-model',label:'AI Pro model'}]}),cancel(){}}),fetchImpl:async(url,opts)=>{request={url,...opts};return Response.json({choices:[{message:{content:'ok'},finish_reason:'stop'}]});}});
  await p.login('aipro');await new Promise(r=>setImmediate(r));await p.complete([],[],new AbortController().signal,()=>{},()=>{});
  assert.equal(request.url,'https://aipro.sdsdev.co.kr/api/v1/chat/completions');assert.equal(request.headers.Authorization,'Bearer private-token');assert.equal(p.status().models[0].id,'aipro-model');p.dispose();
});
test('saved AI Pro catalog preserves eight visible original IDs while hiding the two administrator entries',async()=>{
  const payload=JSON.parse(await readFile(new URL('../../../extensions/aipro-chat/tests/fixtures/aipro-models.json',import.meta.url),'utf8'));
  const token='eyJhbGciOiJSUzI1NiJ9.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+300})).toString('base64url')+'.signature';
  const sent=[];let modelRequests=0;
  const fetchImpl=async(url,options)=>{
    assert.equal(options.headers.Authorization,`Bearer ${token}`);
    if(url==='https://aipro.sdsdev.co.kr/api/models'){modelRequests++;assert.deepEqual(options.headers,{Accept:'application/json',Authorization:`Bearer ${token}`,'X-REASONING':'true'},'model discovery sends exactly the browser client headers');return Response.json(payload);}
    assert.equal(url,'https://aipro.sdsdev.co.kr/api/v1/chat/completions');
    assert.deepEqual(options.headers,{'Content-Type':'application/json',Accept:'text/event-stream',Authorization:`Bearer ${token}`},'chat sends exactly the browser client headers');sent.push(JSON.parse(options.body).model);
    return Response.json({choices:[{message:{content:'ok'},finish_reason:'stop'}]});
  };
  const p=createProviders({fetchImpl,startLogin:async()=>({result:fetchModels(token,fetchImpl).then(models=>({token,models})),cancel(){}})});
  await p.login('aipro');for(let i=0;i<30&&p.status().pending;i++)await new Promise(resolve=>setImmediate(resolve));
  const names=['GPT-OSS-128K_general','glm-5.2','QWEN3.8-27B-FP8-256K','QWEN3-CODER-128K_general','GLM-5.2-NVFP4','qwen3.8-27b','GPT-OSS-120B-128K','gpt-oss-120b'];
  assert.equal(payload.modelList.length,10);assert.throws(()=>p.model('QWEN3-CODER-480B-A35B-INSTRUCT-FP8-128K_rag'),/invalid_model/);assert.throws(()=>p.model('aipro-fast-model'),/invalid_model/);
  assert.equal(modelRequests,1);assert.equal(names.length,8);assert.deepEqual(p.status().models.map(model=>model.id),names);
  for(const name of names){p.model(name);await p.complete([],[],new AbortController().signal,()=>{},()=>{});}
  assert.deepEqual(sent,names);assert.equal(p.status().provider,'aipro');assert.ok(!JSON.stringify(p.status()).includes(token));p.dispose();
  const varied={modelList:payload.modelList.map((model,index)=>({...model,is_agent:index%2===0,target:index%2===0?'agent':model.target}))};
  assert.deepEqual((await fetchModels(token,async()=>Response.json(varied))).map(model=>model.id),names);
});
test('ChatGPT uses the Nubi catalog, refresh and Responses adapter',async()=>{
  let refresh=0,complete=0;const p=createProviders({chatGPTLogin:async()=>({result:Promise.resolve({token:'old',expiresAt:1}),cancel(){}}),chatGPTModels:()=>({payload:{modelList:[{name:'gpt-test',display_name:'GPT Test'}]}}),refreshChatGPTToken:async()=>{refresh++;return{credential:{token:'new',expiresAt:Date.now()+3600000}};},completeChatGPT:async input=>{complete++;assert.equal(input.credential.token,'new');assert.equal(input.modelId,'gpt-test');return{content:'done',calls:[],finishReason:'stop'};}});
  await p.login('chatgpt');await new Promise(r=>setImmediate(r));await p.complete([],[],new AbortController().signal,()=>{},()=>{});assert.equal(refresh,1);assert.equal(complete,1);p.dispose();
});
test('catalog refresh preserves the selected API model and retains the last good catalog on failure',async()=>{
  const token='eyJhbGciOiJSUzI1NiJ9.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+300})).toString('base64url')+'.signature';
  let fail=false;
  const p=createProviders({startLogin:async()=>({result:Promise.resolve({token,models:[{id:'old',label:'Old'},{id:'selected',label:'Selected'}]}),cancel(){}}),fetchImpl:async(url,options)=>{
    assert.equal(url,'https://aipro.sdsdev.co.kr/api/models');assert.equal(options.headers.Authorization,`Bearer ${token}`);
    if(fail)throw new Error('network_failed');return Response.json({modelList:[{name:'new',display_name:'New'},{name:'selected',display_name:'Selected'}]});
  }});
  await p.login('aipro');await new Promise(resolve=>setImmediate(resolve));p.model('selected');
  await p.refreshModels();assert.equal(p.status().model,'selected');assert.deepEqual(p.status().models.map(model=>model.id),['new','selected']);
  fail=true;await assert.rejects(p.refreshModels());assert.equal(p.status().model,'selected');assert.equal(p.status().models.length,2);p.dispose();
});
test('manual catalog refresh never discovers other providers or exposes credentials',async()=>{
  const p=createProviders({fetchImpl:async()=>{throw new Error('Manual refresh must not call a catalog API');}}),worker=createWorker(p);
  await worker.dispatch('connect',{provider:'aipro-cli',baseUrl:'https://example.test/v1',token:'private-token',model:'manual-model'});
  const status=await worker.dispatch('refreshModels');assert.equal(status.model,'manual-model');assert.ok(!JSON.stringify(status).includes('private-token'));worker.dispose();
});
test('FabriX keeps service model IDs and the existing protocol adapter',async()=>{
  let selected;const p=createProviders({fabrixModels:async()=>({payload:{modelList:[{name:'uuid-model',display_name:'Readable Model'}]}}),fabrixCompletion:async(body,credential)=>{selected={body,credential};return Response.json({choices:[{message:{content:'ok'},finish_reason:'stop'}]});}});
  await p.connect({provider:'fabrix',endpoint:'https://fabrix.example/openapi',clientKey:'client',token:'token'});
  assert.equal(p.status().models[0].label,'Readable Model');await p.complete([],[],new AbortController().signal,()=>{},()=>{});assert.equal(selected.body.model,'uuid-model');assert.equal(selected.credential.modelId,'uuid-model');p.dispose();
});
test('cancelled login cannot reconnect after a late successful response',async()=>{
  let resolve;const result=new Promise(r=>{resolve=r;});const p=createProviders({startLogin:async()=>({result,cancel(){}})});await p.login('aipro');p.cancelLogin();resolve({token:'late',models:[{id:'m'}]});await new Promise(r=>setImmediate(r));assert.equal(p.status().connected,false);p.dispose();
});
test('worker rejects unknown methods',async()=>{const worker=createWorker();await assert.rejects(worker.dispatch('executeVba'),/unknown_method/);worker.dispose();});

test('five received models expose four visible choices, and refresh records ten received with eight visible IDs',async()=>{
  const {fetchModelCatalog}=await import('../worker/aipro-auth.mjs');
  const payload=JSON.parse(await readFile(new URL('../../../extensions/aipro-chat/tests/fixtures/aipro-models.json',import.meta.url),'utf8'));
  const ids=['glm-5.2','QWEN3-CODER-480B-A35B-INSTRUCT-FP8-128K_rag','QWEN3-CODER-128K_general','qwen3.8-27b','gpt-oss-120b'];
  const token='eyJhbGciOiJSUzI1NiJ9.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+300})).toString('base64url')+'.signature';
  let full=false;
  const fetchImpl=async(url,options)=>{assert.equal(options.cache,'no-store');return Response.json({modelList:full?payload.modelList:payload.modelList.filter(item=>ids.includes(item.name))});};
  const p=createProviders({fetchImpl,startLogin:async()=>({result:fetchModelCatalog(token,fetchImpl).then(catalog=>({token,...catalog})),cancel(){}})});
  await p.login('aipro');for(let i=0;i<30&&p.status().pending;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(p.status().modelCatalog.diagnostics.summary.received,5);assert.equal(p.status().models.length,4);assert.equal(p.status().modelCatalog.diagnostics.summary.excluded.hidden,1);
  assert.ok(!p.status().models.some(item=>item.id==='aipro-fast-model'));
  p.model('glm-5.2');full=true;await p.refreshModels();assert.equal(p.status().model,'glm-5.2');assert.equal(p.status().modelCatalog.diagnostics.summary.received,10);
  assert.equal(p.status().models.length,8);assert.equal(p.status().modelCatalog.diagnostics.summary.excluded.hidden,2);assert.throws(()=>p.model('aipro-fast-model'),/invalid_model/);p.model('GPT-OSS-120B-128K');assert.equal(p.status().model,'GPT-OSS-120B-128K');assert.ok(!JSON.stringify(p.status()).includes(token));p.dispose();
});

test('image capability is explicit metadata, never a model name guess or catalog filter',async()=>{
  const payload={modelList:[{name:'qwen-3.8-27b-cli'},{name:'visual',supports_images:true},{name:'text',supports_images:false}]};
  const token='eyJhbGciOiJSUzI1NiJ9.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+300})).toString('base64url')+'.signature';
  const p=createProviders({startLogin:async()=>({result:fetchModels(token,async()=>Response.json(payload)).then(models=>({token,models})),cancel(){}})});
  await p.login('aipro');await new Promise(r=>setImmediate(r));
  assert.equal(p.status().vision,false);assert.equal(p.status().models.length,3);
  p.model('visual');assert.equal(p.status().vision,true);p.model('text');assert.equal(p.status().vision,false);p.dispose();
});

// ---- The server's token count (user, 2026-09-30) ----
// The AI Pro stream the user pasted (vLLM, Qwen3.8-27B-FP8-256K): reasoning chunks, then a last chunk without choices
// that carries usage. vLLM sends that chunk only when the request asks for it.
const qwenStream=['{"id":"chatcmpl-7ac7","object":"chat.completion.chunk","model":"QWEN3.8-27B-FP8-256K","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}',
  ...['The',' user',' just',' said'].map(text=>JSON.stringify({object:'chat.completion.chunk',choices:[{index:0,delta:{reasoning:text},finish_reason:null}]})),
  '{"object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"안녕하세요."},"finish_reason":"stop"}]}',
  '{"id":"chatcmpl-7ac7","object":"chat.completion.chunk","model":"QWEN3.8-27B-FP8-256K","choices":[],"usage":{"prompt_tokens":23175,"total_tokens":23223,"completion_tokens":48,"completion_tokens_details":{"reasoning_tokens":30}}}'];
const sse=chunks=>new Response(chunks.map(chunk=>`data: ${chunk}\n\n`).join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
async function aiproSession(respond){
  const bodies=[];const p=createProviders({startLogin:async()=>({result:Promise.resolve({token:'private-token',models:[{id:'qwen3.8-27b',label:'qwen3.8-27b',contextLength:262144}]}),cancel(){}}),fetchImpl:async(url,options)=>{const body=JSON.parse(options.body);bodies.push(body);return respond(body,bodies.length);}});
  await p.login('aipro');await new Promise(resolve=>setImmediate(resolve));
  return{p,bodies,complete:()=>p.complete([{role:'user',content:'안녕'}],[],new AbortController().signal,()=>{},()=>{})};
}
test('AI Pro requests ask for the token count, and the last usage chunk reaches the budget',async()=>{
  const {bodies,complete}=await aiproSession(()=>sse(qwenStream));
  const result=await complete();
  assert.deepEqual(bodies[0].stream_options,{include_usage:true});assert.equal(bodies[0].stream,true);
  assert.equal(result.content,'안녕하세요.');
  assert.deepEqual(result.usage,{prompt_tokens:23175,completion_tokens:48,total_tokens:23223,completion_tokens_details:{reasoning_tokens:30}});
});
test('a server that refuses the usage option is asked again without it, for the rest of the session',async()=>{
  for(const refusal of [{error:{message:'Unrecognized request argument supplied: stream_options',type:'invalid_request_error',param:'stream_options'}},{detail:[{loc:['body','stream_options'],msg:'Extra inputs are not permitted',type:'extra_forbidden'}]}]){
    const {bodies,complete}=await aiproSession(body=>body.stream_options?Response.json(refusal,{status:refusal.detail?422:400}):sse(qwenStream.slice(0,-1)));
    const result=await complete();
    assert.equal(result.content,'안녕하세요.');assert.ok(!result.usage,'no count without the option: the estimate decides');
    await complete();
    assert.deepEqual(bodies.map(body=>'stream_options' in body),[true,false,false]);
  }
  // Both refusals in one request: the usage option first, then the answer size.
  const {bodies,complete}=await aiproSession(body=>body.stream_options?Response.json({error:{message:'stream_options is not supported',param:'stream_options'}},{status:400}):body.max_tokens>4096?Response.json({error:{message:'max_tokens is too large'}},{status:400}):sse(qwenStream));
  assert.equal((await complete()).usage.prompt_tokens,23175);
  assert.deepEqual(bodies.map(body=>['stream_options' in body,body.max_tokens]),[[true,16384],[false,16384],[false,4096]]);
  // Another refusal is not taken for the usage option: the request fails as before.
  const other=await aiproSession(()=>Response.json({error:{message:'tools are not supported',param:'tools'}},{status:400}));
  await assert.rejects(other.complete(),/invalid_model/);assert.equal(other.bodies.length,1);
});

// ---- Output format (S1 design, part 3): AI Pro enforces the fill sheet's JSON schema; a server that refuses it is asked
// again without it for the rest of the session, and code still checks the answer. ----
test('AI Pro requests carry the response format they are given, and a refusal drops it for the session',async()=>{
  const format={type:'json_schema',json_schema:{name:'form_cells',strict:true,schema:{type:'object',properties:{},additionalProperties:false}}};
  const {p,bodies}=await aiproSession(()=>sse(qwenStream));
  await p.complete([{role:'user',content:'채움표'}],[],new AbortController().signal,()=>{},()=>{},()=>{},{responseFormat:format});
  assert.deepEqual(bodies[0].response_format,format);
  await p.complete([{role:'user',content:'일반'}],[],new AbortController().signal,()=>{},()=>{});
  assert.ok(!('response_format' in bodies[1]),'only the calls that ask for it');
  const refused=await aiproSession(body=>body.response_format?Response.json({error:{message:'response_format json_schema is not supported by this model',param:'response_format'}},{status:400}):sse(qwenStream));
  await refused.p.complete([{role:'user',content:'채움표'}],[],new AbortController().signal,()=>{},()=>{},()=>{},{responseFormat:format});
  await refused.p.complete([{role:'user',content:'채움표'}],[],new AbortController().signal,()=>{},()=>{},()=>{},{responseFormat:format});
  assert.deepEqual(refused.bodies.map(body=>'response_format' in body),[true,false,false]);
});
// Review of plan 2 (2026-10-01): a server that words its refusal its own way ("JSON schema", "structured_outputs") made
// the form run fail as invalid_model. A request that sent a format and is refused for a reason not known is sent once
// more without it.
test('a refusal in other words drops the response format once, and a refusal for another reason still fails',async()=>{
  const format={type:'json_schema',json_schema:{name:'form_cells',strict:true,schema:{type:'object',properties:{},additionalProperties:false}}};
  const worded=await aiproSession(body=>body.response_format?Response.json({detail:'structured_outputs: JSON schema not available for this deployment'},{status:422}):sse(qwenStream));
  await worded.p.complete([{role:'user',content:'채움표'}],[],new AbortController().signal,()=>{},()=>{},()=>{},{responseFormat:format});
  assert.deepEqual(worded.bodies.map(body=>'response_format' in body),[true,false]);
  const broken=await aiproSession(()=>Response.json({detail:'model not found'},{status:400}));
  await assert.rejects(broken.p.complete([{role:'user',content:'채움표'}],[],new AbortController().signal,()=>{},()=>{},()=>{},{responseFormat:format}),/invalid_model/);
  assert.equal(broken.bodies.length,2,'one more request without the format, then the error');
});

// A summary limit belongs to one call; the following interactive response still
// uses the model's ordinary output allowance.
test('per-call summary output budget reaches AI Pro without changing the next answer',async()=>{
  const {p,bodies,complete}=await aiproSession(()=>sse(qwenStream));
  await p.complete([{role:'user',content:'Summarize'}],[],new AbortController().signal,undefined,undefined,undefined,{maxTokens:2048});
  await complete();
  assert.equal(bodies[0].max_tokens,2048);
  assert.equal(bodies[1].max_tokens,16384);
  await p.complete([{role:'user',content:'Summarize'}],[],new AbortController().signal,undefined,undefined,undefined,{maxTokens:999999});
  assert.equal(bodies[2].max_tokens,16384);
});
