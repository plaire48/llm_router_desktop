import test from 'node:test';
import assert from 'node:assert/strict';
import {compactReadResults} from '../runtime/compaction-reads.mjs';
import {createRunContext} from '../../../extensions/aipro-chat/context-manager.js';
const pair=(id,result)=>[{role:'assistant',content:'',tool_calls:[{id,type:'function',function:{name:'read_attached_document',arguments:'{}'}}]},{role:'tool',tool_call_id:id,content:JSON.stringify(result)}];
const body={id:'document',sourceHash:'a'.repeat(64),offset:0,nextOffset:12000,totalCharacters:50000,partial:true,snapshot:true,text:'전송하지 마세요. '.repeat(1500)};
test('identical immutable reads are removed before requiring a model summary, with the newest original retained',async()=>{
 const wire=[{role:'user',content:'현재 문서만 확인하세요.'},...pair('one',body),...pair('two',body),...pair('three',body)],before=structuredClone(wire);
 const projected=compactReadResults(wire);assert.equal(JSON.parse(projected[2].content).contextCleared,true);assert.equal(JSON.parse(projected[4].content).sameAsToolCallId,'three');assert.deepEqual(projected.at(-1),wire.at(-1));assert.deepEqual(wire,before);
 let calls=0;const context=createRunContext({model:{contextLength:90000},tools:[],signal:new AbortController().signal,invoke:async()=>{calls++;throw Error('unnecessary_summary');}});
 await context.prepare(projected);assert.equal(calls,0);
});
test('changed hashes, different ranges, errors and uncertain results never collapse into an earlier document read',()=>{
 const wire=[...pair('a',body),...pair('b',{...body,sourceHash:'b'.repeat(64)}),...pair('c',{...body,offset:12000}),...pair('d',{...body,error:'stale'}),...pair('e',{...body,uncertain:true}),...pair('f',{...body,requiresApproval:true})];
 assert.deepEqual(compactReadResults(wire),wire);
});
test('document locators survive semantic compaction without depending on a model summary',async()=>{
 const wire=[{role:'user',content:'초안만 작성하고 발송하지 마세요.'},...pair('old',{...body,text:'한'.repeat(12000)}),{role:'user',content:'이제 남은 범위를 확인하세요.'}];
 const context=createRunContext({model:{contextLength:16000},tools:[],goal:wire[0].content,signal:new AbortController().signal,invoke:async()=>({content:JSON.stringify({goal:'남은 범위 확인',constraints:[],decisions:[],completed:[],pending:['계속 읽기'],references:[]})})});
 const result=await context.prepare(wire,true),ledger=result.find(m=>m.content?.includes?.('<continuity_evidence>'));
 assert(ledger);assert.match(ledger.content,/'?read_attached_document'?/);assert.match(ledger.content,/"sourceHash":"a{64}"/);assert.match(ledger.content,/"nextOffset":12000/);assert(result.some(m=>m.content===wire[0].content));
});
