import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisTaskContext,createAnalysisJobs} from '../worker/analysis-jobs.mjs';
const skill=(instructions='금액은 천 원 단위. 승인 없는 저장 금지.',revision=1)=>({id:'skill-a',name:'기업 보고서',revision,instructions,previousAnswers:[{question:'부서 코드',text:'000417'}],token:'must-not-cross',files:['unrelated-source']});
const task=activeSkills=>({request:'보고서 검토',requirements:['단위 확인'],answers:[],activeSkills});
const makeJob=()=>({key:'fixed-source',goal:'같은 표 검토',brief:{goal:'같은 표 검토'},messages:[{role:'system',content:'Read-only source review.'}],parse:()=>({summary:'원문 확인',missing:[]})});
function harness(parent,handler=async()=>({content:'ok'})){
  const calls=[],controller=new AbortController();
  const jobs=createAnalysisJobs({providers:{status:()=>({provider:'aipro',model:'qwen-test'}),complete:async(messages,tools,signal)=>{assert.deepEqual(tools,[]);calls.push(messages);return handler(messages,signal);}},signal:controller.signal,activity:{start:()=>({}),end(){}},metrics:{modelCalls:0},getTaskContext:()=>parent.value});
  return{jobs,calls,controller};
}
test('child receives exact active skill rules and separately identified prior answers, excluding unrelated fields',()=>{
  const source=skill(),packet=analysisTaskContext(task([source]));
  assert.equal(packet.activeSkills[0].instructions,source.instructions);
  assert.equal(packet.activeSkills[0].previousAnswers[0].text,'000417');
  assert.match(packet.activeSkills[0].instructionsSha256,/^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(packet),/must-not-cross|unrelated-source/);
  assert.match(packet.guidance,/not current-task facts/);
});
test('new activation, revised rules and removal invalidate prior child results even when the plan is unchanged',async()=>{
  const parent={value:task([])},h=harness(parent),job=makeJob();
  await h.jobs.run([job]);await h.jobs.run([job]);assert.equal(h.calls.length,1);
  parent.value=task([skill()]);await h.jobs.run([job]);assert.equal(h.calls.length,2);
  parent.value=task([skill('금액은 원 단위.',2)]);await h.jobs.run([job]);assert.equal(h.calls.length,3);
  parent.value=task([]);await h.jobs.run([job]);assert.equal(h.calls.length,4);
});
test('a skill change while a child is running fences its late result',async()=>{
  let release,started;const ready=new Promise(resolve=>{started=resolve;}),late=new Promise(resolve=>{release=resolve;});
  const parent={value:task([skill()])},h=harness(parent,async()=>{started();return late;});
  const pending=h.jobs.run([makeJob()]);await ready;
  parent.value=task([skill('変更後の規則',2)]);release({content:'old result'});
  await assert.rejects(pending,/analysis_invalid/);assert.deepEqual(h.jobs.context(),[]);
});
test('oversized or malformed active rules never dispatch a child or silently drop constraints',async()=>{
  for(const skills of [[skill('x'.repeat(60001))],[skill('',1)],[skill('text',0)],[skill(),skill()]]){
    const h=harness({value:task(skills)});await assert.rejects(h.jobs.run([makeJob()]),/tool_arguments_invalid|context_range_limit/);assert.equal(h.calls.length,0);
  }
});

test('skill content and prior answer changes invalidate results without trusting revision alone',async()=>{
  const parent={value:task([skill()])},h=harness(parent);
  await h.jobs.run([makeJob()]);
  parent.value=task([skill('수정된 단위 규칙')]);await h.jobs.run([makeJob()]);
  parent.value.activeSkills[0].previousAnswers[0].text='000418';await h.jobs.run([makeJob()]);
  assert.equal(h.calls.length,3);
});
test('aggregate skill overflow clears retained reports without stopping parent context reconstruction',async()=>{
  const parent={value:task([skill()])},h=harness(parent);
  await h.jobs.run([makeJob()]);assert.equal(h.jobs.context().length,1);
  parent.value=task([skill('a'.repeat(50000)),{...skill('b'.repeat(40000)),id:'skill-b'}]);
  await assert.rejects(h.jobs.run([makeJob()]),/context_range_limit/);
  assert.deepEqual(h.jobs.context(),[]);assert.equal(h.calls.length,1);
  parent.value=task([skill()]);await h.jobs.run([makeJob()]);assert.equal(h.calls.length,2);
});
