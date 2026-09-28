import {startSkillIntake} from '../worker/skill-intake.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {startIntentAgent,parseIntent} from '../worker/intent-agent.mjs';
import {retainedAnswers} from '../worker/input-contract.mjs';
import {createWorker} from '../worker/main.mjs';
import {workbook,text,contract,scriptedProvider,call} from './harness-fixtures.mjs';
import {documentProvider,request as documentRequest,syntheticSnapshot} from './document-fixtures.mjs';

const fast={wait:async()=>{}};
const encoded=value=>text(JSON.stringify(value));
const question={mode:'clarify',question:{question:'새 문서로 만들까요, 선택한 셀에서 진행할까요?',choices:[{label:'새 문서로 만들기'},{label:'선택한 셀에서 진행'}],input_mode:'text'}};
async function boundary(run,host) {
  for(let i=0;i<2000;i++){
    const status=run.status();
    if(status.state!=='running'||['request_input','request_approval'].includes(status.action?.name))return status;
    if(status.action){assert.ok(host,`Unexpected action ${status.action.name}`);run.respond(status.action.callId,host(status.action));}
    await new Promise(resolve=>setImmediate(resolve));
  }
  throw new Error('boundary_missing');
}
function runners(){const starts=[];const start=options=>{starts.push(options);return{id:'child-id',promise:Promise.resolve(),status:()=>({id:'child-id',state:'done',activity:[],metrics:{modelCalls:2,usage:[]},action:null}),cancel(){},respond(){}};};return {starts,document:start,cells:start};}
function routed(responses,options={},starts=runners()){
  const requests=[];
  const providers={status:()=>({model:'scripted-qwen'}),async complete(messages,tools){requests.push(messages);assert.deepEqual(tools,[]);return encoded(responses.shift());}};
  const run=startIntentAgent({request:'성적표를 만들어줘',providers,resilienceOptions:fast,...options},starts);
  return{run,requests,starts:starts.starts};
}

test('automatic dispatch starts one guarded path without a work-mode question',async()=>{
  for(const mode of ['document','analyze','edit','template','template-register']){
    const s=routed([{mode}],mode==='document'?{}:{scope:workbook().snapshot()});
    await s.run.promise;
    assert.equal(s.starts.length,1);assert.equal(s.starts[0].mode,mode);assert.equal(s.starts[0].continuousInput,true);
    assert.equal(s.run.status().id,s.run.id);assert.equal(s.run.status().metrics.modelCalls,3);
    assert.ok(s.requests[0][0].content.includes('NUBI_INTENT_ROUTER'));
    assert.ok(!s.run.status().action);
  }
});
test('ambiguous requests retain free-text answers, stable run ID and strict acknowledgements through handoff',async()=>{
  const s=routed([question,{mode:'document'}]);const pending=await boundary(s.run),id=s.run.id;
  assert.equal(pending.action.payload.options.length,2);assert.equal(s.starts.length,0);
  assert.throws(()=>s.run.respond(pending.action.callId,{text:''}),/invalid_question/);
  assert.equal(s.run.status().action.callId,pending.action.callId);
  const answer={text:'새 문서로 만들고 학생 27명, 국어와 수학을 넣어줘'};
  s.run.respond(pending.action.callId,answer);s.run.respond(pending.action.callId,answer);
  assert.throws(()=>s.run.respond(pending.action.callId,{text:'다른 답변'}),/tool_result_conflict/);
  await s.run.promise;
  assert.equal(s.run.status().id,id);assert.equal(s.starts.length,1);
  assert.equal(s.starts[0].routingAnswers[0].text,answer.text);
  assert.equal(s.starts[0].request,'성적표를 만들어줘');
  s.run.respond(pending.action.callId,answer);
});
test('missing scope asks for observed selection without guessing an editable range',async()=>{
  const s=routed([{mode:'edit'},{mode:'edit'}]),q=await boundary(s.run);
  assert.equal(q.action.name,'request_input');assert.equal(s.starts.length,0);
  s.run.respond(q.action.callId,{text:'선택했어요'});
  const sheet=workbook().snapshot();await boundary(s.run,action=>{assert.equal(action.name,'get_selection');return sheet;});await s.run.promise;
  assert.deepEqual(s.starts[0].scope,sheet);assert.equal(s.starts.length,1);
});
test('missing selection and changed intent can continue as a new document',async()=>{
  const s=routed([{mode:'edit'},{mode:'document'}]),q=await boundary(s.run);
  s.run.respond(q.action.callId,{text:'아니 새 문서로 만들어줘'});
  await boundary(s.run,()=>({error:'select_cells'}));await s.run.promise;
  assert.equal(s.starts[0].mode,'document');assert.equal(s.starts[0].scope,null);
});
test('invalid routing responses pause after three failures without launching a writer',async()=>{
  const starts=runners();let calls=0;
  const run=startIntentAgent({request:'성적표',providers:{complete:async()=>{calls++;return encoded({mode:'delete_everything'});}},resilienceOptions:fast},starts);
  const pending=await boundary(run);assert.equal(calls,3);assert.equal(pending.phase,'awaiting_recovery');assert.equal(starts.starts.length,0);
  run.respond(pending.action.callId,{approved:false});await run.promise;assert.equal(run.status().state,'cancelled');assert.equal(calls,3);
});
test('cancellation fences late classification and never launches a child',async()=>{
  let resolve;const starts=runners();
  const run=startIntentAgent({request:'성적표',providers:{complete:()=>new Promise(done=>resolve=done)},resilienceOptions:fast},starts);
  run.cancel();resolve(encoded({mode:'document'}));await run.promise;
  assert.equal(run.status().state,'cancelled');assert.equal(starts.starts.length,0);
});
test('template binding cannot be bypassed by automatic routing',async()=>{
  const s=routed([{mode:'template'}],{scope:workbook().snapshot(),templateRecord:{name:'test'},templateBinding:{documentId:'other'}});
  await s.run.promise;assert.equal(s.run.status().error,'template_copy_scope_changed');assert.equal(s.starts.length,0);
});
test('routing schema and retained answer budgets fail closed',()=>{
  for(const value of [{mode:'clarify'},{mode:'clarify',question:{}},{mode:'edit',scope:'B1'},null])assert.throws(()=>parseIntent(encoded(value)),/task_plan_invalid/);
  // A live model added a question to an execution mode and repeated it until the run stalled; the executor asks instead.
  assert.deepEqual(parseIntent(encoded({mode:'document',question:{}})),{mode:'document'});
  const records=Array.from({length:6},()=>({question:'질문',text:'x'.repeat(10000)}));
  assert.equal(retainedAnswers(records)[5].text.length,10000);
  assert.throws(()=>retainedAnswers([{question:'질문',cancelled:true}]),/invalid_question/);
  assert.throws(()=>retainedAnswers([...records,{question:'질문',text:'x'.repeat(5000)}]),/input_context_limit/);
});
test('real document harness receives routing answers and still waits for native save approval',async()=>{
  const base=documentProvider();let routerCalls=0,plannerObserved=false,snapshot;const longAnswer='새 문서, 참석 인원은 20명 '+ '상세 요구사항 '.repeat(1000);
  const run=startIntentAgent({request:documentRequest,resilienceOptions:fast,writeFile:async()=>({fileName:'fixture.xlsx',sha256:'fixture'}),providers:{...base,async complete(messages,...args){
    if(messages[0].content.startsWith('NUBI_INTENT_ROUTER'))return encoded(++routerCalls===1?question:{mode:'document'});
    if(messages[0].content.startsWith('NUBI_DOCUMENT_PLANNER'))plannerObserved=messages.some(m=>m.role==='user'&&m.content===longAnswer);
    return base.complete(messages,...args);
  }}});
  const q=await boundary(run);run.respond(q.action.callId,{text:longAnswer});
  const approval=await boundary(run,action=>{
    if(action.name==='show_plan')return{displayed:true};
    if(action.name==='document_open'){snapshot=syntheticSnapshot(action.payload);return snapshot;}
    if(action.name==='document_read')return snapshot;
    throw new Error('unexpected_write');
  });
  assert.ok(plannerObserved);assert.equal(approval.id,run.id);assert.equal(approval.action.payload.kind,'save');assert.equal(approval.kind,'document');
  run.cancel();await run.promise;assert.equal(run.status().state,'cancelled');
});
test('real cell harness continues planning and tool questions in the same bound run',async()=>{
  const book=workbook();let planned=false,asked=false,answerSeen=false;
  const base=scriptedProvider({actor:()=>{if(book.writes)return text('A1을 42로 변경했습니다.');if(!asked){asked=true;return call('ask_user',{question:'값은 42로 넣을까요?',choices:[{label:'42로 입력'},{label:'다른 값 입력'}]});}return call('apply_changes',{plan:JSON.stringify({operations:[{type:'set_values',address:'A1',values:[[42]]}]})});}});
  const run=startSkillIntake({host:'excel',documentSkill:{id:'00000000-0000-4000-8000-000000000010',host:'excel',revision:1,name:'셀 작성 규칙',instructions:'사용자가 정한 값만 입력',questions:[{question:'어떤 값인가요?',choices:[],input_mode:'text'}]},request:'이 셀을 수정해줘',scope:book.snapshot(),resilienceOptions:fast,providers:{...base,async complete(messages,...args){
    if(messages[0].content.startsWith('NUBI_INTENT_ROUTER'))return encoded({mode:'edit'});
    if(messages[0].content.startsWith('NUBI_TASK_PLANNER')){
      if(!planned){planned=true;return encoded(contract([],{intent:'clarify',questions:['어떤 값을 입력할까요?']}));}
      answerSeen=JSON.parse(messages[1].content).history.some(m=>m.content==='42');
    }
    return base.complete(messages,...args);
  }}},startIntentAgent);
  let q=await boundary(run,a=>book.action(a));assert.equal(q.action.name,'request_input');run.respond(q.action.callId,{text:'42'});
  q=await boundary(run,a=>book.action(a));assert.ok(answerSeen);assert.equal(q.id,run.id);assert.equal(q.action.name,'request_input');
  run.respond(q.action.callId,{text:'42로 입력'});
  const approval=await boundary(run,a=>book.action(a));assert.equal(approval.action.name,'request_approval');assert.equal(book.writes,0);
  run.respond(approval.action.callId,{approved:true});const done=await boundary(run,a=>book.action(a));await run.promise;
  assert.equal(done.state,'done');assert.equal(book.writes,1);assert.equal(done.id,run.id);
});
test('automatic runStart receipts survive response loss without a second classifier',async()=>{
  let calls=0;const worker=createWorker({complete:async()=>{calls++;return encoded(question);},status:()=>({provider:'aipro',model:'test-model'}),dispose(){}});
  const payload={requestId:'automatic-request-1234',request:'성적표',mode:'auto'};
  const a=await worker.dispatch('runStart',payload),b=await worker.dispatch('runLookup',{requestId:payload.requestId}),c=await worker.dispatch('runStart',payload);
  assert.equal(a.id,b.id);assert.equal(a.id,c.id);assert.equal(calls,1);
  await assert.rejects(worker.dispatch('runStart',{...payload,request:'다른 요청'}),/operation_collision/);
  worker.dispose();
});

test('manual edits while answering a cell question stop before mutation',async()=>{
  const book=workbook();
  const base=scriptedProvider({actor:[call('ask_user',{question:'입력할 값을 알려주세요'})]});
  const run=startIntentAgent({request:'현재 셀 수정',scope:book.snapshot(),resilienceOptions:fast,providers:{...base,complete:(messages,...args)=>messages[0].content.startsWith('NUBI_INTENT_ROUTER')?Promise.resolve(encoded({mode:'edit'})):base.complete(messages,...args)}});
  const q=await boundary(run,a=>book.action(a));assert.equal(q.action.name,'request_input');
  book.state.values[0][0]=99;run.respond(q.action.callId,{text:'42'});
  const done=await boundary(run,a=>book.action(a));await run.promise;
  assert.equal(done.error,'cells_changed');assert.equal(book.writes,0);
});
