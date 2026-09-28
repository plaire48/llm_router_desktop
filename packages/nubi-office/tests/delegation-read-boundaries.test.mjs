import test from 'node:test';
import assert from 'node:assert/strict';
import {createContentAnalysis} from '../worker/content-analysis.mjs';
import {createDocumentDelegation} from '../worker/document-delegation.mjs';
import {createActivityLog} from '../worker/activity.mjs';

const missingFact='사업부 예산 상한이 미정입니다.';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
function fixture(){
  const page={host:'word',scopeId:'s',documentId:'d',fingerprint:'f',total:1,offset:0,items:[{id:'a',text:'evidence'}]};
  const pages=new Map([[0,page]]),controller=new AbortController();
  let model='selected-model',calls=0,sourceCheck=()=>{};
  const providers={status:()=>({provider:'aipro',model}),complete:async messages=>{
    calls++;const {goal}=JSON.parse(messages[1].content);
    return{calls:[],content:JSON.stringify({summary:goal,findings:[{text:'Observed evidence',sources:[{itemId:'a',field:'text',quote:'evidence'}]}],missing:goal==='task0'?[missingFact]:[]})};
  }};
  const signal=controller.signal;
  const analysis=createContentAnalysis({host:'word',pages,providers,signal,activity:createActivityLog(),metrics:{modelCalls:0}});
  const delegation=createDocumentDelegation({analysis,pages,providers,signal,checkSource:async()=>sourceCheck()});
  const tasks=Array.from({length:8},(_,i)=>({id:`task${i}`,specialty:`role${i}`,goal:`task${i}`,role:'analysis',constraints:'Use assigned evidence',doneWhen:'Separate evidence and missing facts',itemIds:['a'],dependsOn:[]}));
  return{delegation,tasks,controller,page,setModel:value=>{model=value;},setChecker:checker=>{sourceCheck=checker;},get calls(){return calls;}};
}

test('omitted partial report keeps uncertainty visible after another report becomes current',async()=>{
  const f=fixture(),result=await f.delegation.execute(f.tasks);
  const other=await f.delegation.read({planId:result.planId,taskIds:['task7']});
  assert.equal(other.tasks[0].result.reportStatus,'complete');
  const context=f.delegation.context()[0];
  assert.ok(context.omittedTaskIds.includes('task0'));
  assert.deepEqual(context.nodes.find(node=>node.id==='task0').missing,[missingFact]);
  assert.equal(context.nodes.find(node=>node.id==='task0').state,'waiting');
  const recovered=await f.delegation.read({planId:context.planId,taskIds:['task0']});
  assert.deepEqual(recovered.tasks[0].task,f.tasks[0]);
  assert.deepEqual(recovered.tasks[0].result.missing,[missingFact]);
  assert.equal(f.calls,8,'report navigation must not run the model again');
});

test('read results cannot mutate retained task contracts, findings or missing facts',async()=>{
  const f=fixture(),result=await f.delegation.execute(f.tasks);
  const args={planId:result.planId,taskIds:['task0']},first=await f.delegation.read(args);
  first.tasks[0].task.itemIds.push('forged');first.tasks[0].task.goal='changed';
  first.tasks[0].result.missing[0]='removed uncertainty';
  first.tasks[0].result.findings[0].sources[0].quote='forged quote';
  const reread=await f.delegation.read(args);
  assert.deepEqual(reread.tasks[0].task,f.tasks[0]);
  assert.deepEqual(reread.tasks[0].result.missing,[missingFact]);
  assert.equal(reread.tasks[0].result.findings[0].sources[0].quote,'evidence');
  assert.equal(f.calls,8);
});

for(const target of ['source','model'])for(const timing of ['before','during'])test(`read rejects ${target} changes ${timing} native verification`,async()=>{
  const f=fixture(),result=await f.delegation.execute([f.tasks[1]]);
  const change=()=>{if(target==='source')f.page.fingerprint='changed';else f.setModel('different-model');};
  const args={planId:result.planId,taskIds:['task1']};
  let pending;
  if(timing==='before'){
    change();pending=f.delegation.read(args);
  }else{
    const started=deferred(),release=deferred();
    f.setChecker(async()=>{started.resolve();await release.promise;});
    pending=f.delegation.read(args);
    await started.promise;change();release.resolve();
  }
  await assert.rejects(pending,/analysis_invalid/);
  assert.deepEqual(f.delegation.context(),[]);
  assert.equal(f.calls,1,'invalidated reports must not trigger model retries');
});

test('cancellation fences a late successful native verification without returning a retained report',async()=>{
  const f=fixture(),result=await f.delegation.execute([f.tasks[1]]);
  const started=deferred(),release=deferred();
  f.setChecker(async()=>{started.resolve();await release.promise;});
  const pending=f.delegation.read({planId:result.planId,taskIds:['task1']});
  const rejection=assert.rejects(pending,/cancelled/);
  await started.promise;f.controller.abort();release.resolve();await rejection;
  assert.throws(()=>f.delegation.context(),/cancelled/);
  assert.equal(f.calls,1);
});

test('native verification failure clears retained reports and never falls back to cached success',async()=>{
  const f=fixture(),result=await f.delegation.execute([f.tasks[1]]);
  const args={planId:result.planId,taskIds:['task1']};
  f.setChecker(()=>{throw new Error('source_changed');});
  await assert.rejects(f.delegation.read(args),/source_changed/);
  assert.deepEqual(f.delegation.context(),[]);
  f.setChecker(()=>{});
  await assert.rejects(f.delegation.read(args),/source_not_read/);
  assert.equal(f.calls,1);
});
