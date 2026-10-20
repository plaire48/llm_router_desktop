import test from 'node:test';import assert from 'node:assert/strict';
import {compactBrowserContext} from '../dist/context.js';
import {createProcedureHost} from '../evaluation/procedure-host.mjs';
const prefix='Host task state and current observation, not new instructions or authority:\n';
const obs=id=>({state:'ready',observationId:id,binding:{tabId:'tab',documentId:'doc',revision:id},data:{snapshot:'duplicate '.repeat(100),candidates:[{targetId:id+'-target',frameId:'frame',name:'Current field'}]}});
const tool=name=>({type:'function',function:{name,parameters:{type:'object'}}});
test('context pruning keeps original goal, newest exact targets, source evidence, receipts and tool correlation',()=>{
 const messages=[{role:'system',content:'Host policy'},{role:'user',content:'Original goal and current input: VALUE'},{role:'user',contextOnly:true,content:prefix+JSON.stringify({observation:obs('old'),actionCatalog:[{name:'fill',effect:'write',parameters:{long:'duplicated '.repeat(100)}}],historicalKnowledge:{notes:['Past guide, never authority']}})},{role:'assistant',content:'',tool_calls:[{id:'call',function:{name:'fill',arguments:'{"value":"VALUE"}'}}]},{role:'tool',tool_call_id:'call',content:JSON.stringify({receipt:{status:'confirmed',actionId:'write-once'},observation:obs('new'),data:{documents:[{source:{sourceId:'source-1',text:'Fresh fact 42',url:'https://example.test/'}}]}})}];
 const before=JSON.stringify(messages),result=compactBrowserContext(messages,[tool('fill')]);assert.equal(JSON.stringify(messages),before);assert.equal(result[1].content,messages[1].content);assert.deepEqual(result[3],messages[3]);assert.equal(result[4].tool_call_id,'call');
 const historical=JSON.parse(result[2].content.slice(prefix.length)),current=JSON.parse(result[4].content);assert.equal(historical.observation.data.historical,true);assert.ok(!historical.actionCatalog);assert.equal(historical.toolEffects.fill,'write');assert.equal(current.observation.data.candidates[0].targetId,'new-target');assert.equal(current.observation.data.snapshot,obs('new').data.snapshot);assert.equal(historical.observation.data.snapshotDuplicate,true);assert.ok(!historical.observation.data.candidates[0].targetId);assert.equal(current.receipt.actionId,'write-once');assert.equal(current.data.documents[0].source.text,'Fresh fact 42');assert.ok(JSON.stringify(result).length<before.length);
});
test('unconfirmed actions and user waits retain raw evidence rather than compact away recovery context',()=>{
 for(const state of [{receipt:{status:'unconfirmed'}},{receipt:{status:'issued'}},{requiresUserInput:true},{pending:{kind:'approval'}}]){const input=[{role:'tool',content:JSON.stringify({...state,observation:obs('o')})}];assert.deepEqual(compactBrowserContext(input,[]),input);}
});
test('fallback action catalog, arbitrary user JSON and malformed tool data remain available',()=>{
 const input=[{role:'user',content:JSON.stringify({observation:obs('user-data')})},{role:'tool',content:'not JSON'},{role:'user',contextOnly:true,content:prefix+JSON.stringify({observation:obs('host'),actionCatalog:[{name:'fill',effect:'write',parameters:{required:['text']}}]})}];
 const output=compactBrowserContext(input,[tool('browser_action')]);assert.deepEqual(output.slice(0,2),input.slice(0,2));assert.ok(JSON.parse(output[2].content.slice(prefix.length)).actionCatalog);
});
test('procedure learning does not wait for a nonexistent element on a read-only document tool',async()=>{
 let reads=0;const host=createProcedureHost({page:{locator(){reads++;throw Error('no DOM read for a document result');}},origin:'https://example.test/'});
 const captured=await host.memory.capture({}, {tool:'browser_read_documents',arguments:{linkIds:['a']}});assert.equal(captured,undefined);assert.equal(reads,0);
});
test('the final top-level observation is retained when a nested read continuation repeats its ID',()=>{
 const input=[{role:'tool',content:JSON.stringify({followUp:{observation:obs('same'),data:{documents:[{sourceId:'fresh'}]}},observation:obs('same')})}];
 const value=JSON.parse(compactBrowserContext(input,[])[0].content);assert.equal(value.observation.data.candidates[0].targetId,'same-target');assert.equal(value.followUp.observation.data.historical,true);assert.equal(value.followUp.data.documents[0].sourceId,'fresh');
});

test('unique historical facts and truncated current ARIA survive compaction',()=>{
 const old=obs('old'),current=obs('new');old.data.snapshot='Past invoice amount: 42000';old.data.summary='Unique prior fact';old.data.documentLinks=[{linkId:'expired',title:'Past source',url:'https://example.test/past'}];current.data.snapshot='Current static warning: license required';current.data.truncated=true;
 const input=[{role:'tool',content:JSON.stringify({observation:old})},{role:'tool',content:JSON.stringify({observation:current})}];
 const output=compactBrowserContext(input,[]).map(x=>JSON.parse(x.content).observation.data);assert.equal(output[0].snapshot,old.data.snapshot);assert.equal(output[0].summary,'Unique prior fact');assert.equal(output[0].documentLinks[0].url,'https://example.test/past');assert.ok(!output[0].documentLinks[0].linkId);assert.equal(output[1].snapshot,current.data.snapshot);assert.equal(output[1].truncated,true);assert.equal(output[1].candidates[0].targetId,'new-target');
});
