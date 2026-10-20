import test from 'node:test';
import assert from 'node:assert/strict';

const policy=async()=>{const module=await import('../runtime/wiki-durable-policy.mjs').catch(()=>({}));assert.equal(typeof module.wikiRetryPolicy,'function');return module;};
test('Wiki timeouts retry with growing waits and stop at the persisted wall deadline',async()=>{
 const {wikiRetryPolicy}=await policy();
 let now=1000;const deadlineAt=now+7200000,waits=[];
 for(let attempt=0;attempt<7;attempt++){const choice=wikiRetryPolicy(Error('model_timeout'),{attempt,now,deadlineAt});assert.equal(choice.retry,true);waits.push(choice.waitMs);now+=choice.waitMs;}
 assert.deepEqual(waits,[10000,30000,60000,120000,300000,300000,300000]);
 assert.equal(wikiRetryPolicy(Error('model_timeout'),{now:deadlineAt,deadlineAt}).retry,false);
 assert.equal(wikiRetryPolicy(Error('model_timeout'),{now:deadlineAt,deadlineAt}).terminal,false);
});
test('Wiki 429 waits for the server reset and never shortens it to the five-minute retry cap',async()=>{
 const {wikiRetryPolicy}=await policy();const error=Object.assign(Error('rate_limited'),{status:429,retryAfterMs:600000});
 assert.equal(wikiRetryPolicy(error,{now:0,deadlineAt:7200000}).waitMs,600000);
 assert.equal(wikiRetryPolicy(error,{now:0,deadlineAt:300000}).retry,false);
});
test('only authentication, permission, bad request and cancellation are terminal Wiki model failures',async()=>{
 const {wikiRetryPolicy}=await policy();for(const status of [400,401,403])assert.equal(wikiRetryPolicy(Object.assign(Error('request_failed'),{status})).terminal,true);
 assert.equal(wikiRetryPolicy(Object.assign(Error('cancelled'),{name:'AbortError'})).terminal,true);
 for(const code of ['network','model_timeout','output_limit','response_invalid','provider_changed'])assert.equal(wikiRetryPolicy(Error(code)).terminal,false);
 assert.equal(wikiRetryPolicy(Object.assign(Error('server_error'),{status:503})).retry,true);
});
