import test from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisJobs,analysisTaskContext} from '../worker/analysis-jobs.mjs';
import {createActivityLog} from '../worker/activity.mjs';

const report={summary:'확인된 원문',findings:[{text:'원문 관찰',sources:['observed-1']}],missing:[]};
const job=(goal='분석')=>({key:goal,goal,brief:{goal,role:'review'},tool:'analyze_document',messages:[{role:'system',content:'Assigned sources only'},{role:'user',content:'source-data'}],parse:()=>structuredClone(report)});
function setup(complete=async()=>({content:'fixture'})){
  const parent={request:'수식을 보존하고 성적표를 분석해줘',requirements:['등급 기준을 추측하지 않는다'],answers:[{question:'점수 단위는?',text:'100점 만점'}]};
  const state={provider:'aipro',model:'catalog-qwen'},controller=new AbortController(),metrics={modelCalls:0},calls=[];
  const scheduler=createAnalysisJobs({providers:{status:()=>({...state}),complete:(...args)=>{calls.push(args);return complete(...args);}},getTaskContext:()=>parent,signal:controller.signal,activity:createActivityLog(),metrics,timeoutMs:1000,maxConcurrency:1});
  return{scheduler,parent,state,controller,calls,metrics};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('subagents receive exact parent requirements and confirmed answers without unrelated parent fields',async()=>{
  const h=setup();h.parent.credentials='must not be copied';h.parent.history=['unrelated'];
  const prepared=job();await h.scheduler.run([prepared]);
  const [messages,tools]=h.calls[0],packet=JSON.parse(messages.at(-1).content);
  assert.deepEqual(tools,[]);assert.equal(prepared.messages.length,2);
  assert.equal(packet.request,h.parent.request);assert.deepEqual(packet.requirements,h.parent.requirements);assert.deepEqual(packet.answers,h.parent.answers);
  assert.equal(packet.credentials,undefined);assert.equal(packet.history,undefined);
  assert.match(packet.guidance,/Other history, skill reference files and native receipts are not included/);
});
test('new user answers invalidate analysis reuse and reconstructed context preserves only the current basis',async()=>{
  const h=setup();await h.scheduler.run([job()]);assert.equal((await h.scheduler.run([job()])).results[0].cached,true);
  h.parent.answers.push({question:'변경된 점수 단위는?',text:'200점 만점'});
  assert.deepEqual(h.scheduler.context(),[]);
  assert.equal((await h.scheduler.run([job()])).results[0].cached,undefined);assert.equal(h.calls.length,2);
  const snapshot=h.scheduler.context();snapshot[0].summary='tampered';assert.equal(h.scheduler.context()[0].summary,report.summary);
  h.parent.requirements.push('합계는 200점 기준');assert.deepEqual(h.scheduler.context(),[]);
});
test('an answer changing during analysis rejects late findings and never dispatches queued children',async()=>{
  let release;const h=setup(()=>new Promise(resolve=>{release=resolve;}));
  const pending=h.scheduler.run([job('A'),job('B')]),rejected=assert.rejects(pending,/analysis_invalid/);
  await tick();h.parent.answers[0].text='200점 만점';release({content:'old assumption'});await rejected;
  assert.equal(h.calls.length,1);assert.equal(h.scheduler.progress(),0);assert.deepEqual(h.scheduler.context(),[]);
});
test('clearing source evidence interrupts ignored-abort work and cannot repopulate a stale cache',async()=>{
  let release;const h=setup(()=>new Promise(resolve=>{release=resolve;}));
  const pending=h.scheduler.run([job('A'),job('B')]),rejected=assert.rejects(pending,/analysis_invalid/);
  await tick();h.scheduler.clear();await rejected;
  assert.equal(h.calls[0][2].aborted,true);assert.equal(h.calls.length,1);
  release({content:'late success'});await tick();assert.deepEqual(h.scheduler.context(),[]);assert.equal(h.scheduler.progress(),0);
});
test('changing the selected model discards cached and pending findings before continuation',async()=>{
  const h=setup();await h.scheduler.run([job()]);h.state.model='another-model';assert.deepEqual(h.scheduler.context(),[]);
  await h.scheduler.run([job()]);assert.equal(h.calls.length,2);
  let release;const inFlight=setup(()=>new Promise(resolve=>{release=resolve;}));
  const pending=inFlight.scheduler.run([job('A'),job('B')]),rejected=assert.rejects(pending,/analysis_invalid/);
  await tick();inFlight.state.model='changed';inFlight.scheduler.context();await rejected;
  release({content:'late'});await tick();assert.equal(inFlight.calls.length,1);assert.equal(inFlight.scheduler.progress(),0);
});
test('parent packets validate input and never silently truncate mandatory facts',()=>{
  assert.equal(analysisTaskContext(undefined),null);
  assert.throws(()=>analysisTaskContext({request:'x',requirements:['x'.repeat(501)],answers:[]}),/tool_arguments_invalid/);
  assert.throws(()=>analysisTaskContext({request:'x',requirements:[],answers:[{question:'q',text:'x'.repeat(10001)}]}),/invalid_question/);
  const exact={request:'x',requirements:['첫 기준','다음 기준'],answers:[{question:'단위?',text:'천 원\n반올림 금지'}]};
  const packet=analysisTaskContext(exact);packet.answers[0].text='changed';assert.equal(exact.answers[0].text,'천 원\n반올림 금지');
});
