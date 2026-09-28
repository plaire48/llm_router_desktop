import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftSpecialists} from '../worker/draft-specialists.mjs';
import {createActivityLog} from '../worker/activity.mjs';

const task=(id,dependsOn=[],extra={})=>({id,specialty:id,goal:`Draft ${id}`,role:'analysis',constraints:'Preserve supplied facts',doneWhen:'Return a bounded candidate',sheetNames:['보고서'],dependsOn,...extra});
const proposal=value=>({summary:'작성 제안',proposals:[{name:'보고서',address:'A1:B2',cells:[{address:'A1',value}]}],missing:[]});
const text=value=>({content:JSON.stringify(value),calls:[],finishReason:'stop'});
function fixture(complete){
  const controller=new AbortController(),nodes=[],calls=[];
  let snapshot={task:{requirements:[{id:'r1',text:'보고서 작성'}],sheets:[{name:'보고서',purpose:'내용',requirementIds:['r1']}]},drafts:[null]},answers=[],model='selected-catalog-id';
  const run=createDraftSpecialists({signal:controller.signal,activity:createActivityLog(),metrics:{modelCalls:0},getSnapshot:()=>snapshot,getTaskContext:()=>({request:'보고서 작성',requirements:snapshot.task.requirements.map(r=>r.text),answers}),onWorkers:value=>nodes.push(structuredClone(value)),providers:{status:()=>({provider:'aipro',model}),complete:async(messages,tools,signal)=>{assert.deepEqual(tools,[]);const payload=JSON.parse(messages[1].content);calls.push(payload);return complete?complete(payload,signal):text(proposal(payload.task.id));}}});
  return{run,calls,nodes,controller,setSnapshot:value=>{snapshot=value;},snapshot:()=>structuredClone(snapshot),setAnswers:value=>{answers=value;},setModel:value=>{model=value;}};
}

test('draft DAG receives actual bounded predecessor proposals and reuses completed siblings',async()=>{
  let active=0,peak=0;
  const f=fixture(async payload=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setImmediate(resolve));active--;return text(proposal(payload.task.id));});
  const tasks=[task('content'),task('format'),task('combine',['content','format'])];
  const first=await f.run.execute(tasks);
  assert.equal(first.status,'analyzed');assert.equal(peak,2);assert.equal(f.calls.length,3);
  const merge=f.calls.find(call=>call.task.id==='combine');assert.deepEqual(merge.dependencies.map(d=>d.proposals[0].cells[0].value),['content','format']);
  const read=await f.run.read({planId:first.planId,taskIds:['combine']});assert.equal(read.tasks[0].result.proposals[0].cells[0].value,'combine');
  await f.run.execute(tasks);assert.equal(f.calls.length,3);assert.equal(f.run.progress(),3);
  assert.ok(f.nodes.some(nodes=>nodes.some(node=>node.state==='running')));assert.ok(f.nodes.at(-1).every(node=>node.state==='done'));
});

test('semantic partial remains visible, blocks dependent drafting and is not blindly retried',async()=>{
  const f=fixture(async payload=>text(payload.task.id==='facts'?{summary:'예산 금액 필요',proposals:[],missing:['예산 금액을 알려주세요.']}:proposal(payload.task.id)));
  const tasks=[task('facts'),task('independent'),task('final',['facts'])];
  const result=await f.run.execute(tasks);assert.equal(result.status,'incomplete');assert.equal(f.calls.length,2);
  assert.equal(result.results[2].status,'blocked');assert.ok(result.results[2].missing.includes('예산 금액을 알려주세요.'));
  await f.run.execute(tasks);assert.equal(f.calls.length,2);assert.equal(f.run.progress(),1);
  f.setAnswers([{question:'예산 금액',text:'100'}]);await f.run.execute(tasks);assert.equal(f.calls.length,4);
});

test('changed draft or selected model invalidates retained candidate retrieval',async()=>{
  for(const change of ['draft','model']){
    const f=fixture();const result=await f.run.execute([task('content')]);
    if(change==='draft'){const snapshot=f.snapshot();snapshot.drafts[0]=proposal('사용자 수정').proposals[0];f.setSnapshot(snapshot);}else f.setModel('other-catalog-id');
    await assert.rejects(f.run.read({planId:result.planId,taskIds:['content']}),/analysis_invalid/);assert.equal(f.calls.length,1);assert.deepEqual(f.run.context(),[]);
  }
});

test('draft update during a child call rejects late results and never overwrites the draft',async()=>{
  let release;const f=fixture(async()=>{await new Promise(resolve=>{release=resolve;});return text(proposal('late'));});
  const pending=f.run.execute([task('content')]);while(!release)await new Promise(resolve=>setImmediate(resolve));
  const newer=f.snapshot();newer.drafts[0]=proposal('newer').proposals[0];f.setSnapshot(newer);release();
  await assert.rejects(pending,/analysis_invalid/);assert.equal(f.snapshot().drafts[0].cells[0].value,'newer');assert.equal(f.run.progress(),0);
});

test('cancellation aborts the child and admits no completed proposal',async()=>{
  let started;const ready=new Promise(resolve=>{started=resolve;});
  const f=fixture(async(payload,signal)=>{started();await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));});
  const pending=f.run.execute([task('content')]);await ready;f.controller.abort();await assert.rejects(pending,/cancelled/);assert.equal(f.run.progress(),0);
});

test('specialists reject unsupported targets and invalid or excessive sheet proposals',async()=>{
  const f=fixture();await assert.rejects(f.run.execute([task('invalid',[],{sheetNames:['Other']})]),/source_not_read/);assert.equal(f.calls.length,0);
  for(const change of [sheet=>{sheet.name='Other';},sheet=>{sheet.cells=Array.from({length:25},(_,i)=>({address:`A${i+1}`,value:i}));sheet.address='A1:B25';},sheet=>{sheet.cells[0]={address:'A1',formula:'=WEBSERVICE("https://example.org")'};}]){
    const result=proposal('value');change(result.proposals[0]);const candidate=fixture(async()=>text(result));const response=await candidate.run.execute([task('content')]);assert.equal(response.status,'incomplete');assert.equal(response.results[0].status,'failed');assert.equal(candidate.run.progress(),0);
  }
});

test('cyclic or unknown dependency graphs dispatch no model call',async()=>{
  const f=fixture();for(const tasks of [[task('a',['b']),task('b',['a'])],[task('a',['unknown'])]])await assert.rejects(f.run.execute(tasks),/tool_arguments_invalid/);assert.equal(f.calls.length,0);
});

test('transient child failure retains successful sibling and retries only failed work',async()=>{
  let failed=false;const f=fixture(async payload=>{if(payload.task.id==='format'&&!failed){failed=true;throw new Error('model_timeout');}return text(proposal(payload.task.id));});
  const tasks=[task('content'),task('format'),task('combine',['content','format'])];
  const first=await f.run.execute(tasks);assert.equal(first.status,'incomplete');assert.equal(first.results[0].status,'analyzed');
  const second=await f.run.execute(tasks);assert.equal(second.status,'analyzed');assert.equal(f.calls.filter(call=>call.task.id==='content').length,1);assert.equal(f.calls.filter(call=>call.task.id==='format').length,2);assert.equal(f.run.progress(),3);
});
