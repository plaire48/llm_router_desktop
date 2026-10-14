import test from 'node:test';
import assert from 'node:assert/strict';
import {runAgent} from '../agent-runtime.js';
// A host may let the read-only calls of one response run together (parallelReadBatches, 2026-10-15, Nubi Desktop):
// Pi runs a batch in parallel unless a call's tool is sequential, so read tools become parallel and the rest stay
// sequential. The default is off and keeps the stepwise rule: one operation, the rest deferred.
const tool=name=>({type:'function',function:{name,description:name,parameters:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}}});
const tools=[tool('read_source'),tool('source_search'),tool('propose_patch')];
const call=calls=>({content:'',calls:calls.map(([name,args],i)=>({id:name+i,type:'function',function:{name,arguments:JSON.stringify(args)}}))});
const done={content:'완료',calls:null};
const reads=new Set(['read_source','source_search']);
test('with parallelReadBatches two reads in one response both run, overlapping; a batch with a write stays one at a time',async()=>{
  let round=0,active=0,peak=0;const executed=[];
  const execute=async name=>{executed.push(name);active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,25));active--;return {ok:true,name};};
  await runAgent({messages:[{role:'user',content:'읽기'}],tools,stepwise:true,parallelReadBatches:true,readTools:reads,signal:new AbortController().signal,
    complete:async()=>++round===1?call([['read_source',{path:'a'}],['source_search',{path:'b'}]]):round===2?call([['propose_patch',{path:'c'}],['read_source',{path:'d'}]]):done,execute});
  assert.deepEqual(executed.slice(0,2).sort(),['read_source','source_search']);
  assert.equal(peak,2,'both reads ran at once');
  assert.deepEqual(executed.slice(2),['propose_patch'],'the read after a write in the same response was deferred');
});
test('without the option the second read of a response is deferred as before',async()=>{
  let round=0;const executed=[];
  await runAgent({messages:[{role:'user',content:'읽기'}],tools,stepwise:true,signal:new AbortController().signal,
    complete:async()=>++round===1?call([['read_source',{path:'a'}],['source_search',{path:'b'}]]):done,execute:async name=>{executed.push(name);return {ok:true};}});
  assert.deepEqual(executed,['read_source']);
});
