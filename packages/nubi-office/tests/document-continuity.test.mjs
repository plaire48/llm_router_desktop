import {startSkillIntake} from '../worker/skill-intake.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {startDocumentAgent} from '../worker/document-agent.mjs';
import {createWorker} from '../worker/main.mjs';
import {recoverWorkerRead} from '../src/worker-recovery.js';
import {documentProvider, documentTask, documentVerdict, request, specs, rawSheets, syntheticSnapshot} from './document-fixtures.mjs';
import {call, text} from './harness-fixtures.mjs';

function scenario(where='writer',documentSkill) {
  const requests=[];
  const base=documentProvider();let asked=false,partialStage=0,plannerCalls=0,opens=0,saves=0,snapshot,generated;
  const provider={...base,dispose(){},async complete(messages,...args){
    requests.push(messages);const system=messages[0].content;
    if(system.startsWith('NUBI_DOCUMENT_PLANNER')){plannerCalls++;if(where==='planner'&&!asked){asked=true;return text(JSON.stringify({...documentTask,intent:'clarify',questions:['인원은 몇 명인가요?'],sheets:[]}));}}
    if(system.startsWith('NUBI_DOCUMENT_WRITER')){
      const input=JSON.parse(messages.findLast(m=>m.role==='user').content);
      if(where==='partial'&&input.currentSheet.name==='예산'){
        if(partialStage++===0)return call('write_document_chunk',{chunk:JSON.stringify(rawSheets[1])});
        if(partialStage===2)return call('ask_user',{question:'식비 단가를 확정해 주세요.'});
        return call('commit_document_sheet',{});
      }
      if(where==='writer'&&!asked&&input.currentSheet.name==='예산'){asked=true;return call('ask_user',{question:'식비 단가를 확정해 주세요.'});}
    }
    if(system.startsWith('NUBI_DOCUMENT_REVIEWER')&&where==='reviewer'&&!asked){asked=true;return text(JSON.stringify({...documentVerdict(),status:'blocked',feedback:'참석 인원을 확인해 주세요.'}));}
    return base.complete(messages,...args);
  }};
  const start=options=>documentSkill?startSkillIntake({...options,host:'excel',documentSkill},startDocumentAgent):startDocumentAgent(options);
  const run=start({request,providers:provider,resilienceOptions:{wait:async()=>{}},writeFile:async(_task,all)=>{generated=structuredClone(all);return{fileName:'fixture.xlsx',sha256:'fixture'};}});
  const host=action=>{
    if(action.name==='show_plan')return{displayed:true};
    if(action.name==='document_open'){opens++;snapshot=syntheticSnapshot(action.payload);return structuredClone(snapshot);}
    if(action.name==='document_read')return structuredClone(snapshot);
    if(action.name==='document_save'){saves++;return{saved:true,path:'fixture.xlsx',sha256:'saved'};}
    throw new Error('unexpected_action');
  };
  return{run,provider,host,requests,get data(){return{plannerCalls,opens,saves,snapshot,generated};}};
}
async function boundary(scenario){
  for(let i=0;i<1000;i++){
    const state=scenario.run.status();if(state.state!=='running'||['request_input','request_approval'].includes(state.action?.name))return state;
    if(state.action)scenario.run.respond(state.action.callId,scenario.host(state.action));
    await new Promise(resolve=>setImmediate(resolve));
  }
  throw new Error('boundary_missing');
}
test('planning, writing and review questions resume the same document and preserve accepted sheets',async()=>{
  for(const where of ['planner','writer','partial','reviewer']){
    const s=scenario(where),before=await boundary(s),id=before.id;
    assert.equal(before.action.name,'request_input');assert.equal(before.phase,'awaiting_input');assert.ok(before.action.payload.inputLimit<=10000);
    assert.throws(()=>s.run.respond(before.action.callId,{text:'x'.repeat(10001)}),/invalid_question/);assert.equal(s.run.status().action.callId,before.action.callId);
    if(['writer','partial'].includes(where))assert.equal(before.writes,1);
    const answer={text:['writer','partial'].includes(where)?'12000원':'20명'};
    assert.throws(()=>s.run.respond(before.action.callId,{text:''}),/invalid_question/);
    assert.equal(s.run.status().action.callId,before.action.callId);
    s.run.respond(before.action.callId,answer);s.run.respond(before.action.callId,answer);
    assert.throws(()=>s.run.respond(before.action.callId,{text:'different'}),/tool_result_conflict/);
    const after=await boundary(s);
    assert.equal(after.id,id);assert.equal(after.action.payload.kind,'save');assert.equal(after.writes,2);
    assert.equal(after.question,'');assert.equal(after.metrics.questionsAnswered,1);
    assert.equal(s.data.plannerCalls,where==='planner'?2:1);assert.equal(s.data.opens,1);
    assert.deepEqual(s.data.generated[0],specs()[0]);
    s.run.respond(after.action.callId,{approved:true});const done=await boundary(s);await s.run.promise;
    assert.equal(done.state,'done');assert.equal(s.data.saves,1);
  }
});
test('manual Excel edits during review clarification stop saving instead of replacing user changes',{timeout:5000},async()=>{
  const s=scenario('reviewer'),question=await boundary(s);
  s.data.snapshot.fingerprint='changed-while-answering';s.run.respond(question.action.callId,{text:'20명'});
  const done=await boundary(s);await s.run.promise;
  assert.equal(done.state,'failed');assert.equal(done.error,'cells_changed');assert.equal(s.data.saves,0);assert.equal(s.data.opens,1);
});

test('review clarification retries busy reads without repeating document creation or the user question',async()=>{
  const s=scenario('reviewer'),original=s.host;let reads=0;
  s.host=action=>action.name==='document_read'&&++reads<=2?{error:'excel_busy'}:original(action);
  const question=await boundary(s);s.run.respond(question.action.callId,{text:'20명'});
  const approval=await boundary(s);assert.equal(approval.action.payload.kind,'save');
  assert.equal(reads,3);assert.equal(s.data.opens,1);assert.equal(approval.metrics.questionsAnswered,1);
  s.run.cancel();await s.run.promise;
});

class ReceiptCommand {
  constructor(kind){this.kind=kind;}
  check(model){return this.kind==='answer'?model.phase==='input':this.kind==='duplicate'||this.kind==='conflict'?model.answered:true;}
  async run(model,real){
    const {run}=real.scenario;
    if(this.kind==='answer'){
      let delivery=0;
      await recoverWorkerRead('toolResult',{id:run.id,callId:real.question.callId,result:{text:'12000원'}},{
        call:async(_method,payload)=>{run.respond(payload.callId,payload.result);if(++delivery===1)throw new Error('worker_timeout');return{accepted:true};},
        cancelled:()=>false,onRetry:()=>{},onStall:()=>assert.fail('unexpected recovery'),wait:async()=>{}
      });
      model.answered=true;model.phase='approval';const next=await boundary(real.scenario);assert.equal(next.action.payload.kind,'save');
    }else if(this.kind==='cancel'){run.cancel();await run.promise;model.phase='cancelled';}
    else if(this.kind==='duplicate')run.respond(real.question.callId,{text:'12000원'});
    else if(this.kind==='conflict')assert.throws(()=>run.respond(real.question.callId,{text:'99999원'}),/tool_result_conflict/);
    else if(this.kind==='stale')assert.throws(()=>run.respond('unknown-id',{text:'late'}),/stale_tool_result/);
    else if(this.kind==='invalid'&&model.phase==='input')assert.throws(()=>run.respond(real.question.callId,{text:''}),/invalid_question/);
    const actual=run.status();assert.equal(actual.id,real.id);assert.equal(real.scenario.data.plannerCalls,1);assert.equal(real.scenario.data.saves,0);
    assert.equal(actual.writes,model.answered?2:1);
    assert.equal(actual.state,model.phase==='cancelled'?'cancelled':'running');
    if(model.phase==='input')assert.equal(actual.action.callId,real.question.callId);
    if(model.answered)assert.deepEqual(real.scenario.data.generated[0],specs()[0]);
  }
  toString(){return this.kind;}
}
test('fast-check generated receipt loss, duplicates, cancellation and stale input preserve document state',async()=>{
  await fc.assert(fc.asyncProperty(fc.commands([fc.constantFrom('answer','cancel','duplicate','conflict','stale','invalid','poll').map(kind=>new ReceiptCommand(kind))],{maxCommands:30}),async commands=>{
    const s=scenario(),first=await boundary(s);
    try{await fc.asyncModelRun(()=>({model:{phase:'input',answered:false},real:{scenario:s,id:first.id,question:first.action}}),commands);}
    finally{s.run.cancel();await s.run.promise;}
  }),{numRuns:200,seed:23092026});
});
test('lost runStart responses resolve by request key without starting another agent or reviving cancellation',async()=>{
  const base=documentProvider();let plannerCalls=0;
  const worker=createWorker({...base,dispose(){},complete:async(...args)=>{plannerCalls++;return text(JSON.stringify({...documentTask,intent:'clarify',questions:['인원은?'],sheets:[]}));}});
  const payload={requestId:'start-request-0001',mode:'document',request};
  const first=await worker.dispatch('runStart',payload),again=await worker.dispatch('runStart',payload);
  assert.equal(first.id,again.id);
  let lookups=0;
  const found=await recoverWorkerRead('runLookup',{requestId:payload.requestId},{call:async(method,args)=>{if(++lookups===1)throw new Error('worker_timeout');return worker.dispatch(method,args);},cancelled:()=>false,onRetry:()=>{},onStall:()=>assert.fail(),wait:async()=>{}});
  assert.equal(found.id,first.id);assert.equal(lookups,2);
  await assert.rejects(recoverWorkerRead('runLookup',{requestId:payload.requestId},{call:async()=>({...found,requestId:'wrong-request'}),cancelled:()=>false,onRetry:()=>{},onStall:()=>assert.fail(),wait:async()=>{}}),/run_expired/);
  await assert.rejects(worker.dispatch('runStart',{...payload,request:'different'}),/operation_collision/);
  await assert.rejects(worker.dispatch('runLookup',{requestId:'different-request'}),/run_expired/);
  await worker.dispatch('runCancel',{requestId:payload.requestId});
  assert.equal((await worker.dispatch('runStart',payload)).state,'cancelled');
  assert.equal(plannerCalls,1);worker.dispose();
});

test('known skill inputs proceed without upfront forms and rules reach Excel planning writing and final review',async()=>{
  const selected={id:'00000000-0000-4000-8000-000000000012',host:'excel',revision:1,name:'교육 보고서',instructions:'목표와 예산을 연결하고 금액 단위를 보존한다.',questions:[{question:'참석 인원은 몇 명인가요?',choices:[],input_mode:'text'}]};
  const s=scenario('complete',selected),approval=await boundary(s);
  assert.equal(approval.action.name,'request_approval');assert.equal(approval.action.payload.kind,'save');
  for(const marker of ['NUBI_DOCUMENT_PLANNER','NUBI_DOCUMENT_WRITER','NUBI_DOCUMENT_REVIEWER']){
    const messages=s.requests.find(m=>m[0].content.startsWith(marker));assert.ok(messages,marker);
    assert.match(JSON.stringify(messages),/selected-writing-rule/);assert.match(JSON.stringify(messages),/목표와 예산을 연결/);
  }
  assert.equal(approval.skillInput.answers.length,0);assert.equal(s.data.saves,0);
  s.run.cancel();await s.run.promise;
});
