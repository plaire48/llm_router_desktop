// Drives the whole simulated evaluation with SCRIPTED model replies. These
// tests check the runner, the simulated user and the grading. They measure no
// model: a pass here says nothing about GPT, Qwen or Excel 2016.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {evaluateSimulated} from '../eval/sim/run.mjs';
import {formById} from '../eval/sim/forms.mjs';
import {scriptedProvider,contract,call,text,planCall} from './harness-fixtures.mjs';

const fast={resilienceOptions:{wait:async()=>{},random:()=>0}};
async function output(t){const directory=await mkdtemp(join(tmpdir(),'nubi-sim-run-'));t.after(()=>rm(directory,{recursive:true,force:true}));return directory;}
const provider=options=>({...scriptedProvider(options),status:()=>({provider:'fixture',model:'scripted-control-fixture',connected:true})});
const checks=list=>list.map(([address,field,operator,expected])=>({address,field,operator,...(expected===undefined?{}:{expected})}));
const editTask=contract(checks([['A2','value','equals',4],['A2','bold','equals',true],['C2','formula','equals','=A2*B2']]));
const editActor=[planCall([{type:'set_values',address:'A2',values:[[4]]},{type:'format_range',address:'A2',bold:true}]),text('A2를 4로 바꾸고 굵게 표시했습니다.')];
const expense=formById('expense-report');
// The plan must cover every cell the agent will fill, or the step guard rejects the write.
const fillTask=contract(Object.keys(expense.reuse.values).map(address=>({address,field:'value',operator:'not_empty'})));
const fillActor=[call('fill_template_fields',{values:Object.entries(expense.reuse.values).map(([address,value])=>({fieldId:'field_'+address,value}))}),text('지출 결의서를 작성했습니다.')];
// A scripted provider is shared by every trial, so repeated trials need replies chosen from the conversation.
const steps=list=>messages=>list[messages.filter(message=>message.role==='tool').length]??text('완료했습니다.');
const registerActor=fields=>[call('define_template_fields',{fields}),call('register_template',{name:'지출 결의서',purpose:'부서 경비 지출 승인 요청'}),text('양식을 등록했습니다.')];

test('an edit case runs to a passing grade through the direct route',async t=>{
  const report=await evaluateSimulated({providers:provider({task:editTask,actor:editActor}),suites:['edit'],caseIds:['value-and-format'],routing:'direct',outputDir:await output(t),agentOptions:fast});
  const [result]=report.results;
  assert.deepEqual([result.suite,result.id,result.trial,result.outcome,result.passed,result.state],['edit','value-and-format',1,'passed',true,'done']);
  assert.equal(result.score.checks.verified,true);assert.deepEqual(result.score.unexpectedChanges,[]);assert.equal(result.writes,1);
  assert.deepEqual([result.transcript.byRole.planner,result.transcript.toolCalls.apply_changes],[1,1]);
});
test('the product route asks the router first and then runs the same agent',async t=>{
  const report=await evaluateSimulated({providers:provider({task:editTask,actor:[text('{"mode":"edit"}'),...editActor]}),suites:['edit'],caseIds:['value-and-format'],routing:'product',outputDir:await output(t),agentOptions:fast});
  assert.deepEqual([report.results[0].outcome,report.results[0].transcript.byRole.intent_router,report.routing],['passed',1,'product']);
});
test('registering with the answer key mapping passes and leaves a catalogued receipt',async t=>{
  const report=await evaluateSimulated({providers:provider({task:contract([],{intent:'analyze'}),actor:registerActor(expense.fields)}),suites:['register'],caseIds:['expense-report'],outputDir:await output(t),agentOptions:fast});
  const [result]=report.results;
  assert.deepEqual([result.outcome,result.passed,result.state,result.error],['passed',true,'done',undefined]);
  assert.deepEqual([result.score.mapping.exact,result.score.mapping.strict,result.score.mapping.recall,result.score.registered,result.score.sourceUnchanged],[true,true,1,true,true]);
  assert.deepEqual(result.approvals,['template_mapping','template_register']);
});
test('a rejected formula field is retried and an incomplete mapping fails the grade',async t=>{
  const incomplete=expense.fields.filter(field=>field.address!=='B11');
  const report=await evaluateSimulated({providers:provider({task:contract([],{intent:'analyze'}),actor:[call('define_template_fields',{fields:[...incomplete,{address:'B8',label:'부가세',valueType:'number',required:true}]}),...registerActor(incomplete)]}),
    suites:['register'],caseIds:['expense-report'],outputDir:await output(t),agentOptions:fast});
  const [result]=report.results;
  assert.deepEqual([result.outcome,result.passed,result.state],['failed',false,'done']);
  assert.deepEqual([result.score.mapping.exact,result.score.mapping.missing,result.score.mapping.unexpected,result.score.registered],[false,['B11'],[],true]);
  assert.ok(result.recoveries>=1);assert.equal(result.proposals,1,'the rejected proposal never reached the user');
});
test('reuse starts from the answer key record, fills the copy and leaves the template unchanged',async t=>{
  const report=await evaluateSimulated({providers:provider({task:fillTask,actor:fillActor}),suites:['reuse'],caseIds:['expense-report'],routing:'direct',outputDir:await output(t),agentOptions:fast});
  const [result]=report.results;
  assert.deepEqual([result.outcome,result.passed,result.state,result.error],['passed',true,'done',undefined]);
  assert.equal(result.score.checks.verified,true);assert.equal(result.score.persistedChecks.verified,true);assert.deepEqual(result.score.unexpectedChanges,[]);assert.equal(result.score.templateUnchanged,true);
  assert.deepEqual(result.approvals,['edit']);
});
test('a wrong value fails the reuse grade even when the agent reports success',async t=>{
  const wrong=fillActor.with(0,call('fill_template_fields',{values:Object.entries({...expense.reuse.values,B7:999}).map(([address,value])=>({fieldId:'field_'+address,value}))}));
  const report=await evaluateSimulated({providers:provider({task:fillTask,actor:wrong}),suites:['reuse'],caseIds:['expense-report'],routing:'direct',outputDir:await output(t),agentOptions:fast});
  const [result]=report.results;
  assert.deepEqual([result.outcome,result.passed,result.state],['failed',false,'done']);
  assert.deepEqual(result.score.checks.checks.filter(check=>check.status!=='met').map(check=>check.address),['B7','B8','B9']);
});
test('a question the fixture user cannot answer stops the case instead of inventing an answer',async t=>{
  const report=await evaluateSimulated({providers:provider({task:fillTask,actor:[call('ask_user',{question:'결재자는 누구인가요?'})]}),suites:['reuse'],caseIds:['expense-report'],routing:'direct',outputDir:await output(t),agentOptions:fast});
  const [result]=report.results;
  assert.deepEqual([result.outcome,result.passed,result.error],['error',false,'evaluation_interaction_requires_human']);assert.deepEqual(result.questions,['결재자는 누구인가요?']);
});
test('a recovery approval is never granted by the runner',async t=>{
  const outside=planCall([{type:'set_values',address:'F6',values:[[1]]}]);
  const report=await evaluateSimulated({providers:provider({task:editTask,actor:()=>outside}),suites:['edit'],caseIds:['value-and-format'],routing:'direct',outputDir:await output(t),agentOptions:fast});
  const [result]=report.results;
  assert.deepEqual([result.outcome,result.passed,result.error],['error',false,'evaluation_recovery_requires_human']);assert.equal(result.writes,0);assert.ok(result.approvals.includes('recovery'));
});
test('a case that expects a question is left for semantic review when the agent asks',async t=>{
  const report=await evaluateSimulated({providers:provider({task:contract([],{intent:'clarify',questions:['적용할 회사 세율은 몇 퍼센트인가요?']})}),suites:['edit'],caseIds:['missing-tax-rate'],routing:'direct',outputDir:await output(t),agentOptions:fast});
  const [result]=report.results;
  assert.deepEqual([result.outcome,result.passed,result.state],['needs_review',null,'awaiting_user']);assert.equal(result.score.semanticReview.status,'pending');
});
test('the report states what it is and what it does not prove, and records every call',async t=>{
  const directory=await output(t);
  const report=await evaluateSimulated({providers:provider({task:editTask,actor:steps(editActor)}),suites:['edit'],caseIds:['value-and-format'],routing:'direct',trials:2,outputDir:directory,agentOptions:fast});
  assert.deepEqual([report.kind,report.schema,report.provider,report.model,report.host.simulated,report.results.length],['simulated-host-live-model-evaluation',1,'fixture','scripted-control-fixture',true,2]);
  assert.deepEqual(report.results.map(result=>result.trial),[1,2]);
  assert.deepEqual(report.summary.bySuite.edit,{total:2,passed:2,failed:0,needsReview:0,errors:0});
  assert.ok(report.limitations.some(line=>/Excel 2016/.test(line))&&report.limitations.some(line=>/Qwen/.test(line))&&report.limitations.some(line=>/synthetic/i.test(line)));
  assert.deepEqual(JSON.parse(await readFile(join(directory,'report.json'),'utf8')).summary,report.summary);
  const lines=(await readFile(join(directory,'edit-value-and-format-t1','transcript.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(lines.length,report.results[0].transcript.modelCalls);assert.equal(lines[0].role,'planner');
  assert.equal(JSON.parse(await readFile(join(directory,'edit-value-and-format-t1','result.json'),'utf8')).id,'value-and-format');
});
test('unknown suites, cases and routes are refused before any model call',async t=>{
  const providers=provider({task:editTask,actor:()=>{throw new Error('must not be called');}}),outputDir=await output(t);
  await assert.rejects(evaluateSimulated({providers,suites:['document'],outputDir}),/unknown_suite/);
  await assert.rejects(evaluateSimulated({providers,suites:['edit'],caseIds:['missing-case'],outputDir}),/unknown_case/);
  await assert.rejects(evaluateSimulated({providers,suites:['edit'],routing:'magic',outputDir}),/unknown_routing/);
  await assert.rejects(evaluateSimulated({providers,suites:['edit'],trials:0,outputDir}),/invalid_trials/);
});

// ---- Calling a registered template (scripted replies) ----
const quotation=formById('quotation');
const quoteTask=contract(Object.keys(quotation.reuse.values).map(address=>({address,field:'value',operator:'not_empty'})));
const quoteFill=call('fill_template_fields',{values:Object.entries(quotation.reuse.values).map(([address,value])=>({fieldId:'field_'+address,value}))});
test('a command opens the named template, fills the copy and leaves the open workbook untouched',async t=>{
  const report=await evaluateSimulated({providers:provider({task:quoteTask,actor:[quoteFill,text('견적서를 작성했습니다.')]}),suites:['invoke'],caseIds:['command-quotation'],outputDir:await output(t),agentOptions:fast});
  const [result]=report.results;
  assert.deepEqual([result.outcome,result.state,result.error],['passed','done',undefined]);
  assert.deepEqual([result.score.selected,result.score.openWorkbookUntouched,result.score.checks.verified,result.score.unexpectedChanges],[true,true,true,[]]);
  assert.equal(result.transcript.byRole.intent_router,undefined,'a command needs no routing call');
});
test('opening the wrong template fails the case even when the fill succeeds',async t=>{
  // A vague request retrieves both trip templates; the scripted router picks the settlement form.
  const settlement=formById('trip-settlement'),task=contract(Object.keys(settlement.reuse.values).map(address=>({address,field:'value',operator:'not_empty'})));
  const fill=call('fill_template_fields',{values:Object.entries(settlement.reuse.values).map(([address,value])=>({fieldId:'field_'+address,value}))});
  const providers=provider({task,actor:messages=>messages[0].content.startsWith('NUBI_INTENT_ROUTER')?text(JSON.stringify({mode:'template',templateId:JSON.parse(messages.at(-1).content).registeredTemplates.find(item=>item.name==='출장 정산서').id})):messages.some(message=>message.role==='tool')?text('작성했습니다.'):fill});
  const report=await evaluateSimulated({providers,suites:['invoke'],caseIds:['vague-trip'],extraInvokeCases:[{id:'vague-trip',form:'trip-request',request:'출장 서류를 작성해줘',dialogue:[]}],outputDir:await output(t),agentOptions:fast});
  const [result]=report.results;
  assert.deepEqual([result.outcome,result.passed,result.state,result.score.selected],['failed',false,'done',false]);
  assert.notEqual(result.score.openedTemplate,result.score.expectedTemplate);
});
test('an unknown command passes only when nothing is opened or written',async t=>{
  const report=await evaluateSimulated({providers:provider({task:quoteTask,actor:()=>{throw new Error('the model must not be called');}}),suites:['invoke'],caseIds:['command-unknown'],outputDir:await output(t),agentOptions:fast});
  assert.deepEqual([report.results[0].outcome,report.results[0].state,report.results[0].score.openedTemplate,report.results[0].transcript.modelCalls],['passed','unsupported',null,0]);
});
