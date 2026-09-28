import test from 'node:test';
import assert from 'node:assert/strict';
import {startAgent} from '../worker/agent.mjs';
import {inspectChecks, mergeEditChecks, parseTask} from '../worker/office-harness.mjs';
import {text, call, planCall, valueEdit, valueCheck, contract, verdict, scriptedProvider, workbook, drive} from './harness-fixtures.mjs';
const start = (book, providers, mode = 'edit') => startAgent({request: 'A1을 42로 바꿔줘', scope: book.snapshot(), mode, providers,resilienceOptions:{wait:async()=>{}}});
test('Excel history recall uses real Pi tool flow and retains the original write guards',async()=>{
  const book=workbook(),providers=scriptedProvider({actor:[call('recall_context',{sourceId:'history-1',offset:0}),planCall([valueEdit(42)]),text('42 반영')]});
  const run=startAgent({request:'A1을 42로 바꿔줘',scope:book.snapshot(),mode:'edit',providers,history:[{role:'user',content:'코드 앞자리 0을 유지하세요.'}],resilienceOptions:{wait:async()=>{}}});
  const result=await drive(run,a=>book.action(a));assert.equal(result.state,'done',result.error);assert.equal(book.writes,1);assert.equal(result.metrics.historyContext.retrievals,1);
});
test('large accumulated read receipts checkpoint before the next call and preserve one committed edit',async()=>{
  const book=workbook();book.state.values=[["참고".repeat(19000),"원문".repeat(19000)]];
  const providers=scriptedProvider({actor:[call('read_selection'),call('read_selection'),planCall([valueEdit(42)]),text('42 반영')]});
  const result=await drive(start(book,providers),a=>book.action(a));
  assert.equal(result.state,'done',result.error);assert.equal(book.writes,1);assert.equal(book.state.values[0][1],"원문".repeat(19000));
  assert.ok(result.metrics.continuity.checkpoints>0);assert.equal(result.metrics.retries||0,0);assert.equal(result.metrics.recoveryPauses||0,0);assert.ok(result.metrics.requestContext.peakChars<=240000);
});
test('supervisor verifies actual cells even when executor omits verification', async () => {
  const book = workbook(), run = start(book, scriptedProvider());
  const state = await drive(run, action => {
    if(action.name==='apply_changes') {
      assert.equal(run.status().activity.at(-1).tool,'apply_changes');
      assert.equal(run.status().activity.at(-1).state,'running');
      assert.equal(book.writes,0);
    }
    return book.action(action);
  });
  assert.equal(state.state, 'done'); assert.equal(book.writes, 1); assert.equal(state.validation.verified, true);
  assert.deepEqual(state.trace.filter(s => s.name.startsWith('review')).map(s => s.name), ['review_action', 'review_step', 'review_task']);
  assert.equal(state.activity.some(event=>event.state==='running'),false);
  assert.equal(state.activity.filter(event=>event.tool==='apply_changes'&&event.state==='done').length,1);
});
test('reproduced defect: success acknowledgement with unchanged cells fails closed', async () => {
  const book = workbook(); let writes = 0;
  const state = await drive(start(book, scriptedProvider()), action => action.name === 'apply_changes' ? (writes++, {applied: true, snapshot: book.snapshot()}) : book.snapshot());
  assert.equal(state.state, 'failed'); assert.equal(state.error, 'write_uncertain'); assert.equal(writes, 1);
  assert.equal(state.plan.completed, 1); assert.equal(state.plan.steps[1].state, 'failed');
  assert.equal(state.activity.find(event=>event.tool==='apply_changes').state,'error');
  assert.equal(state.activity.some(event=>event.state==='running'),false);
});
for (const code of ['partial_change', 'write_uncertain', 'office_timeout']) test(`${code} never replays a write`, async () => {
  const book = workbook(); let writes = 0;
  const state = await drive(start(book, scriptedProvider()), action => action.name === 'apply_changes' ? (writes++, {error: code}) : book.snapshot());
  assert.equal(state.state, 'failed'); assert.equal(state.error, code); assert.equal(writes, 1);
});
test('unmet formatting is repaired without replaying a completed value write', async () => {
  const book = workbook(), bold = {address: 'A1', field: 'bold', operator: 'equals', expected: true};
  const providers = scriptedProvider({task: contract([valueCheck(42), bold]), actor: [planCall([valueEdit(42)]), text('완료'), planCall([{type: 'format_range', address: 'A1', bold: true}]), text('값과 굵게 처리 완료')]});
  const state = await drive(start(book, providers), action => book.action(action));
  assert.equal(state.state, 'done'); assert.equal(book.writes, 2); assert.equal(book.state.formats.bold[0][0], true);
  assert.ok(state.trace.some(s => s.name === 'repair_task'));
});
test('independent action reviewer rejects wrong units before any write', async () => {
  const book = workbook();
  const providers = scriptedProvider({actor: [planCall([valueEdit(42000)]), planCall([valueEdit(42)]), text('42 반영')], actionReview: payload => payload.proposed_edit.operations[0].values[0][0] === 42000 ? verdict(payload, 'revise', '요청 단위는 42입니다.') : verdict(payload)});
  const state = await drive(start(book, providers), action => book.action(action));
  assert.equal(state.state, 'done'); assert.equal(book.writes, 1); assert.equal(book.state.values[0][0], 42);
});
test('result review rejects an unsupported saved-file claim independently of cells', async () => {
  const book = workbook(); let reviews = 0;
  const providers = scriptedProvider({actor: [planCall([valueEdit(42)]), text('파일 저장 완료'), text('셀 변경 확인. 파일은 아직 저장하지 않았습니다.')], resultReview: payload => ++reviews === 1 ? verdict(payload, 'revise', '저장 증거가 없습니다. 답변을 바로잡으세요.') : verdict(payload)});
  const state = await drive(start(book, providers), action => book.action(action));
  assert.equal(state.state, 'done'); assert.equal(book.writes, 1); assert.equal(reviews, 2);
});
test('ambiguous task asks for essential input before editing', async () => {
  const book = workbook(), task = contract([], {intent: 'clarify', questions: ['적용할 세율은 얼마인가요?']});
  const state = await drive(start(book, scriptedProvider({task})), action => book.action(action));
  assert.equal(state.state, 'awaiting_user'); assert.equal(book.writes, 0); assert.match(state.question, /세율/);
});
test('existing formulas are preserved even if executor proposes overwriting', async () => {
  const book = workbook(); book.state.formulas[0][0] = '=B1*2';
  let attempts=0;const run=start(book, scriptedProvider({actor: () => ++attempts<6?planCall([valueEdit(42)]):call('ask_user',{question:'수식 대신 바꿀 입력값은 무엇인가요?'})}));
  const state = await drive(run, action => book.action(action));
  assert.equal(state.state, 'awaiting_user'); assert.equal(book.writes, 0); assert.equal(book.state.formulas[0][0], '=B1*2');
});
test('manual change after write interrupts final verification', async () => {
  const book = workbook();
  const state = await drive(start(book, scriptedProvider()), action => {if (action.name === 'verify_selection') book.state.values[0][1] = 99; return book.action(action);});
  assert.equal(state.state, 'failed'); assert.equal(state.error, 'cells_changed'); assert.equal(book.writes, 1);
});
test('invented evidence IDs never permit completion', async () => {
  let attempts=0;const book = workbook(), providers = scriptedProvider({resultReview: payload => ++attempts<=4?verdict({...payload, evidence: [{id: 999}]}):verdict(payload)});
  const state = await drive(start(book, providers), action => book.action(action));
  assert.equal(state.state, 'done',state.error);assert.equal(attempts,5);assert.equal(book.writes,1);
});
test('analysis exposes no write tool and still requires fresh result review', async () => {
  const book = workbook(), providers = scriptedProvider({task: contract([], {intent: 'analyze'}), actor: (_messages, tools) => {assert.ok(!tools.some(t => t.function.name === 'apply_changes')); return text('합계는 3입니다.');}});
  const state = await drive(start(book, providers, 'analyze'), action => book.action(action));
  assert.equal(state.state, 'done'); assert.equal(book.writes, 0); assert.ok(state.trace.some(s => s.name === 'review_task'));
});
test('cancellation releases pending native operation and rejects late result', async () => {
  const book = workbook(), run = start(book, scriptedProvider());
  const id = run.status().action.callId; run.cancel(); await run.promise;
  assert.equal(run.status().state, 'cancelled'); assert.throws(() => run.respond(id, book.snapshot()), /stale_tool_result/);
  assert.equal(run.status().activity.some(event=>event.state==='running'),false);
});
test('executor can ask essential followup without another model round', async () => {
  const book = workbook(), state = await drive(start(book, scriptedProvider({actor: [call('ask_user', {question: '기준 값은 얼마인가요?'})]})), action => book.action(action));
  assert.equal(state.state, 'awaiting_user'); assert.equal(book.writes, 0);
});
test('acceptance parser rejects out-of-range checks and malformed matrices', () => {
  const book = workbook();
  for (const check of [{...valueCheck(42), address: 'C1'}, {...valueCheck(42), expected: [[1, 2]]}]) assert.throws(() => parseTask(text(JSON.stringify(contract([check]))), book.snapshot(), 'edit'), /task_plan_invalid/);
});
test('latest edits replace old expectations without removing unaffected cells', () => {
  const merged = mergeEditChecks([{address: 'A1:B1', field: 'value', operator: 'equals', expected: [[40, 2]]}], [valueCheck(42)]);
  const book = workbook(); book.state.values[0][0] = 42;
  assert.equal(merged.length, 2); assert.equal(inspectChecks(merged, book.snapshot()).verified, true);
});
test('missing error evidence and wrong document snapshots cannot complete', async () => {
  const book = workbook(), state = await drive(start(book, scriptedProvider()), () => ({...book.snapshot(), documentId: 'another-book'}));
  assert.equal(state.error, 'observation_invalid'); assert.equal(book.writes, 0);
  const snapshot = book.snapshot(); delete snapshot.errors;
  assert.equal(inspectChecks([{address: 'A1', field: 'value', operator: 'no_error'}], snapshot).verified, false);
});
test('plan must be displayed before the executor or any edit can start', async () => {
  const book=workbook();let actorCalls=0;
  const run=start(book,scriptedProvider({actor:()=>{actorCalls++;return text('완료');}}));
  run.respond(run.status().action.callId,book.snapshot());
  for(let i=0;i<30&&run.status().action?.name!=='show_plan';i++)await new Promise(r=>setImmediate(r));
  const status=run.status();assert.equal(status.action.name,'show_plan');assert.equal(status.plan.completed,0);assert.equal(actorCalls,0);assert.equal(book.writes,0);
  run.cancel();await run.promise;assert.equal(run.status().plan.steps[0].state,'paused');
});
test('out-of-order edits are rejected; verified steps advance sequentially', async () => {
  const book=workbook(),second={address:'B1',field:'value',operator:'equals',expected:7};
  const task=contract([valueCheck(42),second],{steps:[
    {id:'inspect',title:'표 확인',kind:'inspect',checkIndexes:[]},
    {id:'first',title:'A1 수정',kind:'edit',checkIndexes:[0]},
    {id:'second',title:'B1 수정',kind:'edit',checkIndexes:[1]},
    {id:'verify',title:'전체 확인',kind:'verify',checkIndexes:[0,1]}
  ]});
  const bEdit={type:'set_values',address:'B1',values:[[7]]},seen=[];
  const run=start(book,scriptedProvider({task,actor:[planCall([bEdit]),planCall([valueEdit(42)]),planCall([bEdit]),text('완료')]}));
  const state=await drive(run,action=>{if(action.name==='apply_changes')seen.push({address:action.plan.operations[0].address,completed:run.status().plan.completed});return book.action(action);});
  assert.deepEqual(seen,[{address:'A1',completed:1},{address:'B1',completed:2}]);
  assert.equal(state.state,'done');assert.equal(state.plan.completed,4);assert.equal(book.writes,2);
});
test('last plan step stays in progress until independent final review completes', async () => {
  const book=workbook();let run;
  const provider=scriptedProvider({resultReview:payload=>{assert.equal(run.status().plan.completed,2);assert.equal(run.status().plan.steps.at(-1).state,'running');return verdict(payload);}});
  run=start(book,provider);const state=await drive(run,action=>book.action(action));assert.equal(state.plan.completed,3);
});
test('a rejected step review prevents advancing despite matching cells', async () => {
  const book=workbook(),run=start(book,scriptedProvider({stepReview:payload=>verdict(payload,'blocked','이 값의 단위를 확인해 주세요.')}));
  const state=await drive(run,action=>book.action(action));
  assert.equal(state.state,'awaiting_user');assert.equal(state.plan.completed,1);assert.equal(state.plan.steps[1].state,'waiting');assert.equal(book.writes,1);
});

test('committed Excel write shows its actual target and a capture failure never replays that write', async()=>{
  for(const fail of [false,true]){
    const book=workbook(),providers=scriptedProvider(),views=[];
    const run=startAgent({request:'A1을 42로 바꿔줘',scope:book.snapshot(),mode:'edit',providers,visualAvailable:true,resilienceOptions:{wait:async()=>{}}});
    const result=await drive(run,action=>{
      if(action.name==='view_observe'){
        assert.equal(book.writes,1);assert.equal(book.state.values[0][0],42);views.push(action.payload);
        if(fail)return{error:'view_window_unavailable'};
        return{id:'abcdef0123456789',observedAt:Date.now(),elements:[],binding:{scopeId:action.payload.scopeId,fingerprint:action.payload.expectedFingerprint},imageStatus:'unavailable'};
      }
      return book.action(action);
    });
    assert.equal(result.state,'done',result.error);assert.equal(book.writes,1);assert.equal(views.length,1);assert.equal(views[0].address,'A1');assert.equal(views[0].focus,true);
    assert.equal(result.activity.find(e=>e.tool==='show_document_target').state,fail?'error':'done');
  }
});

test('uncertain GUI input stops the entire agent before later writes or completion',async()=>{
  const book=workbook(),providers=scriptedProvider({actor:[call('inspect_office_view'),call('act_office_view',{viewId:'abcdef0123456789',targetId:'ui-1',action:'click'}),planCall([valueEdit(42)]),text('done')]});let inputs=0;
  const run=startAgent({request:'A1을 42로 바꿔줘',scope:book.snapshot(),mode:'edit',providers,visualAvailable:true,resilienceOptions:{wait:async()=>{}}});
  const result=await drive(run,action=>{
    if(action.name==='view_observe')return{id:'abcdef0123456789',observedAt:Date.now(),elements:[{id:'ui-1',name:'Layout',enabled:true,runtimeId:[1,2]}],binding:{scopeId:action.payload.scopeId,fingerprint:action.payload.expectedFingerprint},imageStatus:'unavailable'};
    if(action.name==='view_act'){inputs++;return{outcome:'uncertain',error:'view_source_changed'};}
    return book.action(action);
  });
  assert.equal(result.state,'failed');assert.equal(result.error,'view_action_uncertain');assert.equal(book.writes,0);assert.equal(inputs,1);assert.equal(result.metrics.retries||0,0);
});
