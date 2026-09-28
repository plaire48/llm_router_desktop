import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentAnalysis} from '../worker/content-analysis.mjs';
import {createActivityLog} from '../worker/activity.mjs';

const response=messages=>{const {goal,sources}=JSON.parse(messages[1].content);return{calls:[],content:JSON.stringify({summary:goal,findings:[{text:'지정한 원문에 기재된 내용',sources:[{itemId:sources[0].item.id,field:'text',quote:sources[0].item.text}]}],missing:[]})};};
function setup(complete=response,host='word'){
  const controller=new AbortController(),metrics={modelCalls:0,usage:[]},activity=createActivityLog();let model='selected-qwen',provider='aipro';
  const page={host,scopeId:'scope',documentId:'doc',fingerprint:'v1',total:2,offset:0,nextOffset:null,items:[{id:'a',text:'원본 사업부 A'},{id:'b',text:'원본 사업부 B'}]},pages=new Map([[0,page]]);
  const providers={status:()=>({provider,model}),complete:async(...args)=>complete(...args)};
  const analysis=createContentAnalysis({host,pages,providers,signal:controller.signal,activity,metrics,timeoutMs:30});
  return{analysis,pages,page,metrics,controller,activity,model(v){model=v;},provider(v){provider=v;}};
}
const task=(goal='내용 확인',itemIds=['a'])=>({goal,itemIds,role:'review',constraints:'원문에 없는 수치를 만들지 않는다',doneWhen:'기재된 사실과 부족한 정보를 구분한다'});
test('Word/PPT branches receive isolated assigned items, no tools, and exact grounded citations',async()=>{
  for(const host of ['word','powerpoint']){
    let active=0,peak=0;const h=setup(async(messages,tools)=>{assert.deepEqual(tools,[]);const data=JSON.parse(messages[1].content);assert.equal(data.sources.length,1);assert.equal(data.role,'review');assert.equal(data.constraints,task().constraints);assert.equal(data.doneWhen,task().doneWhen);active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;return response(messages);},host);
    const result=await h.analysis.execute([task('A 분석'),task('B 분석',['b'])]);
    assert.equal(peak,2);assert.equal(result.readOnly,true);assert.equal(result.advisory,true);
    assert.equal(result.results[0].findings[0].sources[0].fingerprint,'v1');assert.equal(result.results[0].findings[0].sources[0].quote,'원본 사업부 A');
    assert.deepEqual(h.analysis.context()[0].findings,result.results[0].findings);assert.equal(h.analysis.progress(),2);
  }
});
test('unread item IDs and oversized sources reject the whole batch before dispatch',async()=>{
  const h=setup();await assert.rejects(h.analysis.execute([task(),task('미관찰',['invented'])]),/source_not_read/);assert.equal(h.metrics.modelCalls,0);
  h.page.items[0].text='x'.repeat(33000);await assert.rejects(h.analysis.execute([task()]),/context_range_limit/);assert.equal(h.metrics.modelCalls,0);
});
test('forged citations, unrelated quotes, truncation and child tools cannot become analysis evidence',async()=>{
  for(const mutate of [r=>r.findings[0].sources[0].itemId='b',r=>r.findings[0].sources[0].quote='위조된 인용',r=>r.findings[0].sources[0].field='__proto__']){
    const h=setup(messages=>{const r=response(messages),data=JSON.parse(r.content);mutate(data);return{...r,content:JSON.stringify(data)};});
    const result=await h.analysis.execute([task()]);assert.equal(result.status,'incomplete');assert.equal(result.results[0].error,'analysis_invalid');assert.equal(h.analysis.context().length,0);
  }
  for(const extra of [{finishReason:'length'},{calls:[{name:'office_apply'}]}]){
    const h=setup(m=>({...response(m),...extra}));assert.equal((await h.analysis.execute([task()])).status,'incomplete');
  }
});
test('brief, model and exact source revisions bind cache; reordered sources reuse it',async()=>{
  const h=setup(),t=task('비교',['a','b']);await h.analysis.execute([t]);
  assert.equal((await h.analysis.execute([{...t,itemIds:['b','a']}])).results[0].cached,true);assert.equal(h.analysis.progress(),1);
  for(const changed of [{...t,constraints:'새 조건'},{...t,doneWhen:'새 완료 기준'},{...t,role:'analysis'}])await h.analysis.execute([changed]);
  h.model('different-model');await h.analysis.execute([t]);h.page.fingerprint='v2';await h.analysis.execute([t]);h.page.items[0].text='변경된 원문';await h.analysis.execute([t]);
  assert.equal(h.metrics.modelCalls,7);h.analysis.clear();assert.equal(h.analysis.context().length,0);
});
test('partial reports retain missing facts and successful branches survive retry',async()=>{
  let failed=false;const h=setup(messages=>{const data=JSON.parse(messages[1].content);if(data.goal==='B'&&!failed){failed=true;throw new Error('upstream');}const r=response(messages);const report=JSON.parse(r.content);report.missing=['확인하지 못한 기준'];return{...r,content:JSON.stringify(report)};});
  const tasks=[task('A'),task('B',['b'])];assert.equal((await h.analysis.execute(tasks)).status,'incomplete');
  const result=await h.analysis.execute(tasks);assert.equal(result.results[0].cached,true);assert.equal(result.results[0].reportStatus,'partial');assert.equal(h.metrics.modelCalls,3);
});
test('native scope/revision mismatch and duplicate item IDs are rejected',async()=>{
  for(const extra of [{fingerprint:'v2',items:[{id:'c',text:'다른 버전'}]},{scopeId:'foreign',items:[{id:'c',text:'다른 범위'}]},{items:[{id:'a',text:'중복'}]}]){
    const h=setup();h.pages.set(40,{...h.page,offset:40,...extra});await assert.rejects(h.analysis.execute([task()]),/observation_invalid/);assert.equal(h.metrics.modelCalls,0);
  }
});
test('cancellation and timeout fence ignored-abort late results without recording success',{timeout:1000},async()=>{
  let resolve,ready;const started=new Promise(r=>{ready=r;});const h=setup(()=>new Promise(r=>{resolve=r;ready();}));const pending=h.analysis.execute([task()]);const reject=assert.rejects(pending,/cancelled/);await started;h.controller.abort();await reject;resolve({content:'late',calls:[]});await new Promise(r=>setImmediate(r));assert.equal(h.analysis.context().length,0);
  const timeout=setup(()=>new Promise(()=>{}));const result=await timeout.analysis.execute([task()]);assert.equal(result.results[0].error,'model_timeout');assert.equal(timeout.analysis.context().length,0);
});
test('ChatGPT serializes child calls and 429 suppresses new queued dispatch',async()=>{
  let active=0,peak=0;const serial=setup(async m=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;return response(m);});serial.provider('chatgpt');
  await serial.analysis.execute([task('A'),task('B')]);assert.equal(peak,1);
  let calls=0;const h=setup(m=>{if(++calls===1)throw Object.assign(new Error('rate_limited'),{status:429,retryAfterMs:4321});return response(m);});
  const result=await h.analysis.execute(['A','B','C','D'].map(goal=>task(goal)));assert.equal(calls,1);assert.equal(result.retryAfterMs,4321);assert.equal(result.results[0].status,'failed');assert.equal(result.results[0].httpStatus,429);
});

test('an optimistic model cannot erase the uncertainty of truncated native text from advisory reports',async()=>{
  const h=setup();h.page.items[0].truncated=true;h.page.items[0].textLength=5000;
  const result=await h.analysis.execute([task()]);
  assert.equal(result.results[0].status,'analyzed');assert.equal(result.results[0].reportStatus,'partial');
  assert.match(result.results[0].missing.at(-1),/잘려/);
  assert.equal(result.results[0].findings[0].sources[0].quote,h.page.items[0].text);
  const cached=await h.analysis.execute([task()]);assert.equal(cached.results[0].cached,true);assert.equal(cached.results[0].reportStatus,'partial');
});
test('direct analysis rechecks native source after models settle and rejects model changes during recheck',async()=>{
  let reads=0,model='qwen';const controller=new AbortController(),pages=new Map([[0,{host:'word',scopeId:'s',documentId:'d',fingerprint:'f',total:1,offset:0,items:[{id:'a',text:'근거'}]}]]),metrics={modelCalls:0};
  const analysis=createContentAnalysis({host:'word',pages,signal:controller.signal,activity:createActivityLog(),metrics,providers:{status:()=>({provider:'aipro',model}),complete:async messages=>response(messages)},checkSource:async()=>{if(++reads===2)model='changed';}});
  await assert.rejects(analysis.execute([task()]),/analysis_invalid/);assert.equal(reads,2);assert.equal(analysis.progress(),0);assert.equal(analysis.context().length,0);
});
