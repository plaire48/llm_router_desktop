import test from 'node:test';
import assert from 'node:assert/strict';
import {createHistoryContext} from '../worker/context-memory.mjs';
import {createAutoSummary,parseContextSummary} from '../worker/context-summary.mjs';
import {createRunContinuity} from '../worker/run-continuity.mjs';
import {createActivityLog} from '../worker/activity.mjs';
import {startAgent} from '../worker/agent.mjs';
import {workbook,scriptedProvider,drive,text} from './harness-fixtures.mjs';

const history=()=>[...Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',content:`자료 ${i}: `+'사업부별 기준을 확인한다. '.repeat(110)})),{role:'user',content:'정정: 금액 단위는 천 원이며 초안만 작성하세요.'}];
const summaryReply=messages=>{const source=JSON.parse(messages[1].content),p=source.passages.find(p=>p.role==='user');return text(JSON.stringify({items:[{kind:'constraint',text:'앞서 전달한 업무 조건을 참고한다.',sourceId:p.sourceId,passageOffset:p.offset,quote:p.text.slice(0,80)}]}));};
function setup(complete=summaryReply,options={}){
  const metrics={modelCalls:0,usage:[]},memory=createHistoryContext(history(),metrics),controller=new AbortController(),activity=createActivityLog();let calls=0;
  const providers={status:()=>({provider:'aipro',model:'selected-qwen'}),complete:async(...args)=>{calls++;assert.deepEqual(args[1],[]);return complete(...args);}};
  const summary=createAutoSummary({memory,providers,signal:controller.signal,activity,metrics,timeoutMs:30,...options});
  return {metrics,memory,controller,activity,summary,get calls(){return calls;}};
}
test('automatic summary is bounded, cited, same-model and once per long-history run',async()=>{
  const h=setup(),before=h.memory.window('사업부'),original=h.memory.requirements();assert.equal(h.summary.needed(),true);
  await h.summary.prepare('사업부');await h.summary.prepare('다른 질문');const after=h.memory.window('사업부');
  assert.equal(h.calls,1);assert.equal(h.metrics.autoSummary.accepted,1);assert.equal(after.summary.advisory,true);assert.ok(JSON.stringify(after).length<=12000);assert.ok(JSON.stringify(after).length<JSON.stringify(before).length);
  assert.ok(after.passages.some(p=>p.text.includes('정정: 금액 단위는 천 원')));assert.deepEqual(h.memory.requirements(),original);
  const ref=after.summary.items[0],source=history().filter(m=>['user','assistant'].includes(m.role))[ref.order];assert.equal(source.content.slice(ref.offset,ref.offset+ref.quote.length),ref.quote);
  assert.equal(h.memory.recall({sourceId:ref.sourceId,offset:Math.floor(ref.offset/1800)*1800}).passages.length,1);
});
test('invalid quotes, unknown sources, assistant-promoted constraints and completion fields are rejected',()=>{
  const h=setup(),source=h.memory.summarySource('사업부'),user=source.passages.find(p=>p.role==='user'),assistant=source.passages.find(p=>p.role==='assistant');
  const base={kind:'constraint',text:'조건',sourceId:user.sourceId,passageOffset:user.offset,quote:user.text.slice(0,20)};
  for(const changed of [{quote:'없는 인용문'},{sourceId:'invented'},{passageOffset:99999},{kind:'completed'},{sourceId:assistant.sourceId,passageOffset:assistant.offset,quote:assistant.text.slice(0,20)}])assert.throws(()=>parseContextSummary(text(JSON.stringify({items:[{...base,...changed}]})),source),/context_summary_invalid/);
  assert.throws(()=>parseContextSummary({...summaryReply([{},{content:JSON.stringify(source)}]),calls:[{name:'apply_changes'}]},source),/context_summary_invalid/);
});
test('invalid or timed-out summaries keep originals and never start an auxiliary retry loop',async()=>{
  for(const complete of [()=>text('invalid'),()=>new Promise(()=>{})]){
    const h=setup(complete),before=h.memory.window('기준');await h.summary.prepare('기준');await h.summary.prepare('기준');
    assert.equal(h.calls,1);assert.equal(h.metrics.autoSummary.fallbacks,1);assert.equal(h.metrics.retries,undefined);assert.deepEqual(h.memory.window('기준'),before);
  }
});
test('short history incurs no summary request',async()=>{
  const metrics={modelCalls:0},memory=createHistoryContext([{role:'user',content:'단위는 원'}],metrics),controller=new AbortController();
  const summary=createAutoSummary({memory,signal:controller.signal,metrics,activity:createActivityLog(),providers:{complete:()=>assert.fail('unexpected inference')}});
  await summary.prepare('보고서');assert.equal(summary.needed(),false);assert.equal(metrics.autoSummary.attempts,0);
});
test('cancellation fences late summarizer output and aborts its provider request',async()=>{
  let resolve,signal;const h=setup((_m,_t,s)=>{signal=s;return new Promise(r=>{resolve=r;});});const pending=h.summary.prepare('업무'),rejection=assert.rejects(pending,/cancelled/);h.controller.abort();await rejection;
  resolve(summaryReply([{},{content:JSON.stringify(h.memory.summarySource('업무'))}]));await new Promise(r=>setImmediate(r));assert.equal(signal.aborted,true);assert.equal(h.memory.window('업무').summary,undefined);assert.equal(h.metrics.autoSummary.accepted,0);
});
test('summary fallback honors Retry-After and permanent authentication errors stop',async()=>{
  const waits=[],h=setup(()=>{throw Object.assign(new Error('rate_limited'),{status:429,retryAfterMs:35000});},{wait:async ms=>waits.push(ms)});
  await h.summary.prepare('업무');assert.deepEqual(waits,[30000,5000]);assert.equal(h.calls,1);assert.equal(h.metrics.autoSummary.state,'original_context');
  const denied=setup(()=>{throw new Error('unauthorized');});await assert.rejects(denied.summary.prepare('업무'),/unauthorized/);assert.equal(denied.calls,1);
});
test('machine continuity retains failure evidence but retry counters never masquerade as progress',()=>{
  let state={scopeId:'scope',verifiedWrites:1,plan:[{id:'edit',state:'done'},{id:'verify',state:'running'}],lastFailure:{code:'upstream',attempt:1}};
  const metrics={},continuity=createRunContinuity({getState:()=>state,activity:createActivityLog(),metrics});assert.equal(continuity.checkpoint().unchanged,false);
  state.lastFailure.attempt=9;assert.equal(continuity.checkpoint().unchanged,true);assert.equal(continuity.snapshot().lastFailure.attempt,9);
  state.verifiedWrites=2;assert.equal(continuity.checkpoint().unchanged,false);assert.equal(metrics.retries,undefined);assert.equal(continuity.snapshot().plan[0].state,'done');
});
test('actual Pi Excel executor can use a summary without changing write approval or original review conditions',async()=>{
  const book=workbook(),ordinary=scriptedProvider();let summaryCalls=0,reviewChecked=false;
  const providers={...ordinary,complete:async(messages,...rest)=>{
    if(messages[0].content.startsWith('NUBI_CONTEXT_SUMMARIZER')){summaryCalls++;return summaryReply(messages);}
    if(messages[0].content.startsWith('NUBI_ACTION_REVIEWER')){const data=JSON.parse(messages[1].content);assert.ok(JSON.stringify(data.history).includes('정정: 금액 단위는 천 원'));assert.ok(data.history.some(h=>JSON.parse(h.content).summary));reviewChecked=true;}
    return ordinary.complete(messages,...rest);
  }};
  const run=startAgent({request:'A1을 42로 바꿔줘',history:history(),scope:book.snapshot(),mode:'edit',providers,resilienceOptions:{wait:async()=>{}}});
  const result=await drive(run,a=>book.action(a));assert.equal(result.state,'done',result.error);assert.equal(book.writes,1);assert.equal(summaryCalls,1);assert.equal(reviewChecked,true);assert.equal(result.metrics.autoSummary.accepted,1);
});
