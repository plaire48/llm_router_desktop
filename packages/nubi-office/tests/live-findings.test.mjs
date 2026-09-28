// Regressions for failures observed in the first live baseline (gpt-5.6-luna,
// simulated host, 2026-09-29). Each test names the recorded behavior it guards.
// Replies here are scripted: a pass proves the harness rule, not model quality.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseIntent} from '../worker/intent-agent.mjs';
import {createTemplateSession} from '../worker/template.mjs';
import {taskMessages,reviewMessages} from '../worker/office-harness.mjs';
import {startAgent} from '../worker/agent.mjs';
import {createSimHost,hostAction} from '../eval/sim/host.mjs';
import {formById} from '../eval/sim/forms.mjs';
import {contract,text,call,verdict,drive} from './harness-fixtures.mjs';

const fast={wait:async()=>{},random:()=>0};
const expense=formById('expense-report');
const open=async(form=expense)=>{const host=createSimHost();return{host,scope:(await host.call('init',form)).scope};};
// Records what the actor was shown so a test can read tool results and prompts.
function scripted({task,actor,review=payload=>verdict(payload)}){
  const seen={actor:[],planner:[],review:[]};let turn=0;
  return{seen,status:()=>({model:'scripted-control-fixture',provider:'fixture'}),complete:async(messages,tools)=>{
    const system=messages[0].content;
    if(system.startsWith('NUBI_TASK_PLANNER')){seen.planner.push(messages);return text(JSON.stringify(task));}
    if(/^NUBI_(ACTION|STEP|RESULT)_REVIEWER/.test(system)){seen.review.push(messages);return review(JSON.parse(messages[1].content));}
    seen.actor.push({messages,tools});return actor[turn++]??text('완료했습니다.');
  }};
}
const approveAll=host=>action=>action.name==='request_approval'?{approved:true}:hostAction(host,action);
async function run(options,host){
  const agent=startAgent({resilienceOptions:fast,...options});
  for(let i=0;i<2000;i++){
    const status=agent.status();if(status.state!=='running'){await agent.promise;return agent.status();}
    if(status.action)agent.respond(status.action.callId,status.action.name==='show_plan'?{displayed:true}:await approveAll(host)(status.action));
    await new Promise(resolve=>setImmediate(resolve));
  }
  agent.cancel();await agent.promise;throw new Error('test timed out');
}

test('the router may add a question to an execution mode; the question is left to the executor',()=>{
  // Recorded: {"mode":"template","question":{...}} three times, then a recovery stop.
  const routed=parseIntent(text(JSON.stringify({mode:'template',question:{question:'일비를 얼마로 입력할까요?',choices:[{label:'직접 입력'}],input_mode:'text'}})));
  assert.deepEqual(routed,{mode:'template'});
  assert.equal(parseIntent(text(JSON.stringify({mode:'clarify',question:{question:'어느 문서를 수정할까요?',choices:[],input_mode:'text'}}))).mode,'clarify');
  assert.throws(()=>parseIntent(text(JSON.stringify({mode:'clarify'}))),/task_plan_invalid/);
  assert.throws(()=>parseIntent(text(JSON.stringify({mode:'edit',scope:'B1'}))),/task_plan_invalid/);
});
test('an empty answer for an optional field writes nothing when the cell is already empty',async()=>{
  // Recorded: the model sent "" for an unused remark and the cell changed from empty to empty text.
  const {scope}=await open(),session=createTemplateSession(scope);session.confirm(session.propose(expense.fields,scope),scope);
  const plan=session.plan([{fieldId:'field_B4',value:'총무팀'},{fieldId:'field_B11',value:''}],scope);
  assert.deepEqual(plan.operations,[{type:'set_values',address:'B4',values:[['총무팀']]}]);
  assert.deepEqual(session.plan([{fieldId:'field_B4',value:'총무팀'},{fieldId:'field_B11',value:null}],scope).operations.map(op=>op.address),['B4']);
  assert.throws(()=>session.plan([{fieldId:'field_B11',value:''}],scope),/template_values_missing/);
  assert.throws(()=>session.plan([{fieldId:'field_B4',value:''}],scope),/template_value_required/);
});
test('an empty answer for an optional field clears a sample value instead of writing empty text',async()=>{
  const {scope}=await open({...expense,cells:{...expense.cells,B11:{value:'예) 사무용품'}}}),session=createTemplateSession(scope);
  session.confirm(session.propose(expense.fields,scope),scope);
  assert.deepEqual(session.plan([{fieldId:'field_B11',value:''}],scope).operations,[{type:'set_values',address:'B11',values:[[null]]}]);
});
test('registration ignores plan checks that only a write could satisfy',async()=>{
  // Recorded: the plan required input cells to be non-empty. Registration writes
  // nothing, so the run failed its own checks after the template was registered.
  const {host,scope}=await open();
  const task=contract([{address:'B8',field:'formula',operator:'equals',expected:'=ROUND(B7*0.1,0)'},{address:'B3',field:'value',operator:'not_empty'},{address:'E5',field:'value',operator:'not_empty'}],{intent:'analyze'});
  const providers=scripted({task,actor:[call('define_template_fields',{fields:expense.fields}),call('register_template',{name:'지출 결의서',purpose:'부서 경비 지출 승인 요청'}),text('양식을 등록했습니다.')]});
  const status=await run({request:expense.register.request,scope,mode:'template-register',providers},host);
  assert.equal(status.state,'done',status.error);assert.equal(status.registeredTemplate.catalogued,true);assert.equal(status.recoveries.length,0);
  assert.deepEqual(status.task.checks.map(check=>check.address),['B8']);
  assert.ok(status.task.steps.every(step=>step.checkIndexes.every(index=>index<status.task.checks.length)));
});
test('the registration receipt tells the model that the task is finished',async()=>{
  // Recorded: after a successful registration the model called unrelated tools
  // and proposed the same mapping again, asking the user to approve it twice.
  const {host,scope}=await open(),providers=scripted({task:contract([],{intent:'analyze'}),actor:[call('define_template_fields',{fields:expense.fields}),call('register_template',{name:'지출 결의서',purpose:'부서 경비 지출 승인 요청'}),text('양식을 등록했습니다.')]});
  await run({request:expense.register.request,scope,mode:'template-register',providers},host);
  const receipts=providers.seen.actor.map(({messages})=>messages.at(-1)).filter(message=>message.role==='tool').map(message=>JSON.parse(message.content));
  const mapped=receipts.find(item=>Array.isArray(item.fields)),registered=receipts.find(item=>item.saved===true);
  assert.match(mapped.instruction,/register_template/);assert.match(registered.instruction,/final|summary/i);assert.match(registered.instruction,/not call/i);
});
test('planner, actor and reviewer prompts state the rules the live model broke',async()=>{
  const {host,scope}=await open(),planner=taskMessages('요청',[],scope,'edit')[0].content;
  assert.match(planner,/WITHOUT a sheet name/);assert.match(planner,/validation, merge/);
  const providers=scripted({task:contract([],{intent:'analyze'}),actor:[text('분석했습니다.')]});
  await run({request:'선택한 표를 설명해줘',scope,mode:'analyze',providers},host);
  assert.match(providers.seen.actor[0].messages[0].content,/exactly ONE tool/);
  const review=reviewMessages({request:'요청',history:[],task:contract([]),evidence:[],answer:''})[0].content;
  assert.match(review,/cannot observe/);assert.match(review,/never a reason for revise or blocked/);
});
test('registration planning is told that nothing is written',async()=>{
  const {host,scope}=await open(),providers=scripted({task:contract([],{intent:'analyze'}),actor:[text('분석했습니다.')]});
  await run({request:expense.register.request,scope,mode:'template-register',providers},host).catch(()=>{});
  assert.match(providers.seen.planner[0][0].content,/writes nothing/);
});
test('a rejected edit tells the actor which operation is wrong',async()=>{
  // Recorded: apply_changes was rejected three times with only "invalid_range".
  const edit={id:'edit',mode:'edit',range:'A1:C4',auditRange:'A1:F6',cells:{A1:{value:'수량'},A2:{value:2}},sourceSheets:[{name:'동부',auditRange:'A1:C4',cells:{B2:{value:120}}}]};
  const {host,scope}=await open(edit);
  const providers=scripted({task:contract([{address:'A2',field:'value',operator:'equals',expected:4}]),actor:[call('apply_changes',{plan:JSON.stringify({operations:[{type:'set_values',address:'동부!A2',values:[[4]]}]})}),call('apply_changes',{plan:JSON.stringify({operations:[{type:'set_values',address:'A2',values:[[4]]}]})}),text('A2를 4로 바꿨습니다.')]});
  providers.complete=(original=>async(messages,tools)=>messages[0].content.startsWith('NUBI_RECOVERY_PLANNER')?text(JSON.stringify({decision:'revise',summary:'주소를 고칩니다.',nextAction:'선택한 시트의 A2에 다시 적용합니다.',question:''})):original(messages,tools))(providers.complete);
  const status=await run({request:'A2를 4로 바꿔줘',scope,mode:'edit',providers},host);
  assert.equal(status.state,'done',status.error);
  const rejected=providers.seen.actor.map(({messages})=>messages.at(-1)).filter(message=>message.role==='tool').map(message=>JSON.parse(message.content)).find(item=>item.error);
  assert.equal(rejected.error,'out_of_scope');assert.match(rejected.issue,/operations\[0\]\.address/);assert.match(rejected.issue,/another worksheet/);
});
test('a worksheet may be read by its exact name without a separate catalog call',async()=>{
  // Recorded in three cases: read_worksheet_range {"sheetId":"견적서"} failed as worksheet_not_discovered.
  const {createWorkbookContext}=await import('../worker/workbook-context.mjs');
  const edit={id:'edit',mode:'edit',range:'A1:B3',auditRange:'A1:F6',cells:{A1:{value:'전체 매출'}},sourceSheets:[{name:'동부',auditRange:'A1:C4',cells:{B1:{value:'매출'},B2:{value:120},B3:{value:80}}}]};
  const {host,scope}=await open(edit),calls=[];
  const context=createWorkbookContext({scope,host:(name,extra)=>{calls.push(name);return hostAction(host,{name,scopeId:scope.scopeId,...extra});},providers:scripted({task:contract([]),actor:[]}),signal:new AbortController().signal,activity:{start:()=>({}),end(){},note(){}},metrics:{}});
  const read=await context.execute('read_worksheet_range',{sheetId:'동부',address:'동부!B1:B3'});
  assert.deepEqual([read.worksheet,read.address,read.preview.values.map(row=>row[0])],['동부','B1:B3',['매출',120,80]]);assert.deepEqual(calls,['workbook_sheets','workbook_range']);
  assert.equal((await context.execute('inspect_worksheet',{sheetId:'동부',part:'layout'})).worksheet,'동부');
  const missing=await context.execute('read_worksheet_range',{sheetId:'없는시트',address:'A1'}).catch(error=>error);
  assert.equal(missing.message,'worksheet_not_discovered');assert.match(missing.issue,/list_worksheets/);
  const other=await context.execute('read_worksheet_range',{sheetId:'동부',address:'CaseSheet!A1'}).catch(error=>error);
  assert.equal(other.message,'out_of_scope');
});
test('the router is told to leave business values to the executor',async()=>{
  // Recorded: the router asked for a field value before any work started.
  const {startIntentAgent}=await import('../worker/intent-agent.mjs');
  const {scope}=await open(),prompts=[];
  const agent=startIntentAgent({request:'담당 부서를 물어본 뒤 입력해줘',scope,mode:'auto',resilienceOptions:fast,providers:{status:()=>({model:'fixture'}),complete:async messages=>{prompts.push(messages[0].content);return text('{"mode":"analyze"}');}}},{cells:()=>({promise:Promise.resolve(),status:()=>({state:'done',metrics:{}}),cancel(){},respond(){}}),document:()=>{throw new Error('unexpected');}});
  await agent.promise;
  assert.match(prompts[0],/executor asks/);assert.match(prompts[0],/kind of work is unclear/);
});

// ---- Second live round (2026-09-29): failures that appeared once plans were accepted ----
const training=formById('training-request'),trip=formById('trip-request');
async function registered(form){
  const {createTemplateRecord}=await import('../worker/template-library.mjs');
  const {host,scope}=await open(form),session=createTemplateSession(scope);session.confirm(session.propose(form.fields,scope),scope);
  const record=createTemplateRecord({name:form.title,purpose:form.title+' 작성',notes:'',profile:session.profile(),model:{model:'answer-key',provider:'evaluation'}});
  await host.call('template_register',{scopeId:scope.scopeId,record,expectedFingerprint:scope.fingerprint});await host.call('template_catalog_index',{templateId:record.id});
  const opened=await host.call('template_catalog_use',{templateId:record.id,auditRange:form.auditRange});
  return{host,scope:opened.scope,record:opened.record};
}
const fillAll=form=>call('fill_template_fields',{values:Object.entries(form.reuse.values).map(([address,value])=>({fieldId:'field_'+address,value}))});

test('an edit operation written as {set_values:{...}} is read as the same operation',async()=>{
  // Recorded 11 times: the tool text "set_values {address,values}" was read as a wrapper key.
  const {normalizePlan}=await import('../worker/cell-format.mjs'),{scope}=await open();
  const plan=normalizePlan({operations:[{set_values:{address:'B7',values:[[5]]}},{format_range:{address:'B7',bold:true}},{type:'set_formulas',address:'B9',formulas:[['=B7+B8']]}]},scope);
  assert.deepEqual(plan.operations,[{type:'set_values',address:'B7',values:[[5]]},{type:'format_range',address:'B7',bold:true},{type:'set_formulas',address:'B9',formulas:[['=B7+B8']]}]);
});
test('an operation of unknown shape is refused with the expected shape shown',async()=>{
  const {normalizePlan}=await import('../worker/cell-format.mjs'),{scope}=await open();
  for(const operation of [{address:'B7',values:[[5]]},{type:'write',address:'B7'},{set_values:{address:'B7',values:[[5]]},note:'x'},{update:{address:'B7'}}]){
    const error=(()=>{try{normalizePlan({operations:[operation]},scope);}catch(cause){return cause;}})();
    assert.equal(error?.message,'unsupported_operation',JSON.stringify(operation));assert.match(error.issue,/operations\[0\]\.type/);assert.match(error.issue,/"type":"set_values"/);
  }
  const missing=(()=>{try{normalizePlan({operations:[{type:'set_values',values:[[5]]}]},scope);}catch(cause){return cause;}})();
  assert.equal(missing.message,'invalid_range');assert.match(missing.issue,/operations\[0\]\.address is missing/);
});
test('the edit tool description shows one literal example of the plan',async()=>{
  const {excelTools}=await import('../worker/agent.mjs'),description=excelTools.find(tool=>tool.function.name==='apply_changes').function.description;
  assert.match(description,/\{"operations":\[\{"type":"set_values","address":"A2","values":\[\[4\]\]\}/);
});
test('a loaded template profile hides the mapping tool so the user is not asked again',async()=>{
  // Recorded: with a registered template loaded the model proposed the mapping again.
  const {host,scope,record}=await registered(expense);
  const task=contract(Object.keys(expense.reuse.values).map(address=>({address,field:'value',operator:'not_empty'})));
  const providers=scripted({task,actor:[fillAll(expense),text('작성했습니다.')]});
  const status=await run({request:expense.reuse.request,scope,mode:'template',templateRecord:record,providers},host);
  assert.equal(status.state,'done',status.error);
  const names=providers.seen.actor[0].tools.map(tool=>tool.function.name);
  assert.equal(names.includes('define_template_fields'),false);assert.ok(names.includes('fill_template_fields')&&names.includes('ask_template_field'));
  const plain=scripted({task,actor:[text('확인했습니다.')]}),fresh=await open();
  await run({request:expense.reuse.request,scope:fresh.scope,mode:'template',providers:plain},fresh.host).catch(()=>{});
  assert.ok(plain.seen.actor[0].tools.some(tool=>tool.function.name==='define_template_fields'));
});
test('an expected value written as displayed text is read through the observed cell format',async()=>{
  // Recorded: checks expected "2026-11-02" and "80%" as text; Excel holds 46328 and 0.8, so they never matched.
  const {parseTask}=await import('../worker/office-harness.mjs'),{normalizeTypedValue}=await import('../worker/cell-format.mjs'),{scope}=await open(training);
  const task=parseTask(text(JSON.stringify(contract([{address:'C7',field:'value',operator:'equals',expected:'2026-11-02'},{address:'C9',field:'value',operator:'equals',expected:'80%'},{address:'C8',field:'value',operator:'equals',expected:'400,000'},{address:'C5',field:'value',operator:'equals',expected:'010-2345-6789'},{address:'C6',field:'value',operator:'equals',expected:'2026-11-02'}]))),scope,'edit');
  assert.deepEqual(task.checks.map(check=>check.expected),[normalizeTypedValue('2026-11-02','date'),0.8,400000,'010-2345-6789','2026-11-02']);
});
test('a template fill that writes every field at once completes a plan split into several edit steps',async()=>{
  // Recorded: the plan had two edit steps, the actor filled all fields in one call and every retry was rejected.
  const {host,scope,record}=await registered(trip),values=Object.keys(trip.reuse.values);
  const first=values.filter(address=>address!=='C10'),check=address=>({address,field:'value',operator:'not_empty'});
  const task=contract([...first.map(check),check('C10')],{steps:[{id:'inspect',title:'양식 확인',kind:'inspect',checkIndexes:[]},{id:'info',title:'출장 정보 입력',kind:'edit',checkIndexes:first.map((_,index)=>index)},{id:'allowance',title:'일비 입력',kind:'edit',checkIndexes:[first.length]},{id:'verify',title:'결과 확인',kind:'verify',checkIndexes:[]}]});
  const providers=scripted({task,actor:[fillAll(trip),text('출장 신청서를 작성했습니다.')]});
  const status=await run({request:trip.reuse.request,scope,mode:'template',templateRecord:record,providers},host);
  assert.equal(status.state,'done',status.error);assert.equal(status.writes,1);assert.equal(status.recoveries.length,0);
  const after=await host.call('audit');assert.deepEqual([after.values[6][2],after.values[9][4]],[3,150000]);
});
test('template tools say which call must come first',async()=>{
  // Recorded: ask_template_field and fill_template_fields were called before any mapping existed.
  const {scope}=await open(),session=createTemplateSession(scope);
  const unknown=(()=>{try{session.question('field_B3');}catch(cause){return cause;}})(),unmapped=(()=>{try{session.plan([{fieldId:'field_B3',value:'0092'}],scope);}catch(cause){return cause;}})();
  assert.equal(unknown.message,'template_field_unknown');assert.match(unknown.issue,/define_template_fields/);
  assert.equal(unmapped.message,'template_mapping_required');assert.match(unmapped.issue,/define_template_fields/);
});
test('the actor is told not to ask again for what the request already states',async()=>{
  const {host,scope}=await open(),providers=scripted({task:contract([],{intent:'analyze'}),actor:[text('분석했습니다.')]});
  await run({request:'선택한 표를 설명해줘',scope,mode:'analyze',providers},host);
  assert.match(providers.seen.actor[0].messages[0].content,/already states/);
  const {TEMPLATE_GUIDANCE}=await import('../worker/template.mjs');
  assert.match(TEMPLATE_GUIDANCE,/exactly one edit step/i);assert.match(TEMPLATE_GUIDANCE,/request does not give/);
});

// ---- Third live round (2026-09-29) ----
test('an expected empty value matches an empty cell whether Excel reports null or empty text',async()=>{
  // Recorded: the plan expected "" for an unused remark; the untouched cell read null and never matched.
  const {inspectChecks}=await import('../worker/office-harness.mjs'),{scope}=await open();
  const verdicts=inspectChecks([{address:'B11',field:'value',operator:'equals',expected:''},{address:'B11',field:'value',operator:'equals',expected:null},{address:'A11',field:'value',operator:'equals',expected:''},{address:'B7',field:'value',operator:'equals',expected:0}],scope).checks.map(check=>check.status);
  assert.deepEqual(verdicts,['met','met','unmet','unmet']);
});
test('the reviewer of a proposed edit is told that its evidence predates the edit',()=>{
  // Recorded: a correct proposal was sent back because the evidence showed the state before input.
  const proposal=reviewMessages({request:'요청',history:[],task:contract([]),evidence:[],answer:'',proposal:{operations:[]}})[0].content;
  assert.match(proposal,/BEFORE the edit/);assert.match(proposal,/do not require post-edit/i);
  assert.doesNotMatch(reviewMessages({request:'요청',history:[],task:contract([]),evidence:[],answer:''})[0].content,/do not require post-edit/i);
});
test('a typed write does not rewrite a number format the cell already has',async()=>{
  // Recorded: numberFormat "General" was sent for a General cell; the extra format
  // write was not part of the planned step and the edit was rejected.
  const {normalizePlan}=await import('../worker/cell-format.mjs'),{scope}=await open();
  assert.deepEqual(normalizePlan({operations:[{type:'set_typed_values',address:'B4',values:[[73]],valueType:'number',numberFormat:'General'}]},scope).operations,[{type:'set_values',address:'B4',values:[[73]]}]);
  assert.deepEqual(normalizePlan({operations:[{type:'set_typed_values',address:'B3',values:[['0092']],valueType:'text'}]},scope).operations,[{type:'set_values',address:'B3',values:[['0092']]}]);
  assert.deepEqual(normalizePlan({operations:[{type:'set_typed_values',address:'B4',values:[['0092']],valueType:'text'}]},scope).operations,[{type:'set_values',address:'B4',values:[['0092']]},{type:'format_range',address:'B4',numberFormat:'@'}]);
  assert.deepEqual(normalizePlan({operations:[{type:'set_typed_values',address:'B3:B4',values:[['1'],['2']],valueType:'text'}]},scope).operations.length,2);
});

// ---- Fourth live round (2026-09-29) ----
test('a typed check needs a concrete value; an unknown value uses not_empty',async()=>{
  // Recorded: the plan expected null with valueType number for a value it had not read yet.
  // The empty cell already satisfied it, the edit step closed, and every write was refused.
  const {parseTask}=await import('../worker/office-harness.mjs'),{scope}=await open();
  const error=(()=>{try{parseTask(text(JSON.stringify(contract([{address:'B7',field:'value',operator:'equals',expected:null,valueType:'number'}]))),scope,'edit');}catch(cause){return cause;}})();
  assert.equal(error?.message,'task_plan_invalid');assert.match(error.issue,/checks\[0\]\.expected/);assert.match(error.issue,/not_empty/);
  assert.equal(parseTask(text(JSON.stringify(contract([{address:'B11',field:'value',operator:'equals',expected:null}]))),scope,'edit').checks[0].expected,null);
});
test('a write outside the active step says which step is active and what it covers',async()=>{
  const {createPlanProgress}=await import('../worker/office-plan.mjs');
  const task=contract([{address:'A2',field:'value',operator:'equals',expected:4}]),progress=createPlanProgress(task);
  progress.observe({address:'A1:B2',values:[[1,2],[3,4]],formulas:[[null,null],[null,null]],errors:[[false,false],[false,false]]});
  const outside=(()=>{try{progress.assertEdit([{address:'B2',field:'value',operator:'equals',expected:[[9]]}]);}catch(cause){return cause;}})();
  assert.equal(outside.message,'plan_step_mismatch');assert.match(outside.issue,/B2/);assert.match(outside.issue,/work/);assert.match(outside.issue,/A2/);
  progress.beginEdit(['A2']);progress.approve({address:'A1:B2',values:[[1,2],[4,4]],formulas:[[null,null],[null,null]],errors:[[false,false],[false,false]]});
  const closed=(()=>{try{progress.assertEdit([{address:'A2',field:'value',operator:'equals',expected:[[5]]}]);}catch(cause){return cause;}})();
  assert.equal(closed.message,'plan_step_mismatch');assert.match(closed.issue,/no edit step is active/i);
});
test('guidance covers the unnecessary questions and the shortened text seen in live runs',async()=>{
  const {TEMPLATE_GUIDANCE}=await import('../worker/template.mjs'),{TEMPLATE_REGISTRATION_GUIDANCE}=await import('../worker/template-library.mjs');
  assert.match(TEMPLATE_GUIDANCE,/verbatim/);assert.match(TEMPLATE_REGISTRATION_GUIDANCE,/Do not ask for permission/);
  const {startIntentAgent}=await import('../worker/intent-agent.mjs'),{scope}=await open(),prompts=[];
  const agent=startIntentAgent({request:'입력 항목을 확인받고 입력해줘',scope,mode:'auto',resilienceOptions:fast,providers:{status:()=>({model:'fixture'}),complete:async messages=>{prompts.push(messages[0].content);return text('{"mode":"analyze"}');}}},{cells:()=>({promise:Promise.resolve(),status:()=>({state:'done',metrics:{}}),cancel(){},respond(){}}),document:()=>{throw new Error('unexpected');}});
  await agent.promise;assert.match(prompts[0],/instructions for the executor/);
});

// ---- Live measurement of calling a template (2026-09-29, invoke suite) ----
test('a verdict that lists host-unverifiable properties is returned with the reason, and the correct result is accepted',async()=>{
  // Recorded: the copy was filled correctly and every requested check was met. The reviewer added
  // {"requirement":"그림·차트·조건부 서식·인쇄 결과·범위 밖 내용·NASCA 상태","status":"unknown"} to a complete verdict,
  // got "goal_review_failed" without a reason, answered revise with "추가 수정은 필요하지 않습니다" and the run failed.
  const {parseReview}=await import('../worker/office-harness.mjs'),{installTemplates}=await import('../eval/sim/catalog.mjs');
  const evidence=[{id:10,usable:true},{id:11,usable:true},{id:12,usable:true}];
  const recorded=(ids,unknown)=>text(JSON.stringify({status:'complete',checks:[{requirement:'신청자·부서·연락처·과정명이 지정 셀에 입력됨',status:'met',evidence_ids:ids},{requirement:'그림·차트·조건부 서식·인쇄 결과·범위 밖 내용·NASCA 상태',status:'unknown',evidence_ids:unknown}],next_step:'없음'}));
  assert.throws(()=>parseReview(recorded([10,12],[11]),evidence),error=>error.message==='goal_review_failed'&&/unverified/.test(error.issue)&&/checks/.test(error.issue));
  assert.throws(()=>parseReview(text(JSON.stringify({status:'revise',checks:[{requirement:'입력됨',status:'met',evidence_ids:[10]}],next_step:'추가 수정은 필요하지 않습니다.'})),evidence),error=>/complete/.test(error.issue));
  assert.throws(()=>parseReview(text(JSON.stringify({status:'complete',checks:[{requirement:'입력됨',status:'met',evidence_ids:[99]}],next_step:''})),evidence),error=>/evidence/.test(error.issue));
  assert.throws(()=>parseReview(text('검토했습니다.'),evidence),error=>/JSON/.test(error.issue));
  assert.equal(parseReview(text(JSON.stringify({status:'complete',checks:[{requirement:'입력됨',status:'met',evidence_ids:[10]}],next_step:''})),evidence).status,'complete');
  assert.match(reviewMessages({request:'r',history:[],task:{checks:[]},evidence:[]})[0].content,/never listed in checks/);

  const form=formById('training-request'),host=createSimHost(),installed=await installTemplates(host,[form]);
  const opened=await host.call('template_catalog_use',{templateId:installed.get(form.id).record.id});let finals=0;
  const providers=scripted({task:contract(Object.keys(form.reuse.values).map(address=>({address,field:'value',operator:'not_empty'}))),
    actor:[call('fill_template_fields',{values:Object.entries(form.reuse.values).map(([address,value])=>({fieldId:'field_'+address,value}))}),text('작성했습니다.')],
    review:payload=>payload.proposed_edit||payload.current_step||finals++?verdict(payload):recorded([payload.evidence[0].id],[payload.evidence.find(item=>item.tool==='template_preservation').id])});
  const status=await run({request:form.reuse.request,scope:opened.scope,mode:'template',providers,templateRecord:opened.record,templateBinding:{documentId:opened.scope.documentId,worksheet:opened.scope.worksheet,address:opened.scope.address}},host);
  assert.equal(status.state,'done',status.error);assert.equal(finals,2);
  const feedback=JSON.parse(providers.seen.review.at(-1).at(-1).content);
  assert.equal(feedback.error,'goal_review_failed');assert.match(feedback.issue,/unverified/);
});
