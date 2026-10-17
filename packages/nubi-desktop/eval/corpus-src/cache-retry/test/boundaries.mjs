import test from 'node:test';
import assert from 'node:assert/strict';
import {createCache} from '../src/cache.mjs';
import {withRetry} from '../src/retry.mjs';
import {createService} from '../src/service.mjs';
test('cache equality expires, reference mutations persist, map handles inherited names',()=>{
  let time=0;const cache=createCache(100,()=>time), value={n:1};cache.set('toString',value);
  time=99;assert.equal(cache.get('toString'),value);value.n=2;assert.equal(cache.get('toString').n,2);
  time=100;assert.equal(cache.get('toString'),undefined);
});
test('finite TTL and clock can overflow expiration into Infinity',()=>{
  const cache=createCache(Number.MAX_VALUE,()=>Number.MAX_VALUE);cache.set('x',1);assert.equal(cache.get('x'),1);
});
test('two retries means three attempts and delays 100ms then 200ms',async()=>{
  const attempts=[],delays=[];await assert.rejects(withRetry(async i=>{attempts.push(i);throw Object.assign(Error('retry'),{retryable:true});},{sleep:async ms=>delays.push(ms)}));
  assert.deepEqual(attempts,[0,1,2]);assert.deepEqual(delays,[100,200]);
});
test('abort does not cancel the in-flight task or retract its successful result',async()=>{
  const controller=new AbortController();assert.equal(await withRetry(async()=>{controller.abort();return 7;},{signal:controller.signal}),7);
});
test('undefined is fetched again, false is cached, concurrent misses are not coalesced',async()=>{
  let calls=0;const empty=createService(async()=>{calls++;return undefined;});await empty('x');await empty('x');assert.equal(calls,2);
  calls=0;const falsy=createService(async()=>{calls++;return false;});await falsy('x');await falsy('x');assert.equal(calls,1);
  calls=0;const concurrent=createService(async()=>{calls++;return 1;});await Promise.all([concurrent('x'),concurrent('x')]);assert.equal(calls,2);
});
