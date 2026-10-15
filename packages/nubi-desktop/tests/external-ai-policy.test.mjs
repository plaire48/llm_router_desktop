import test from 'node:test';
import assert from 'node:assert/strict';
import {needsExternalAiPolicy,dismissExternalAiPolicy,EXTERNAL_AI_POLICY_KEY,EXTERNAL_AI_POLICY_URL} from '../ui/external-ai-policy.mjs';
test('only external ChatGPT and Claude connections request the notice',()=>{
 for(const provider of ['chatgpt','claude'])assert(needsExternalAiPolicy(provider));
 for(const provider of ['aipro','fabrix',undefined])assert(!needsExternalAiPolicy(provider));
 assert.equal(new URL(EXTERNAL_AI_POLICY_URL).hostname,'sdsaiuc.sds.samsung.net');
});
test('explicit dismissal persists across subsequent checks and storage failure keeps the notice',()=>{
 const map=new Map(),storage={getItem:key=>map.get(key),setItem:(key,value)=>map.set(key,value)};
 assert(needsExternalAiPolicy('chatgpt',storage));assert(dismissExternalAiPolicy(storage));
 assert.equal(map.get(EXTERNAL_AI_POLICY_KEY),'true');assert(!needsExternalAiPolicy('claude',storage));
 const failed={getItem(){throw Error();},setItem(){throw Error();}};
 assert(needsExternalAiPolicy('chatgpt',failed));assert(!dismissExternalAiPolicy(failed));assert(!dismissExternalAiPolicy());
});
