import test from 'node:test';import assert from 'node:assert/strict';
import {recoverModel} from '../../../extensions/aipro-chat/model-recovery.js';
// Adopted from opencode's model retry (2026-10-23): a busy internal API (429/503) gets more attempts than other
// failures, which keep the existing three retries.
const failing=(status,times)=>{let calls=0;return {run:async()=>{calls++;if(calls<=times)throw Object.assign(new Error('upstream'),{status});return 'ok';},calls:()=>calls};};
const options={signal:new AbortController().signal,retries:3,busyRetries:7,minTimeout:1,maxTimeout:2};
test('429 and 503 are retried up to busyRetries',async()=>{
 for(const status of [429,503]){const model=failing(status,6);assert.equal(await recoverModel(model.run,options),'ok');assert.equal(model.calls(),7);}
});
test('other server errors still stop after the ordinary retries',async()=>{
 const model=failing(500,6);await assert.rejects(recoverModel(model.run,options));assert.equal(model.calls(),4);
});
test('without busyRetries nothing changes for other callers',async()=>{
 const model=failing(429,6);await assert.rejects(recoverModel(model.run,{...options,busyRetries:undefined}));assert.equal(model.calls(),4);
});
