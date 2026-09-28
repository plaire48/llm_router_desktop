import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentAnalysis} from '../worker/content-analysis.mjs';
import {createDocumentDelegation} from '../worker/document-delegation.mjs';
import {createActivityLog} from '../worker/activity.mjs';

const task=(id,dependsOn=[],extra={})=>({id,specialty:`${id} 담당`,goal:`${id} 검토`,role:'analysis',constraints:'원문으로 확인',doneWhen:'근거와 미확인을 구분',itemIds:['a'],dependsOn,...extra});
const response=messages=>{const data=JSON.parse(messages[1].content);return{calls:[],content:JSON.stringify({summary:data.goal,findings:[{text:'원문 내용',sources:[{itemId:'a',field:'text',quote:'검증된 문서 내용'}]}],missing:[]})};};
function setup(handler=response){
  const controller=new AbortController(),metrics={modelCalls:0},activity=createActivityLog(),workers=[];
  let model='qwen-selected',parent={request:'기존 문서 분석',requirements:['내용 근거 확인'],answers:[]},active=0,peak=0,checks=0,checker=()=>{};
  const page={host:'word',scopeId:'s',documentId:'d',fingerprint:'v1',total:1,offset:0,items:[{id:'a',text:'검증된 문서 내용'}]},pages=new Map([[0,page]]);
  const providers={status:()=>({provider:'aipro',model}),complete:async(...args)=>{assert.deepEqual(args[1],[]);active++;peak=Math.max(peak,active);try{return await handler(...args);}finally{active--;}}};
  const getTaskContext=()=>parent;
  const analysis=createContentAnalysis({host:'word',pages,providers,signal:controller.signal,activity,metrics,getTaskContext});
  const delegation=createDocumentDelegation({analysis,pages,providers,signal:controller.signal,getTaskContext,onWorkers:v=>workers.push(structuredClone(v)),checkSource:async()=>{assert.equal(active,0,'native check must wait for all branches');checks++;await checker();}});
  return{delegation,analysis,page,pages,metrics,workers,controller,get peak(){return peak;},get checks(){return checks;},model(v){model=v;},parent(v){parent=v;},checker(v){checker=v;}};
}

test('model-defined specialists run independent jobs in parallel and merge only after predecessor evidence',async()=>{
  const calls=[];const h=setup(async messages=>{
    const data=JSON.parse(messages[1].content);calls.push(data.goal);
    const delegated=JSON.parse(messages[2].content),deps=delegated.dependencies;
    assert.ok(['통합 검토자','양식 분석가','자료 검토자'].includes(delegated.specialty));
    if(data.goal==='merge 검토'){assert.deepEqual(deps.map(d=>d.id),['one','two']);assert.ok(deps.every(d=>d.findings[0].sources[0].fingerprint==='v1'));}
    await new Promise(resolve=>setTimeout(resolve,3));return response(messages);
  });
  const plan=[task('merge',['one','two'],{specialty:'통합 검토자'}),task('one',[],{specialty:'양식 분석가'}),task('two',[],{specialty:'자료 검토자'})];
  const result=await h.delegation.execute(plan);
  assert.equal(result.status,'analyzed');assert.equal(result.readOnly,true);assert.equal(result.advisory,true);assert.equal(h.peak,2);
  assert.deepEqual(calls,['one 검토','two 검토','merge 검토']);assert.equal(h.delegation.progress(),3);
  assert.ok(h.workers.some(nodes=>nodes.some(n=>n.state==='running'&&n.title==='자료 검토자')));
  assert.ok(h.workers.at(-1).every(n=>n.state==='done'));
  const rerun=await h.delegation.execute([...plan].reverse());assert.equal(rerun.planId,result.planId);assert.equal(h.metrics.modelCalls,3);assert.equal(h.delegation.progress(),3);
});

test('invalid DAGs and duplicate semantic tasks fail before any child model or native call',async()=>{
  for(const tasks of [[task('one',['missing'])],[task('one',['one'])],[task('one',['two']),task('two',['one'])],[task('one'),task('one')],[task('one'),task('two',[],{goal:'one 검토'})]]){
    const h=setup();await assert.rejects(h.delegation.execute(tasks),/tool_arguments_invalid/);assert.equal(h.metrics.modelCalls,0);assert.equal(h.checks,0);
  }
  const h=setup();await assert.rejects(h.delegation.execute([task('one'),task('two',[],{itemIds:['unknown']})]),/source_not_read/);assert.equal(h.metrics.modelCalls,0);
});

test('renaming task IDs and reordering the graph cannot manufacture accepted work progress',async()=>{
  const h=setup();
  const plan=[task('one',[],{specialty:'자료 분석'}),task('two',[],{specialty:'양식 검토'}),task('merge',['one','two'],{specialty:'통합 검토'})];
  await h.delegation.execute(plan);assert.equal(h.delegation.progress(),3);
  const renamedIds={one:'renamedA',two:'renamedB',merge:'renamedMerge'};
  const renamed=plan.map(node=>({...node,id:renamedIds[node.id],dependsOn:node.dependsOn.map(id=>renamedIds[id]).reverse()})).reverse();
  await h.delegation.execute(renamed);assert.equal(h.metrics.modelCalls,6);assert.equal(h.delegation.progress(),3);
  await h.delegation.execute([...renamed].reverse());assert.equal(h.metrics.modelCalls,6);assert.equal(h.delegation.progress(),3);
  const changed=renamed.map(node=>node.id==='renamedMerge'?{...node,doneWhen:'추가 요구사항까지 검증'}:node);
  await h.delegation.execute(changed);assert.equal(h.delegation.progress(),4);
});

test('partial predecessor remains unknown and blocks descendants without repeated optimistic regeneration',async()=>{
  const h=setup(messages=>{const result=response(messages),report=JSON.parse(result.content);if(report.summary==='source 검토')report.missing=['매출 기준이 입력되지 않았습니다.'];return{...result,content:JSON.stringify(report)};});
  const plan=[task('source'),task('dependent',['source']),task('final',['dependent']),task('independent')];
  const result=await h.delegation.execute(plan);
  assert.equal(result.status,'incomplete');assert.equal(result.results[0].reportStatus,'partial');assert.equal(result.results[1].status,'blocked');assert.equal(result.results[2].status,'blocked');assert.equal(result.results[3].reportStatus,'complete');
  assert.ok(result.results[2].missing.includes('매출 기준이 입력되지 않았습니다.'));
  assert.equal(h.metrics.modelCalls,2);assert.equal(h.delegation.progress(),1);
  await h.delegation.execute(plan);assert.equal(h.metrics.modelCalls,2);assert.equal(h.delegation.progress(),1);
  assert.equal(h.analysis.progress(),0);assert.deepEqual(h.analysis.context(),[]);
  assert.ok(h.delegation.context()[0].results.some(r=>r.missing.includes('매출 기준이 입력되지 않았습니다.')));
});

test('failed specialist retries alone; accepted independent result remains reusable',async()=>{
  let fails=true;const counts={};const h=setup(messages=>{const goal=JSON.parse(messages[1].content).goal;counts[goal]=(counts[goal]??0)+1;if(goal==='flaky 검토'&&fails){fails=false;throw new Error('upstream');}return response(messages);});
  const plan=[task('flaky'),task('stable'),task('merge',['flaky','stable'])];
  assert.equal((await h.delegation.execute(plan)).status,'incomplete');assert.equal(h.delegation.progress(),1);
  const result=await h.delegation.execute(plan);assert.equal(result.status,'analyzed');assert.equal(h.delegation.progress(),3);assert.deepEqual(counts,{'flaky 검토':2,'stable 검토':1,'merge 검토':1});
});

test('same plan is bound to raw sources, model and original parent requirements',async()=>{
  const h=setup(),plan=[task('one')];await h.delegation.execute(plan);
  h.model('other-qwen');await h.delegation.execute(plan);
  h.parent({request:'새 요청',requirements:['추가 조건'],answers:[]});await h.delegation.execute(plan);
  h.page.fingerprint='v2';await h.delegation.execute(plan);
  assert.equal(h.metrics.modelCalls,4);assert.equal(h.delegation.context()[0].results[0].findings[0].sources[0].fingerprint,'v2');
});

test('native source rejection after settled calls clears results and prevents dependent work',async()=>{
  const h=setup();h.checker(()=>{if(h.checks===2)throw new Error('document_conflict');});
  await assert.rejects(h.delegation.execute([task('one'),task('two',['one'])]),/document_conflict/);
  assert.equal(h.metrics.modelCalls,1);assert.equal(h.delegation.progress(),0);assert.deepEqual(h.delegation.context(),[]);assert.ok(h.workers.at(-1).every(n=>n.state==='unconfirmed'));
});

test('provider change during a child call prevents stale cache, progress and dependent dispatch',async()=>{
  let h;h=setup(messages=>{h.model('changed-in-flight');return response(messages);});
  await assert.rejects(h.delegation.execute([task('one'),task('two',['one'])]),/analysis_invalid/);
  assert.equal(h.metrics.modelCalls,1);assert.equal(h.delegation.progress(),0);assert.deepEqual(h.delegation.context(),[]);
});

test('cancellation fences late child replies and never invokes dependent work',async()=>{
  let started,resolve;const ready=new Promise(r=>{started=r;});const h=setup(messages=>new Promise(r=>{resolve=()=>r(response(messages));started();}));
  const pending=h.delegation.execute([task('one'),task('two',['one'])]);const rejected=assert.rejects(pending,/cancelled/);await ready;h.controller.abort();await rejected;resolve();await new Promise(r=>setImmediate(r));assert.equal(h.metrics.modelCalls,1);assert.equal(h.delegation.progress(),0);
});

test('delegated source parser retains missing predecessor facts even when child omits them',async()=>{
  const h=setup();const result=await h.analysis.execute([task('one')],{delegation:{planKey:'trusted-parent',attempt:1,dependencies:[[{id:'prior',missing:['아직 검증하지 못한 사실']}]]}});
  assert.equal(result.results[0].reportStatus,'partial');assert.deepEqual(result.results[0].missing,['아직 검증하지 못한 사실']);
  assert.equal(h.analysis.progress(),0);
  await h.analysis.execute([task('one')]);assert.equal(h.analysis.progress(),1);assert.equal(h.analysis.context().length,1);
});

test('eight ready tasks reuse four-job batches and the two-call scheduler',async()=>{
  const h=setup(async messages=>{await new Promise(r=>setTimeout(r,2));return response(messages);});
  const result=await h.delegation.execute(Array.from({length:8},(_,i)=>task(`worker${i}`)));
  assert.equal(result.status,'analyzed');assert.equal(h.peak,2);assert.equal(h.metrics.modelCalls,8);assert.equal(h.checks,4);
});

test('rate limiting stops later graph batches and preserves Retry-After for the parent recovery owner',async()=>{
  const h=setup(()=>{throw Object.assign(new Error('rate_limited'),{status:429,retryAfterMs:5000});});
  const result=await h.delegation.execute(Array.from({length:8},(_,i)=>task(`worker${i}`)));
  assert.equal(result.status,'incomplete');assert.equal(result.retryAfterMs,5000);assert.equal(h.metrics.modelCalls,1);assert.equal(h.delegation.progress(),0);
  assert.equal(result.results.at(-1).status,'blocked');assert.match(result.results.at(-1).missing[0],/아직 실행/);
});

test('retained context uses whole reports within budget and identifies omitted task reports',async()=>{
  const h=setup(messages=>{const result=response(messages),report=JSON.parse(result.content);report.findings=Array.from({length:8},()=>({text:'근'.repeat(500),sources:[{itemId:'a',field:'text',quote:'검증된 문서 내용'}]}));return{...result,content:JSON.stringify(report)};});
  await h.delegation.execute(Array.from({length:8},(_,i)=>task(`worker${i}`)));
  const context=h.delegation.context();assert.ok(JSON.stringify(context).length<=16000);assert.ok(context[0].omittedTaskIds.length>0);assert.ok(context[0].results.every(report=>report.findings.length===8));
  context[0].results[0].findings[0].text='mutated';assert.notEqual(h.delegation.context()[0].results[0].findings[0].text,'mutated');
});

test('permanent sibling failure preserves verified successful work for parent-owned recovery',async()=>{
  let broken=true;const counts={};const h=setup(async messages=>{const goal=JSON.parse(messages[1].content).goal;counts[goal]=(counts[goal]??0)+1;await new Promise(r=>setImmediate(r));if(goal==='bad 검토'&&broken)throw Object.assign(new Error('unauthorized'),{status:401});return response(messages);});
  const plan=[task('bad'),task('good'),task('merge',['bad','good'])];
  await assert.rejects(h.delegation.execute(plan),/unauthorized/);assert.equal(h.delegation.progress(),1);assert.equal(h.delegation.context()[0].results[0].id,'good');
  broken=false;await h.delegation.execute(plan);assert.deepEqual(counts,{'bad 검토':2,'good 검토':1,'merge 검토':1});
});

test('omitted document reports and original graph contracts remain retrievable without another model call',async()=>{
  const h=setup(messages=>{const reply=response(messages),report=JSON.parse(reply.content);if(report.summary==='task0 검토')report.missing=['사업부 예산 상한이 미정입니다.'];return{...reply,content:JSON.stringify(report)};});
  const tasks=Array.from({length:8},(_,i)=>task(`task${i}`));const result=await h.delegation.execute(tasks),context=h.delegation.context()[0];
  assert.equal(context.nodes.length,8);assert.deepEqual(context.nodes[0].missing,['사업부 예산 상한이 미정입니다.']);assert.ok(context.omittedTaskIds.includes('task0'));assert.ok(JSON.stringify([context]).length<=15000);
  const recovered=await h.delegation.read({planId:result.planId,taskIds:['task0']});assert.deepEqual(recovered.tasks[0].task,tasks[0]);assert.deepEqual(recovered.tasks[0].result.missing,['사업부 예산 상한이 미정입니다.']);assert.equal(h.metrics.modelCalls,8);
  h.checker(()=>{throw new Error('source_changed');});await assert.rejects(h.delegation.read({planId:result.planId,taskIds:['task0']}),/source_changed/);assert.deepEqual(h.delegation.context(),[]);
});

test('failed batch siblings are not retained when native evidence changed before recovery',async()=>{
  const h=setup(async messages=>{await new Promise(r=>setImmediate(r));if(JSON.parse(messages[1].content).goal==='bad 검토')throw Object.assign(new Error('unauthorized'),{status:401});return response(messages);});
  h.checker(()=>{if(h.checks===2)throw new Error('source_changed');});await assert.rejects(h.delegation.execute([task('bad'),task('good')]),/source_changed/);assert.equal(h.delegation.progress(),0);assert.deepEqual(h.delegation.context(),[]);
});
