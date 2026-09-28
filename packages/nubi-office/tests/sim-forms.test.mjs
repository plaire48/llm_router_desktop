import test from 'node:test';
import assert from 'node:assert/strict';
import {forms,formById} from '../eval/sim/forms.mjs';
import {scoreMapping} from '../eval/sim/form-scoring.mjs';
import {createSimHost} from '../eval/sim/host.mjs';
import {analyzeTemplate,createTemplateSession} from '../worker/template.mjs';
import {createTemplateRecord} from '../worker/template-library.mjs';
import {inspectChecks} from '../worker/office-harness.mjs';
import {auditChanges} from '../eval/scoring.mjs';

const open=async form=>{const host=createSimHost();return{host,initial:await host.call('init',form)};};
const goldRecord=(form,scope)=>{const session=createTemplateSession(scope);session.confirm(session.propose(form.fields,scope),scope);return createTemplateRecord({name:form.title,purpose:form.title+' 작성',notes:'',profile:session.profile(),model:{model:'answer-key',provider:'fixture'}});};

test('the form set covers the four planned layouts',()=>{
  assert.deepEqual(forms.map(form=>form.id),['expense-report','trip-request','training-request','quotation']);
  assert.equal(formById('quotation').fields.length,21);assert.equal(formById('missing'),undefined);
});
for(const form of forms){
  test(`${form.id}: the form fits the selection limits of the Excel agent`,async()=>{
    const {initial}=await open(form);
    assert.ok(initial.scope.values.length*initial.scope.values[0].length<=1000);
    assert.ok(JSON.stringify(initial.scope).length<=120000,'scope JSON '+JSON.stringify(initial.scope).length);
    assert.equal(initial.scope.address,form.range);assert.equal(initial.scope.worksheet,form.sheetName);
  });
  test(`${form.id}: every answer-key field is a writable candidate and no formula is`,async()=>{
    const {initial}=await open(form),cells=new Map(analyzeTemplate(initial.scope).cells.map(cell=>[cell.address,cell]));
    for(const field of form.fields)assert.deepEqual([field.address,cells.get(field.address).role],[field.address,'candidate']);
    const formulas=[...cells.values()].filter(cell=>cell.formula);
    assert.ok(formulas.length>0);for(const cell of formulas)assert.equal(cell.reason,'formula');
    assert.equal(form.fields.some(field=>cells.get(field.address).formula),false);
  });
  test(`${form.id}: the answer key registers and the registered copy keeps the form`,async()=>{
    const {host,initial}=await open(form),record=goldRecord(form,initial.scope);
    const saved=await host.call('template_register',{scopeId:initial.scope.scopeId,record,expectedFingerprint:initial.scope.fingerprint});
    assert.equal(saved.saved,true);assert.deepEqual(saved.comparison.after.formulas,initial.scope.formulas);assert.deepEqual(saved.comparison.after.formats,initial.scope.formats);
    assert.equal((await host.call('template_catalog_index',{templateId:record.id})).entry.inputCount,form.fields.length);
  });
  test(`${form.id}: filling the answer key satisfies the checks without other changes`,async()=>{
    const {host,initial}=await open(form),record=goldRecord(form,initial.scope);
    await host.call('template_register',{scopeId:initial.scope.scopeId,record,expectedFingerprint:initial.scope.fingerprint});
    await host.call('template_catalog_index',{templateId:record.id});
    const opened=await host.call('template_catalog_use',{templateId:record.id,auditRange:form.auditRange}),before=await host.call('audit');
    const session=createTemplateSession(opened.scope);session.loadProfile(record.profile,opened.scope);
    const plan=session.plan(Object.entries(form.reuse.values).map(([address,value])=>({fieldId:'field_'+address,value})),opened.scope);
    const written=await host.call('apply',{scopeId:opened.scope.scopeId,operationId:'answer-key',plan});
    assert.equal(written.applied,true,written.error+' '+written.cause);
    const after=await host.call('audit'),checked=inspectChecks(form.reuse.checks,after);
    assert.deepEqual(checked.checks.filter(check=>check.status!=='met').map(check=>[check.address,check.expected,check.actual]),[]);
    assert.deepEqual(auditChanges(before,after,form.reuse.allowedChanges),[]);
    assert.ok(form.fields.filter(field=>field.required).every(field=>Object.hasOwn(form.reuse.values,field.address)),'every required field has an answer');
  });
  test(`${form.id}: the fixture answers cover the questions the requests leave open`,()=>{
    for(const item of [...form.register.dialogue,...form.reuse.dialogue]){assert.doesNotThrow(()=>new RegExp(item.match,'iu'));assert.ok(item.answer.trim());}
    assert.ok(form.register.request.length<=8000&&form.reuse.request.length<=8000);
  });
}
test('labels merged across cells reach the inputs beside them',async()=>{
  const {initial}=await open(formById('trip-request')),cells=new Map(analyzeTemplate(initial.scope).cells.map(cell=>[cell.address,cell]));
  assert.deepEqual(cells.get('C3').hints,[{address:'A3',text:'소속 부서'}]);
  assert.deepEqual(cells.get('E5').hints.map(hint=>hint.text),['출장지']);
  assert.deepEqual(cells.get('C8').hints[0],{address:'A8',text:'출장 목적'});
});
test('a mapping equal to the answer key is exact and strict',()=>{
  const gold=formById('expense-report').fields,score=scoreMapping(gold.map(item=>({...item,label:'다른 표현'})),gold);
  assert.deepEqual([score.exact,score.strict,score.precision,score.recall,score.f1,score.matched],[true,true,1,1,1,8]);
});
test('proposing a formula or label cell lowers precision and is listed as unexpected',()=>{
  const gold=formById('expense-report').fields,score=scoreMapping([...gold,{address:'B8',label:'부가세',valueType:'number',required:true},{address:'$a$3',label:'결의 번호',valueType:'text',required:true}],gold);
  assert.deepEqual([score.exact,score.unexpected,score.recall],[false,['B8','A3'],1]);assert.equal(score.precision,8/10);
});
test('a missing field lowers recall and a duplicate is not counted twice',()=>{
  const gold=formById('expense-report').fields,score=scoreMapping([...gold.slice(0,6),gold[0]],gold);
  assert.deepEqual([score.missing,score.unexpected,score.matched,score.exact],[['B7','B11'],['B3'],6,false]);assert.equal(score.recall,6/8);
});
test('a wrong value type breaks exactness and a wrong required flag only breaks strictness',()=>{
  const gold=formById('expense-report').fields;
  const typed=scoreMapping(gold.map(item=>item.address==='B3'?{...item,valueType:'number'}:item),gold);
  assert.deepEqual([typed.exact,typed.wrongType],[false,[{address:'B3',expected:'text',actual:'number'}]]);
  const flagged=scoreMapping(gold.map(item=>item.address==='B11'?{...item,required:true}:item),gold);
  assert.deepEqual([flagged.exact,flagged.strict,flagged.wrongRequired],[true,false,[{address:'B11',expected:false,actual:true}]]);
});
test('an empty or malformed proposal scores zero without throwing',()=>{
  const gold=formById('expense-report').fields;
  for(const proposal of [[],null,undefined,[null,{}]]){const score=scoreMapping(proposal,gold);assert.deepEqual([score.recall,score.exact,score.matched],[0,false,0]);}
});
