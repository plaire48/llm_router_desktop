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
test('saved AI Pro API catalog retains all ten models and sends each original name without classification filters',async()=>{
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
  const names=payload.modelList.map(model=>model.name);
  assert.equal(modelRequests,1);assert.equal(names.length,10);assert.deepEqual(p.status().models.map(model=>model.id),names);
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

test('reported five-model response is diagnosed as five received, then refresh restores all ten without changing exact IDs',async()=>{
  const {fetchModelCatalog}=await import('../worker/aipro-auth.mjs');
  const payload=JSON.parse(await readFile(new URL('../../../extensions/aipro-chat/tests/fixtures/aipro-models.json',import.meta.url),'utf8'));
  const ids=['glm-5.2','QWEN3-CODER-480B-A35B-INSTRUCT-FP8-128K_rag','QWEN3-CODER-128K_general','qwen3.8-27b','gpt-oss-120b'];
  const token='eyJhbGciOiJSUzI1NiJ9.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+300})).toString('base64url')+'.signature';
  let full=false;
  const fetchImpl=async(url,options)=>{assert.equal(options.cache,'no-store');return Response.json({modelList:full?payload.modelList:payload.modelList.filter(item=>ids.includes(item.name))});};
  const p=createProviders({fetchImpl,startLogin:async()=>({result:fetchModelCatalog(token,fetchImpl).then(catalog=>({token,...catalog})),cancel(){}})});
  await p.login('aipro');for(let i=0;i<30&&p.status().pending;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(p.status().modelCatalog.diagnostics.summary.received,5);assert.equal(p.status().models.length,5);
  assert.ok(!p.status().models.some(item=>item.id==='aipro-fast-model'));
  p.model('glm-5.2');full=true;await p.refreshModels();assert.equal(p.status().model,'glm-5.2');assert.equal(p.status().modelCatalog.diagnostics.summary.received,10);
  p.model('aipro-fast-model');assert.equal(p.status().model,'aipro-fast-model');assert.ok(!JSON.stringify(p.status()).includes(token));p.dispose();
});

test('image capability is explicit metadata, never a model name guess or catalog filter',async()=>{
  const payload={modelList:[{name:'qwen-3.8-27b-cli'},{name:'visual',supports_images:true},{name:'text',supports_images:false}]};
  const token='eyJhbGciOiJSUzI1NiJ9.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+300})).toString('base64url')+'.signature';
  const p=createProviders({startLogin:async()=>({result:fetchModels(token,async()=>Response.json(payload)).then(models=>({token,models})),cancel(){}})});
  await p.login('aipro');await new Promise(r=>setImmediate(r));
  assert.equal(p.status().vision,false);assert.equal(p.status().models.length,3);
  p.model('visual');assert.equal(p.status().vision,true);p.model('text');assert.equal(p.status().vision,false);p.dispose();
});
