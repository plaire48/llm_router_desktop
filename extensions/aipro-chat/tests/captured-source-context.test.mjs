import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisCoordinator} from '../analysis-agents.js';

const packet = i => ({ok:true,dataKind:'page_content',url:`https://source${i}.example/article`,frame:0,
  source_document_id:`doc-${i}`,content_hash:String(i%10).repeat(64),coverage:{partial:true},
  ranges:[{start:0,end:12000,markdown:`Source ${i}. `.repeat(1200)}],next_offset:12000});
const pair = (i,result) => [{role:'assistant',content:'',tool_calls:[{id:`t${i}`,type:'function',function:{name:'navigate_page',arguments:'{}'}}]},
  {role:'tool',tool_call_id:`t${i}`,content:JSON.stringify(result)}];
function fixture(t) {
  const coordinator=createAnalysisCoordinator({signal:new AbortController().signal});t.after(()=>coordinator.dispose());
  const make=(i,extra={})=>{const reference=packet(i),id=coordinator.observe('read_page',{mode:'content'},reference);
    return {ok:true,actionIssued:true,receipt:{id:`navigation-${i}`,state:'returned'},observation:{frames:[{documentId:`doc-${i}`,elements:[{ref:`e${i}`}]}]},
      source_capture:{status:'observed',analysis_evidence_id:id,review_evidence_id:i,reference},...extra};};
  return {coordinator,make};
}
test('captured source copies shrink while exact originals, current observations and every receipt survive',async t=>{
  const {coordinator,make}=fixture(t), results=Array.from({length:6},(_,i)=>make(i+1));
  const wire=[{role:'user',content:'Compare sources. Do not submit anything.'},...results.flatMap((r,i)=>pair(i,r))];
  const original=structuredClone(wire), packed=coordinator.prepareContext(wire);
  assert.deepEqual(wire,original);assert.deepEqual(packed.slice(-4),wire.slice(-4));assert.deepEqual(packed[0],wire[0]);
  assert.equal(packed.filter(m=>m.role==='tool'&&JSON.parse(m.content).source_capture.reference.contextCleared).length,4);
  for(let i=0;i<4;i++) {
    const saved=JSON.parse(packed[2+i*2].content), before=results[i];
    assert.deepEqual({...saved,source_capture:null},{...before,source_capture:null});
    assert.equal(saved.source_capture.review_evidence_id,before.source_capture.review_evidence_id);
    let raw='',offset=0;
    do {const read=await coordinator.execute('read_analysis_evidence',{evidence_id:saved.source_capture.analysis_evidence_id,offset});raw+=read.text;offset=read.next_offset;}while(offset!==null);
    assert.deepEqual(JSON.parse(raw).result,before.source_capture.reference);
  }
  assert(JSON.stringify(packed).length<JSON.stringify(wire).length*.5);
});
test('different hash/text/identity, evicted originals and uncertain outcomes cannot discard source text',t=>{
  const {coordinator,make}=fixture(t);
  const changed=make(1);changed.source_capture.reference=structuredClone(changed.source_capture.reference);
  changed.source_capture.reference.ranges[0].markdown='changed original '.repeat(1200);
  const missing=make(2);missing.source_capture.analysis_evidence_id='ev_999';
  const uncertain=make(3,{uncertain:true}), cancelled=make(4,{cancelled:true}), waiting=make(5,{requiresUserInput:true});
  const wire=[changed,missing,uncertain,cancelled,waiting,make(6),make(7)].flatMap((r,i)=>pair(i,r));
  assert.deepEqual(coordinator.prepareContext(wire),wire);
});
