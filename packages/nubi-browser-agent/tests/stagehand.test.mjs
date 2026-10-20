import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {createStagehandModelBridge} from '../dist/stagehand.js';
import {deferred} from './host.mjs';

const request={options:{messages:[{role:'user',content:'Read-only evidence'}],response_model:{name:'Test',schema:z.object({ok:z.boolean()})}},logger:()=>{}};
test('Stagehand model calls require an active bound invocation and current host access',async()=>{
 let calls=0;const bridge=createStagehandModelBridge({id:'host-model',complete:async()=>{calls++;throw Error('must not call');}}),signal=new AbortController().signal;
 await assert.rejects(bridge.client.createChatCompletion(request),/stagehand_inference_unbound/);
 await assert.rejects(bridge.run(signal,async()=>false,()=>bridge.client.createChatCompletion(request)),/stagehand_access_denied/);assert.equal(calls,0);
});
test('a cancelled Stagehand invocation cannot borrow a later task signal or overlap another SDK operation',async()=>{
 const start=deferred(),finish=deferred(),controller=new AbortController();let original;
 const bridge=createStagehandModelBridge({id:'host-model',async complete(_m,_t,ctx){original=ctx.signal;start.resolve();await finish.promise;return {content:'',calls:[{function:{name:'screen_analysis',arguments:'{"ok":true}'}}]};}});
 const pending=bridge.run(controller.signal,async()=>true,()=>bridge.client.createChatCompletion(request));await start.promise;controller.abort();
 await assert.rejects(bridge.run(new AbortController().signal,async()=>true,async()=>null),/stagehand_busy/);assert.equal(original,controller.signal);finish.resolve();await assert.rejects(pending);assert.equal(original.aborted,true);
 const next=await bridge.run(new AbortController().signal,async()=>true,async()=>42);assert.equal(next,42);
});
