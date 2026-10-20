import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as word from '../dist/word.js';
import {deferred,until} from './host.mjs';
const draft=JSON.parse(await readFile(new URL('../eval/WD-CREATE-01.reference-draft.json',import.meta.url),'utf8'));
function model({proseOnly=false,gate}={}){
  const calls=[];return {calls,transport:{stream(request,cb){calls.push(request);let cancelled=false;
    queueMicrotask(async()=>{if(gate)await gate.promise;if(cancelled)return;
      const results=request.messages.filter(m=>m.role==='tool').flatMap(m=>m.results);
      if(proseOnly)cb.onDelta('문서를 완성했습니다.');
      else if(!results.some(r=>r.name==='read_word_sources'))cb.onToolCall({id:'read-source',name:'read_word_sources',input:{}});
      else if(!results.some(r=>r.name==='submit_word_draft'))cb.onToolCall({id:'draft',name:'submit_word_draft',input:structuredClone(draft)});
      else cb.onDelta('검토용 초안을 준비했습니다.');cb.onDone();});
    return {cancel(){cancelled=true;cb.onDone();}};
  }}};
}
test('host-injected model uses the existing GenOffice loop to read sources and create a Word draft',async()=>{
  assert.equal(typeof word.prepareWordDocument,'function','Model-to-Word drafting is not connected');
  const h=model(),events=[];
  const result=await word.prepareWordDocument({request:'보고서를 작성하세요.',sources:{created:6,reviewed:3}},h.transport,new AbortController().signal,{onTool:name=>events.push(name)});
  assert.equal(result.engine,'genoffice');assert.equal(result.savedToOffice,false);assert.ok(result.bytes.length>1000);
  assert.equal(h.calls.length,3);assert.deepEqual(events,['read_word_sources','submit_word_draft']);
});
test('a model completion claim without a submitted draft cannot create a Word file',async()=>{
  assert.equal(typeof word.prepareWordDocument,'function','Model-to-Word drafting is not connected');
  const h=model({proseOnly:true});await assert.rejects(word.prepareWordDocument({request:'보고서를 작성하세요.',sources:{}},h.transport,new AbortController().signal),{code:'word_draft_missing'});
});
test('cancelling a pending planning model discards its late draft',async()=>{
  assert.equal(typeof word.prepareWordDocument,'function','Model-to-Word drafting is not connected');
  const gate=deferred(),h=model({gate}),control=new AbortController();
  const running=word.prepareWordDocument({request:'보고서를 작성하세요.',sources:{}},h.transport,control.signal);
  const stopped=assert.rejects(running,{code:'operation_cancelled'});await until(()=>h.calls.length===1);control.abort();gate.resolve();await stopped;
  assert.equal(h.calls.length,1);
});
