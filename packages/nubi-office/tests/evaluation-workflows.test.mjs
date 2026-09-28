import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreDocumentCase} from '../eval/document-scoring.mjs';
import {fixtureInteraction} from '../eval/interactions.mjs';
import {driveEvaluationRun} from '../eval/driver.mjs';
import {reviewTemplate,applyHumanReviews} from '../eval/review.mjs';
import {compareTrials} from '../eval/compare.mjs';
const business={expectedSheets:['예산'],documentChecks:[{sheet:'예산',address:'A1',field:'value',expected:'총액'},{sheet:'예산',address:'B1',field:'value',expected:30},{sheet:'예산',address:'B1',field:'formula',functions:['SUM'],references:['B2:B3']}]};
const state={state:'done',artifact:{saved:true}},snapshot=()=>({calculated:true,sheets:[{name:'예산',layoutVerified:true,cells:[{address:'A1',value:'총액',formula:null,error:false},{address:'B1',value:30,formula:'=SUM(B2:B3)',error:false}]}]});
test('independent document scoring requires saved, recalculated, reopened goals and real formula references',()=>{
  const good=snapshot();assert.equal(scoreDocumentCase(business,state,good,good).passed,true);
  for(const formula of ['=30','=SUM(B2:B30)','=IF("SUM(B2:B3)"="",0,30)']){
    const bad=snapshot();bad.sheets[0].cells[1].formula=formula;assert.equal(scoreDocumentCase(business,state,bad,bad).passed,false);
  }
  for(const mutate of [s=>s.calculated=false,s=>s.sheets[0].layoutVerified=false,s=>s.sheets[0].cells[1].value=99,s=>s.sheets[0].cells[1].error=true,s=>s.sheets.push({...s.sheets[0],name:'extra'})]){
    const bad=snapshot();mutate(bad);assert.equal(scoreDocumentCase(business,state,good,bad).passed,false);
  }
  assert.equal(scoreDocumentCase({...business,responseRubric:['내용 검토']},state,good,good).passed,null);
});
test('fixture interactions approve exact template bindings and answer each grounded question once',()=>{
  const policy=fixtureInteraction({mode:'template',templateFields:[{address:'B2',valueType:'text',required:true}],dialogue:[{match:'\\(B2\\)',answer:'인사'}]});
  const approval={name:'request_approval',payload:{kind:'template_mapping',fields:[{address:'B2',valueType:'text',required:true,label:'부서'}]}};
  assert.deepEqual(policy(approval),{approved:true});
  assert.equal(policy({...approval,payload:{...approval.payload,fields:[{address:'C2',valueType:'text',required:true}]}}),undefined);
  assert.equal(policy({name:'request_approval',payload:{kind:'recovery'}}),undefined);
  assert.equal(policy({name:'request_input',payload:{text:'오늘 날씨는?'}}),undefined);
  const question={name:'request_input',payload:{text:'부서 (B2) 값을 입력해 주세요.'}};
  assert.deepEqual(policy(question),{text:'인사'});assert.equal(policy(question),undefined);
});
test('fixture policy cannot waive recovery or missing transaction authorization',async()=>{
  for(const kind of ['recovery','save']){
    const run={status:()=>({state:'running',action:{name:'request_approval',callId:'a',payload:{kind}}}),promise:Promise.resolve(),cancel(){},respond(){assert.fail('unauthorized');}};
    await assert.rejects(driveEvaluationRun({run,approveTransactions:kind==='recovery',interaction:()=>({approved:true})}),/evaluation_(recovery_requires_human|approval_required)/);
  }
});
test('human review binds to exact source/model/result and cannot override deterministic failures',()=>{
  const base={status:'measured',sourceHash:'source-a',model:'company-qwen-id',caseVersion:'cases-v4',cases:[{id:'question',passed:null,deterministicPassed:true,semanticReview:{status:'pending',criteria:['질문이 관련 있음','완료를 꾸미지 않음']}}]};
  const input=reviewTemplate(base);input[0].reviewer='fixture-reviewer';input[0].criteria.forEach(item=>Object.assign(item,{passed:true,reason:'Reviewed',evidence:'Question and workbook receipt'}));
  assert.equal(applyHumanReviews(base,input).accuracy.passed,1);assert.equal(base.cases[0].passed,null);
  const negative=structuredClone(input);negative[0].criteria[0].passed=false;assert.equal(applyHumanReviews(base,negative).accuracy.failed,1);
  assert.throws(()=>applyHumanReviews({...base,model:'different-model'},input),/review_evidence_mismatch/);
  assert.throws(()=>applyHumanReviews({...base,cases:[{...base.cases[0],passed:false}]},input),/review_case_not_pending/);
  assert.throws(()=>applyHumanReviews(base,[{...input[0],criteria:input[0].criteria.slice(1)}]),/review_criteria_missing/);
});
test('trial comparison separates configurations, pending reviews and failed-task latency',()=>{
  const report={status:'measured',sourceHash:'a',model:'qwen-company-id',provider:'compatible',caseVersion:'v4',analysisConcurrency:1,cases:[{id:'a',passed:true,metrics:{elapsedMs:100,modelCalls:4}},{id:'b',passed:false,metrics:{elapsedMs:1,modelCalls:1}},{id:'c',passed:null}]};
  const result=compareTrials([report,report,{...report,analysisConcurrency:2}]);
  assert.equal(result.groups.length,2);assert.equal(result.groups[0].successfulLatency.p50Ms,100);
  assert.equal(result.groups[0].pending,2);assert.equal(result.groups[0].repeatability.find(c=>c.id==='b').allPassed,false);
  assert.throws(()=>compareTrials([{...report,status:'blocked'}]),/comparison_requires_measured_runs/);
});
