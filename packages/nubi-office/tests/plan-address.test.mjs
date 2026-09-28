// Found by the first live run (gpt-5.6-luna, simulated host, 2026-09-29): the
// planner wrote check addresses as "CaseSheet!A2". The harness answered only
// "invalid_range", the model repeated the same plan three times, and the run
// stopped for recovery before any tool was called.
import test from 'node:test';
import assert from 'node:assert/strict';
import {localAddress} from '../worker/office-range.mjs';
import {parseTask} from '../worker/office-harness.mjs';
import {normalizePlan} from '../worker/cell-format.mjs';
import {createTemplateSession} from '../worker/template.mjs';
import {startAgent} from '../worker/agent.mjs';
import {createSimHost,hostAction} from '../eval/sim/host.mjs';
import {contract,text,call,planCall,verdict,drive} from './harness-fixtures.mjs';

const edit={id:'value-and-format',mode:'edit',range:'A1:C4',auditRange:'A1:F6',cells:{A1:{value:'수량'},B1:{value:'단가'},C1:{value:'금액'},A2:{value:2},B2:{value:1200},C2:{formula:'=A2*B2'}}};
const scope=async(definition=edit)=>{const host=createSimHost();return{host,scope:(await host.call('init',definition)).scope};};
const plan=(checks,overrides)=>text(JSON.stringify(contract(checks,overrides)));
const check=(address,field='value',operator='equals',expected=4)=>({address,field,operator,...(operator==='equals'?{expected}:{})});
const thrown=action=>{try{action();}catch(error){return error;}assert.fail('expected an error');};

test('an address may name the bound worksheet and no other',()=>{
  assert.equal(localAddress('A2','CaseSheet'),'A2');
  assert.equal(localAddress(' CaseSheet!A2 ','CaseSheet'),'A2');
  assert.equal(localAddress('casesheet!$A$2:$C$2','CaseSheet'),'$A$2:$C$2');
  assert.equal(localAddress("'출장 신청서'!B3:C3",'출장 신청서'),'B3:C3');
  assert.equal(localAddress("'O''Brien'!A1","O'Brien"),'A1');
  const other=thrown(()=>localAddress('동부!B2','CaseSheet'));
  assert.equal(other.message,'out_of_scope');assert.match(other.issue,/another worksheet/);
  for(const value of [null,42,{},'']) assert.equal(thrown(()=>localAddress(value,'CaseSheet')).message,'invalid_range');
});
test('the planner may qualify check addresses with the bound sheet name',async()=>{
  const {scope:bound}=await scope();
  const task=parseTask(plan([check('CaseSheet!A2'),check('CaseSheet!A2','bold','equals',true),check("'CaseSheet'!A2:C2",'value','no_error')]),bound,'edit');
  assert.deepEqual(task.checks.map(item=>item.address),['A2','A2','A2:C2']);
});
test('a check on another worksheet is refused with the failing check named',async()=>{
  const {scope:bound}=await scope(),error=thrown(()=>parseTask(plan([check('A2'),check('동부!B2')]),bound,'edit'));
  assert.equal(error.message,'out_of_scope');assert.match(error.issue,/checks\[1\]\.address/);assert.match(error.issue,/another worksheet/);
});
test('plan rejections say which part is wrong and what is allowed',async()=>{
  const {scope:bound}=await scope();
  const cases=[
    [[{address:'A2',field:'no_error',operator:'equals'}],'task_plan_invalid',/checks\[0\]\.field.*value.*formula/s,/no_error is an operator/],
    [[{address:'A2',field:'value',operator:'greater_than',expected:1}],'task_plan_invalid',/checks\[0\]\.operator.*equals.*not_empty.*no_error/s],
    [[{address:'A2',field:'value',operator:'equals'}],'task_plan_invalid',/checks\[0\]\.expected/],
    [[{address:'A2:B2',field:'value',operator:'equals',expected:[[1]]}],'task_plan_invalid',/checks\[0\]\.expected.*1 row.*2 column/s],
    [[check('Z9')],'task_plan_invalid',/checks\[0\]\.address.*A1:C4/s],
    [[check('A0')],'invalid_range',/checks\[0\]\.address/],
    [[check('A2')],'task_plan_invalid',/steps/,undefined,{steps:[{id:'only',title:'하나',kind:'edit',checkIndexes:[0]}]}],
    [[check('A2'),check('B2')],'task_plan_invalid',/checks\[1\].*not covered by an edit step/s,undefined,{steps:[{id:'inspect',title:'확인',kind:'inspect',checkIndexes:[]},{id:'work',title:'수정',kind:'edit',checkIndexes:[0]},{id:'verify',title:'검증',kind:'verify',checkIndexes:[0,1]}]}]
  ];
  for(const [checks,code,...rest] of cases){
    const overrides=rest.at(-1)&&!(rest.at(-1) instanceof RegExp)?rest.pop():undefined,patterns=rest.filter(Boolean);
    const error=thrown(()=>parseTask(plan(checks,overrides),bound,'edit'));
    assert.equal(error.message,code,JSON.stringify(checks));assert.equal(typeof error.issue,'string',code+' carries an issue');assert.ok(error.issue.length<=600);
    for(const pattern of patterns)assert.match(error.issue,pattern);
  }
});
test('a reply that is not the plan object says so',async()=>{
  const {scope:bound}=await scope();
  assert.match(thrown(()=>parseTask(text('계획은 다음과 같습니다.'),bound,'edit')).issue,/JSON object/);
  assert.match(thrown(()=>parseTask(text(JSON.stringify({...contract([check('A2')]),intent:'write'})),bound,'edit')).issue,/intent/);
  assert.match(thrown(()=>parseTask(text(JSON.stringify({...contract([check('A2')]),summary:''})),bound,'edit')).issue,/summary/);
  assert.match(thrown(()=>parseTask(text(JSON.stringify(contract([]))),bound,'edit')).issue,/edit intent requires at least one check/);
});
test('an edit plan may qualify operation addresses with the bound sheet name',async()=>{
  const {scope:bound}=await scope();
  const normalized=normalizePlan({operations:[{type:'set_values',address:'CaseSheet!A2',values:[[4]]},{type:'format_range',address:"'CaseSheet'!A2",bold:true},{type:'copy_format',address:'CaseSheet!B2',sourceAddress:'CaseSheet!A2',fields:['bold']}]},bound);
  assert.deepEqual(normalized.operations.map(op=>op.address),['A2','A2','B2']);
  const other=thrown(()=>normalizePlan({operations:[{type:'set_values',address:'동부!A2',values:[[4]]}]},bound));
  assert.equal(other.message,'out_of_scope');assert.match(other.issue,/operations\[0\]\.address/);
  assert.match(thrown(()=>normalizePlan({operations:[{type:'copy_format',address:'B2',sourceAddress:'동부!A2'}]},bound)).issue,/operations\[0\]\.sourceAddress/);
});
test('template fields may qualify their address with the bound sheet name',async()=>{
  const {scope:bound}=await scope({...edit,sheetName:'요청서',cells:{A2:{value:'담당 부서'}}}),session=createTemplateSession(bound);
  const proposed=session.propose([{address:'요청서!B2',label:'담당 부서',valueType:'text',required:true}],bound);
  assert.deepEqual([proposed[0].address,proposed[0].id],['B2','field_B2']);
  assert.throws(()=>session.propose([{address:'다른시트!B2',label:'담당 부서',valueType:'text',required:true}],bound),/out_of_scope|template_mapping_invalid/);
});
test('the live failure no longer stalls: sheet-qualified plan addresses run to completion',async()=>{
  const {host,scope:bound}=await scope();
  const qualified=contract([check('CaseSheet!A2'),check('CaseSheet!A2','bold','equals',true),check('CaseSheet!C2','formula','equals','=A2*B2')]);
  const actor=[planCall([{type:'set_values',address:'CaseSheet!A2',values:[[4]]},{type:'format_range',address:'CaseSheet!A2',bold:true}]),text('A2를 4로 바꾸고 굵게 표시했습니다.')];let turn=0,planner=0;
  const providers={status:()=>({model:'scripted-control-fixture'}),complete:async messages=>{
    const system=messages[0].content;
    if(system.startsWith('NUBI_TASK_PLANNER')){planner++;return text(JSON.stringify(qualified));}
    if(/^NUBI_(ACTION|STEP|RESULT)_REVIEWER/.test(system))return verdict(JSON.parse(messages[1].content));
    return actor[turn++]??text('완료했습니다.');
  }};
  const run=startAgent({request:edit.id,mode:'edit',scope:bound,providers,resilienceOptions:{wait:async()=>{},random:()=>0}});
  const status=await drive(run,action=>hostAction(host,action));
  assert.equal(status.state,'done',status.error);assert.equal(planner,1);assert.equal(status.recoveries.length,0);
  const after=await host.call('audit');assert.deepEqual([after.values[1][0],after.formats.bold[1][0],after.values[1][2]],[4,true,4800]);
});
test('a rejected plan tells the planner what to correct on the next attempt',async()=>{
  const {host,scope:bound}=await scope(),feedback=[];let planner=0,turn=0;
  const actor=[planCall([{type:'set_values',address:'A2',values:[[4]]}]),text('A2를 4로 바꿨습니다.')];
  const providers={status:()=>({model:'scripted-control-fixture'}),complete:async messages=>{
    const system=messages[0].content;
    if(system.startsWith('NUBI_TASK_PLANNER')){
      if(planner++===0)return text(JSON.stringify(contract([{address:'A2',field:'no_error',operator:'equals'}])));
      feedback.push(JSON.parse(messages.at(-1).content));return text(JSON.stringify(contract([check('A2')])));
    }
    if(/^NUBI_(ACTION|STEP|RESULT)_REVIEWER/.test(system))return verdict(JSON.parse(messages[1].content));
    return actor[turn++]??text('완료했습니다.');
  }};
  const run=startAgent({request:'A2를 4로 바꿔줘',mode:'edit',scope:bound,providers,resilienceOptions:{wait:async()=>{},random:()=>0}});
  const status=await drive(run,action=>hostAction(host,action));
  assert.equal(status.state,'done',status.error);assert.equal(planner,2);
  assert.equal(feedback[0].error,'task_plan_invalid');assert.match(feedback[0].issue,/checks\[0\]\.field/);
});
