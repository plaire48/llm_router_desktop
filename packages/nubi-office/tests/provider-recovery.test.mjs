// Exercise the actual shared adapters with intercepted HTTP, never credentials
// or a live provider. This also checks the publication's pinned shared copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import {completeChatGPT,chatGPTModels} from '../../../extensions/aipro-chat/chatgpt-api.js';
import {fabrixCompletion} from '../../../extensions/aipro-chat/fabrix.js';
import {observeResponsesUsage} from '../../../extensions/aipro-chat/usage-stream.js';

function chatOptions() {
  const payload={exp:Math.floor(Date.now()/1000)+3600,'https://api.openai.com/auth':{chatgpt_account_id:'synthetic-account'}};
  return {messages:[{role:'user',content:'synthetic question'}],tools:[],modelId:chatGPTModels().payload.modelList[0].name,
    credential:{token:`header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`},signal:new AbortController().signal,onText:()=>{},onPhase:()=>{}};
}
test('actual ChatGPT adapter preserves HTTP timing without an inner SDK retry or secret diagnostics',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  for(const [status,code] of [[401,'unauthorized'],[429,'rate_limited'],[500,'upstream']]){
    let calls=0;globalThis.fetch=async()=>{calls++;return new Response('private-server-content',{status,headers:{'Retry-After':'7'}});};
    await assert.rejects(completeChatGPT(chatOptions()),e=>e.message===code&&e.status===status&&e.retryAfterMs===7000&&!JSON.stringify(e).includes('private-server-content'));
    assert.equal(calls,1);
  }
});
test('actual ChatGPT adapter rejects an interrupted Responses stream before producing executable tools',async t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response('data: {"type":"response.created","response":{"id":"synthetic"}}\n\n',{headers:{'Content-Type':'text/event-stream'}});};
  await assert.rejects(completeChatGPT(chatOptions()),/model_stream_incomplete/);assert.equal(calls,1);
});
test('Responses terminal observation is independent of usage and does not consume the SDK body',async()=>{
  let terminals=0,measurements=0;
  const body='data: {"type":"response.completed","response":{"id":"synthetic"}}\n\n';
  const result=observeResponsesUsage(new Response(body,{headers:{'Content-Type':'text/event-stream'}}),()=>measurements++,()=>terminals++);
  assert.equal(await result.text(),body);assert.equal(terminals,1);assert.equal(measurements,0);
});
test('actual FabriX adapter preserves server waiting and rejects incomplete SSE without internal network replay',async()=>{
  const connection={endpoint:'https://fabrix.invalid/openapi',clientKey:'synthetic-client',token:'synthetic-token',modelId:'catalog-model'};
  const request={model:'catalog-model',messages:[{role:'user',content:'synthetic question'}],stream:true};let calls=0;
  await assert.rejects(fabrixCompletion(request,connection,{fetchImpl:async()=>{calls++;return new Response('private-server-content',{status:429,headers:{'Retry-After':'8'}});}}),e=>e.status===429&&e.retryAfterMs===8000&&!JSON.stringify(e).includes('private-server-content'));
  assert.equal(calls,1);
  await assert.rejects(fabrixCompletion(request,connection,{fetchImpl:async()=>new Response('data: {"eventStatus":"CHUNK","content":"unfinished"}\n\n',{headers:{'Content-Type':'text/event-stream'}})}),/model_stream_incomplete/);
});
