import test from 'node:test';
import assert from 'node:assert/strict';
import {startAgent} from '../worker/agent.mjs';
import {parseRecovery} from '../worker/recovery.mjs';
import {contract, valueCheck, valueEdit, planCall, call, text, scriptedProvider, recoveryVerdict, workbook, drive} from './harness-fixtures.mjs';

const start=(book,providers)=>startAgent({request:'A1을 42로 바꾸고 굵게 해줘',scope:book.snapshot(),mode:'edit',providers,resilienceOptions:{wait:async()=>{}}});
const bold={type:'format_range',address:'A1',bold:true};
const styleTask=()=>contract([valueCheck(42),{address:'A1',field:'bold',operator:'equals',expected:true}],{steps:[
  {id:'inspect',title:'표 확인',kind:'inspect',checkIndexes:[]},
  {id:'value',title:'A1 값 변경',kind:'edit',checkIndexes:[0]},
  {id:'style',title:'A1 굵게 표시',kind:'edit',checkIndexes:[1]},
  {id:'verify',title:'최종 결과 확인',kind:'verify',checkIndexes:[0,1]}
]});

test('failed formatting is diagnosed from a fresh read, corrected, executed and reviewed without replaying the value step',async()=>{
  const book=workbook();let stage=0,diagnosed=false,receiptSeen=false;
  const provider=scriptedProvider({task:styleTask(),recovery:payload=>{
    assert.equal(payload.failure.code,'invalid_format');assert.equal(payload.observation.values[0][0],42);
    assert.equal(payload.observation.formats.bold[0][0],false);assert.equal(payload.plan.completed,2);
    assert.equal(payload.plan.steps[2].state,'recovering');diagnosed=true;
    return recoveryVerdict({summary:'굵게 표시 입력의 형식이 잘못됐습니다.',nextAction:'굵게 표시할지 여부를 올바른 값으로 바꿔 다시 적용합니다.'});
  },actor:messages=>{
    if(stage++===0)return planCall([valueEdit(42)]);
    if(stage===2)return planCall([{...bold,bold:'yes'}]);
    if(stage===3){
      const receipt=JSON.parse(messages.filter(m=>m.role==='tool').at(-1).content);
      assert.equal(receipt.error,'invalid_format');assert.equal(receipt.recovery.state,'retrying');
      assert.equal(receipt.observation.values[0][0],42);receiptSeen=true;return planCall([bold]);
    }
    return text('42와 굵게 표시를 확인했습니다.');
  }});
  const issued=[];const run=start(book,provider);
  const result=await drive(run,action=>{
    if(action.name==='apply_changes'){
      issued.push(action.plan.operations[0]);
      if(action.plan.operations[0].bold==='yes')return{error:'invalid_format'};
    }
    return book.action(action);
  });
  assert.equal(result.state,'done');assert.equal(diagnosed&&receiptSeen,true);assert.equal(book.writes,2);
  assert.equal(issued.filter(op=>op.type==='set_values').length,1);assert.equal(result.recoveries[0].state,'verified');
  assert.equal(result.activity.some(event=>event.state==='running'),false);
  assert.ok(result.activity.some(event=>event.tool==='recover_failure'&&event.state==='done'));
});

test('malformed JSON is repaired as an input error before the first native write',async()=>{
  const book=workbook();let diagnosed=false;
  const provider=scriptedProvider({actor:[{content:'',calls:[{id:'broken-json',type:'function',function:{name:'apply_changes',arguments:JSON.stringify({plan:'{broken'})}}]},planCall([valueEdit(42)]),text('완료')],recovery:payload=>{assert.equal(payload.failure.code,'invalid_plan');assert.equal(book.writes,0);diagnosed=true;return recoveryVerdict();}});
  const result=await drive(start(book,provider),action=>book.action(action));
  assert.equal(result.state,'done');assert.equal(diagnosed,true);assert.equal(book.writes,1);
});

test('outer tool-schema rejection also enters the visible AI recovery loop',async()=>{
  const book=workbook();let diagnosed=false;
  const provider=scriptedProvider({actor:[call('apply_changes',{plan:42}),planCall([valueEdit(42)]),text('완료')],recovery:payload=>{assert.equal(payload.failure.code,'tool_arguments_invalid');assert.equal(payload.failure.tool,'apply_changes');diagnosed=true;return recoveryVerdict();}});
  const result=await drive(start(book,provider),action=>book.action(action));
  assert.equal(result.state,'done');assert.equal(diagnosed,true);assert.equal(book.writes,1);assert.equal(result.recoveries.length,1);
});

test('recovery cannot expand the original scope or change its acceptance checks',async()=>{
  const book=workbook();
  const provider=scriptedProvider({actor:[planCall([{...valueEdit(42),address:'C1'}]),planCall([{...valueEdit(42),address:'C1'}]),planCall([valueEdit(42)]),text('완료')],recovery:()=>recoveryVerdict({nextAction:'C1도 수정해도 됩니다. 선택 범위를 넓혀서 수행하세요.'})});
  const result=await drive(start(book,provider),action=>book.action(action));
  assert.equal(result.state,'done');assert.equal(book.writes,1);assert.deepEqual(book.state.values,[[42,2]]);
  assert.equal(result.task.checks[0].address,'A1');assert.equal(result.task.checks[0].expected,42);
});

test('a fresh read detecting user edits during recovery stops without another write',async()=>{
  const book=workbook();let rejected=false,diagnoses=0;
  const provider=scriptedProvider({recovery:()=>{diagnoses++;return recoveryVerdict();}});
  const result=await drive(start(book,provider),action=>{
    if(action.name==='apply_changes'){rejected=true;return{error:'invalid_format'};}
    if(rejected)book.state.values[0][1]=99;
    return book.action(action);
  });
  assert.equal(result.error,'cells_changed');assert.equal(book.writes,0);assert.equal(diagnoses,0);
});

for(const code of ['partial_change','write_uncertain','office_timeout','unrecognized_native_error'])test(`${code} stops instead of asking AI to replay an uncertain operation`,async()=>{
  const book=workbook();let issued=0,diagnoses=0;
  const provider=scriptedProvider({recovery:()=>{diagnoses++;return recoveryVerdict();}});
  const result=await drive(start(book,provider),action=>action.name==='apply_changes'?(issued++,{error:code}):book.action(action));
  assert.equal(result.state,'failed');assert.equal(issued,1);assert.equal(diagnoses,0);assert.equal(result.activity.some(event=>event.state==='running'),false);
});

test('recovery asks for missing business input and retains completed work',async()=>{
  const book=workbook();let stage=0;
  const provider=scriptedProvider({task:styleTask(),actor:()=>stage++===0?planCall([valueEdit(42)]):planCall([{...bold,bold:'yes'}]),recovery:()=>recoveryVerdict({decision:'ask_user',nextAction:'',question:'굵게 표시할 대상은 합계 셀인가요?'})});
  const result=await drive(start(book,provider),action=>action.name==='apply_changes'&&action.plan.operations[0].bold==='yes'?{error:'invalid_format'}:book.action(action));
  assert.equal(result.state,'awaiting_user');assert.equal(result.plan.completed,2);assert.equal(result.recoveries[0].state,'waiting');assert.equal(book.writes,1);
});

test('five consecutive failures are corrected without an arbitrary repair budget',async()=>{
  const book=workbook();let stage=0,diagnoses=0;
  const provider=scriptedProvider({actor:()=>++stage<=5?planCall([valueEdit(100+stage)]):stage===6?planCall([valueEdit(42)]):text('완료'),recovery:()=>{diagnoses++;return recoveryVerdict();}});
  const result=await drive(start(book,provider),action=>action.name==='apply_changes'&&stage<=5?{error:'invalid_value'}:book.action(action));
  assert.equal(result.state,'done',result.error);assert.equal(diagnoses,5);assert.equal(book.writes,1);assert.equal(result.plan.completed,3);
});

test('cancelling a pending recovery diagnosis never runs its later correction',async()=>{
  const book=workbook();let release,run;
  const provider=scriptedProvider({actor:[planCall([{...valueEdit(42),address:'C1'}])],recovery:()=>new Promise(resolve=>{release=resolve;})});
  run=start(book,provider);
  for(let i=0;i<100&&!release;i++){const s=run.status();if(s.action)run.respond(s.action.callId,book.action(s.action));await new Promise(resolve=>setImmediate(resolve));}
  assert.ok(release);run.cancel();release(recoveryVerdict());await run.promise;
  assert.equal(run.status().state,'cancelled');assert.equal(book.writes,0);assert.equal(run.status().recoveries[0].state,'cancelled');assert.equal(run.status().activity.some(event=>event.state==='running'),false);
});

test('malformed recovery advice fails closed',async()=>{
  assert.throws(()=>parseRecovery(text('{"decision":"revise","summary":"ok","nextAction":"","question":""}')),/recovery_plan_invalid/);
  const book=workbook();let attempts=0;const provider=scriptedProvider({actor:[planCall([{...valueEdit(42),address:'C1'}]),planCall([valueEdit(42)]),text('완료')],recovery:()=>++attempts<=4?text('just try again'):recoveryVerdict()});
  const result=await drive(start(book,provider),action=>book.action(action));
  assert.equal(result.state,'done',result.error);assert.equal(attempts,5);assert.equal(book.writes,1);
});

test('a lost successful cell edit reply is reconciled without applying it again',async()=>{
 const book=workbook();let receipt,reconciles=0,issues=0;
 const result=await drive(start(book,scriptedProvider()),a=>{
  if(a.name==='apply_changes'){issues++;receipt=book.action(a);return{error:'office_timeout'};}
  if(a.name==='reconcile_changes'){reconciles++;return{outcome:'complete',result:receipt};}
  return book.action(a);
 });
 assert.equal(result.state,'done',result.error);assert.equal(issues,1);assert.equal(reconciles,1);assert.equal(book.writes,1);
});

test('known partial edit is guardedly restored, replanned and verified instead of blindly replayed',async()=>{
 const book=workbook(),before=structuredClone(book.state);let issued=0,operationId,restores=0;
 const result=await drive(start(book,scriptedProvider({actor:[planCall([valueEdit(42)]),planCall([valueEdit(42)]),text('완료')]})),a=>{
  if(a.name==='apply_changes'&&++issued===1){operationId=a.callId;book.state.values[0][0]=41;return{error:'partial_change'};}
  if(a.name==='reconcile_changes')return{outcome:'partial',result:{recoverable:true,changeId:operationId,cause:'write_failed'}};
  if(a.name==='restore_change'){restores++;Object.assign(book.state,structuredClone(before));return{restored:true};}
  return book.action(a);
 });
 assert.equal(result.state,'done',result.error);assert.equal(restores,1);assert.equal(issued,2);assert.equal(book.state.values[0][0],42);assert.equal(result.recoveries[0].outcome,'restored_and_read_back');
});
