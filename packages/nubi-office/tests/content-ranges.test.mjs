import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createContentText} from '../worker/content-text.mjs';
import {createContentAnalysis} from '../worker/content-analysis.mjs';
import {createDocumentDelegation} from '../worker/document-delegation.mjs';
import {normalizeTextRanges} from '../worker/content-ranges.mjs';
import {createActivityLog} from '../worker/activity.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const task=(offset=40000,extra={})=>({id:'tail',specialty:'말미 검토',goal:'배정된 구간 확인',role:'analysis',constraints:'구간 밖 추정 금지',doneWhen:'기재 사실 인용',itemIds:['p'],textRanges:[{itemId:'p',field:'text',offset,length:100}],dependsOn:[],...extra});
const quote=messages=>{const source=JSON.parse(messages[1].content).sources[0];return{content:JSON.stringify({summary:'구간 확인',findings:[{text:'원문에 기재됨',sources:[{itemId:source.item.id,field:source.provenance.field,quote:source.item[source.provenance.field].slice(-20)}]}],missing:[]})};};
function setup({complete=quote,field='text'}={}){
  const text='앞'.repeat(40000)+'별도 담당 구간 '+'끝'.repeat(30000),item={id:'p',kind:'paragraph',text:field==='text'?text.slice(0,4000):'제목',[field]:text.slice(0,4000),truncated:true,[field+'Hash']:hash(text),[field+'Length']:text.length,...(field==='notes'?{notesTruncated:true}:{})};
  const page={host:field==='text'?'word':'powerpoint',scopeId:'s',documentId:'d',fingerprint:'f',offset:0,total:1,nextOffset:null,items:[item]},pages=new Map([[0,page]]),controller=new AbortController(),activity=createActivityLog(),metrics={modelCalls:0},calls=[];let model='qwen',checks=0;
  const store=createContentText({pages,signal:controller.signal,call:async(name,p)=>{calls.push(name);const chunk=text.slice(p.offset,p.offset+p.maxChars);return{host:page.host,scopeId:'s',documentId:'d',fingerprint:'f',itemId:'p',field,offset:p.offset,text:chunk,textLength:text.length,textHash:hash(text),chunkHash:hash(chunk),nextOffset:p.offset+chunk.length<text.length?p.offset+chunk.length:null,readOnly:true};}});
  const providers={status:()=>({provider:'aipro',model}),complete:async(...args)=>{assert.deepEqual(args[1],[]);return complete(...args);}};
  const analysis=createContentAnalysis({host:page.host,pages,getPages:()=>store.project(),getTextRange:r=>store.select(r),providers,signal:controller.signal,activity,metrics});
  const delegation=createDocumentDelegation({analysis,pages,getTextRange:r=>store.select(r),getPages:()=>store.project(),providers,signal:controller.signal,checkSource:async()=>{checks++;}});
  return{store,analysis,delegation,page,pages,text,metrics,calls,controller,model:v=>{model=v;},get checks(){return checks;}};
}
test('large item tail goes to the assigned child with exact provenance and no full document claim',async()=>{
  const h=setup();await h.store.read({itemId:'p',field:'text',offset:40000,maxChars:200});
  const result=await h.analysis.execute([task()]),r=result.results[0];assert.equal(r.status,'analyzed');assert.equal(r.reportStatus,'complete');assert.equal(r.coverage.completeDocument,false);assert.equal(r.coverage.kind,'assigned_text_ranges');
  const ref=r.findings[0].sources[0];assert.equal(ref.itemId,'p');assert.equal(ref.textOffset,40000+h.text.slice(40000,40100).indexOf(ref.quote));assert.equal(ref.textHash,hash(h.text));assert.equal(h.page.items[0].text.length,4000);assert.ok(ref.rangeId.startsWith('range-'));
});
test('PPT notes ranges stay separate from title text',async()=>{
  const h=setup({field:'notes'});await h.store.read({itemId:'p',field:'notes',offset:40000,maxChars:100});
  const t=task();t.textRanges[0].field='notes';const r=(await h.analysis.execute([t])).results[0];assert.equal(r.findings[0].sources[0].field,'notes');assert.equal(r.coverage.ranges[0].field,'notes');
});
test('unread gaps and invalid range batches dispatch no child calls',async()=>{
  const h=setup();await h.store.read({itemId:'p',field:'text',offset:40000,maxChars:100});
  for(const t of [task(40100),task(39990)])await assert.rejects(h.analysis.execute([task(),t]),/source_not_read/);
  for(const change of [{offset:-1},{offset:0.5},{length:0},{length:8001},{field:'title'},{itemId:'other'},{extra:true}]){
    const t=task();Object.assign(t.textRanges[0],change);assert.throws(()=>normalizeTextRanges(t),/tool_arguments_invalid/);
  }
  assert.equal(h.metrics.modelCalls,0);
});
test('ranges normalize order but reject overlap, uncovered IDs and aggregate over-budget',()=>{
  const a=task(),b={itemId:'p',field:'text',offset:41000,length:100};assert.deepEqual(normalizeTextRanges({...a,textRanges:[b,...a.textRanges]}),normalizeTextRanges({...a,textRanges:[...a.textRanges,b]}));
  for(const t of [{...a,textRanges:[...a.textRanges,{...b,offset:40050}]},{...a,itemIds:['p','other']},{...a,textRanges:[0,8000,16000,24000].map(offset=>({...b,offset,length:8000}))}])assert.throws(()=>normalizeTextRanges(t),/tool_arguments_invalid/);
});
test('different ranges have distinct cached contracts; renamed tasks do not manufacture progress',async()=>{
  const h=setup();await h.store.read({itemId:'p',field:'text',offset:40000,maxChars:1000});
  const a=task(),b=task(40100,{id:'second'}),first=await h.delegation.execute([a,b]);assert.equal(first.status,'analyzed');assert.equal(h.metrics.modelCalls,2);assert.equal(h.delegation.progress(),2);
  const cached=await h.delegation.execute([b,a]);assert.equal(cached.planId,first.planId);assert.equal(h.metrics.modelCalls,2);
  await h.delegation.execute([{...a,id:'renamed'},{...b,id:'renamed2'}]);assert.equal(h.delegation.progress(),2);
  const read=await h.delegation.read({planId:first.planId,taskIds:['tail']});assert.ok(JSON.stringify(read).includes('40000'));
});
test('parallel range readers feed a dependent specialist only after grounded results',async()=>{
  let active=0,peak=0;const h=setup({complete:async messages=>{active++;peak=Math.max(active,peak);await new Promise(r=>setTimeout(r,2));const extra=JSON.parse(messages[2].content);if(extra.specialty==='통합')assert.equal(extra.dependencies.length,2);active--;return quote(messages);}});
  await h.store.read({itemId:'p',field:'text',offset:40000,maxChars:1000});
  const r=await h.delegation.execute([task(),task(40200,{id:'second'}),task(40400,{id:'merge',specialty:'통합',dependsOn:['tail','second']})]);assert.equal(r.status,'analyzed');assert.equal(peak,2);assert.equal(h.metrics.modelCalls,3);assert.ok(h.checks>=2);
});
test('foreign range IDs and quotes outside assigned intervals cannot become evidence',async()=>{
  for(const mutate of [r=>r.findings[0].sources[0].itemId='p',r=>r.findings[0].sources[0].quote='앞',r=>r.findings[0].sources[0].field='notes']){
    const h=setup({complete:messages=>{const r=quote(messages),v=JSON.parse(r.content);mutate(v);return{content:JSON.stringify(v)};}});await h.store.read({itemId:'p',field:'text',offset:40000,maxChars:100});
    const result=await h.analysis.execute([task()]);assert.equal(result.status,'incomplete');assert.equal(result.results[0].error,'analysis_invalid');
  }
});
test('source revisions and cancellation make captured range selections unavailable',async()=>{
  const h=setup();await h.store.read({itemId:'p',field:'text',offset:40000,maxChars:100});h.page.fingerprint='changed';assert.throws(()=>h.store.select(task().textRanges[0]),/source_not_read/);
  h.controller.abort();assert.throws(()=>h.store.select(task().textRanges[0]),/cancelled/);
});
test('adjacent cached chunks compose a selected interval while gaps stay unread',async()=>{
  const h=setup();for(const offset of [40000,40100])await h.store.read({itemId:'p',field:'text',offset,maxChars:100});
  const value=h.store.select({itemId:'p',field:'text',offset:40050,length:150});assert.equal(value.text,h.text.slice(40050,40200));assert.throws(()=>h.store.select({itemId:'p',field:'text',offset:40050,length:151}),/source_not_read/);
});
test('an unread dependent range rejects the whole delegation plan before dispatch',async()=>{
  const h=setup();await h.store.read({itemId:'p',field:'text',offset:40000,maxChars:100});
  await assert.rejects(h.delegation.execute([task(),task(50000,{id:'later',dependsOn:['tail']})]),/source_not_read/);assert.equal(h.metrics.modelCalls,0);assert.equal(h.checks,0);
});
test('raw source drift during direct analysis clears results before accepted progress',async()=>{
  let h;h=setup({complete:messages=>{h.page.fingerprint='changed';return quote(messages);}});await h.store.read({itemId:'p',field:'text',offset:40000,maxChars:100});
  await assert.rejects(h.analysis.execute([task()]),/source_changed/);assert.equal(h.analysis.progress(),0);assert.equal(h.analysis.context().length,0);
});
