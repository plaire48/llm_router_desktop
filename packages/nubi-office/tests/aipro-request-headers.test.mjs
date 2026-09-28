// The Office worker sends the same explicit headers to AI Pro as the browser Nubi
// (extensions/aipro-chat/src/api.js, exchange.js). Only headers set by the code are
// compared: what a runtime adds by itself, such as User-Agent, is not covered here.
// The server is scripted; no request leaves this machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createProviders} from '../worker/providers.mjs';
import {startLogin,fetchModelCatalog} from '../worker/aipro-auth.mjs';

const token='eyJhbGciOiJSUzI1NiJ9.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+300})).toString('base64url')+'.signature';
const names=headers=>Object.keys(headers).sort();

test('the model list is requested with the reasoning header, like the browser',async()=>{
  const calls=[];await fetchModelCatalog(token,async(url,options)=>{calls.push({url,...options});return Response.json({modelList:[{name:'qwen3.8-27b'}]});});
  assert.equal(calls[0].url,'https://aipro.sdsdev.co.kr/api/models');assert.equal(calls[0].method??'GET','GET');
  assert.deepEqual(calls[0].headers,{Accept:'application/json',Authorization:'Bearer '+token,'X-REASONING':'true'});
});
test('a chat request carries the bearer token and no reasoning header',async()=>{
  let request;const providers=createProviders({startLogin:async()=>({result:Promise.resolve({token,models:[{id:'qwen3.8-27b',label:'Qwen'}]}),cancel(){}}),fetchImpl:async(url,options)=>{request={url,...options};return Response.json({choices:[{message:{content:'ok'},finish_reason:'stop'}]});}});
  await providers.login('aipro');await new Promise(resolve=>setImmediate(resolve));
  await providers.complete([{role:'user',content:'안녕'}],[],new AbortController().signal,()=>{},()=>{});providers.dispose();
  assert.equal(request.url,'https://aipro.sdsdev.co.kr/api/v1/chat/completions');assert.equal(request.method,'POST');
  assert.deepEqual(request.headers,{'Content-Type':'application/json',Accept:'text/event-stream',Authorization:'Bearer '+token});
});
test('the login code is exchanged as a form post without any credential header',async()=>{
  const calls=[];const flow=await startLogin({timeoutMs:2000,fetchImpl:async(url,options)=>{calls.push({url,...options});return url.endsWith('/auth/exchange')?Response.json({token}):Response.json({modelList:[{name:'qwen3.8-27b'}]});},
    openBrowser:async url=>{const port=new URL(url).searchParams.get('port');await fetch(`http://127.0.0.1:${port}/auth?status=00&code=private-test-code`);}});
  await flow.result;flow.cancel();
  const exchange=calls.find(call=>call.url==='https://aipro.sdsdev.co.kr/auth/exchange');
  assert.equal(exchange.method,'POST');assert.deepEqual(exchange.headers,{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'});
  assert.equal(exchange.body,'code=private-test-code');
  assert.deepEqual(names(calls.find(call=>call.url.endsWith('/api/models')).headers),['Accept','Authorization','X-REASONING'],'the model list read after login uses the same headers');
});
test('the browser source still sets the headers this test mirrors',async()=>{
  const api=await readFile(new URL('../../../extensions/aipro-chat/src/api.js',import.meta.url),'utf8'),exchange=await readFile(new URL('../../../extensions/aipro-chat/exchange.js',import.meta.url),'utf8');
  assert.match(api,/\/api\/models`,[^\n]*headers: \{Accept: 'application\/json', Authorization: `Bearer \$\{credential\.token\}`, 'X-REASONING': 'true'\}/);
  assert.equal(api.split("'X-REASONING'").length-1,1,'the reasoning header belongs to the model list only');
  assert.match(exchange,/headers: \{'Content-Type': 'application\/x-www-form-urlencoded', Accept: 'application\/json'\}/);
});
