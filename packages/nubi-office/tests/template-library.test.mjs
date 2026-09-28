import test from 'node:test';
import assert from 'node:assert/strict';
import {createTemplateRecord,validateTemplateRecord} from '../worker/template-library.mjs';
import {createTemplateSession} from '../worker/template.mjs';
import {templatePreservation} from '../worker/template-preservation.mjs';
import {startAgent} from '../worker/agent.mjs';
import {workbook,scriptedProvider,contract,call,text,drive} from './harness-fixtures.mjs';

const fields=[{address:'A1',label:'담당 부서',valueType:'text',required:true}];
function fixture(){const b=workbook();Object.assign(b.state,{readOnly:false,protected:false});b.state.values=[['예시 부서','부서명']];b.state.properties.borders=[[{},{}]];return b;}
function record(book){const session=createTemplateSession(book.snapshot());session.confirm(session.propose(fields,book.snapshot()),book.snapshot());return createTemplateRecord({name:'부서 보고서',purpose:'담당 부서 입력',profile:session.profile(),model:{model:'catalog-model',provider:'aipro'}});}
const receipt=(action,book)=>({saved:true,id:action.payload.record.id,path:'C:\\Templates\\Department.xlsx',metadataVerified:true,comparison:{before:book.snapshot(),after:book.snapshot()}});
function registerRun(book){return startAgent({request:'이 양식의 입력 항목을 분석해서 등록해줘',scope:book.snapshot(),mode:'template-register',providers:scriptedProvider({task:contract([],{intent:'analyze'}),actor:[call('define_template_fields',{fields}),call('register_template',{name:'부서 보고서',purpose:'담당 부서 입력'}),text('양식 사본을 등록했습니다.')]}),resilienceOptions:{wait:async()=>{}}});}
async function driveApprovals(run,action){for(let i=0;i<1000;i++){const s=run.status();if(s.state!=='running'){await run.promise;return run.status();}if(s.action)run.respond(s.action.callId,await action(s.action));await new Promise(resolve=>setImmediate(resolve));}run.cancel();await run.promise;throw new Error('test timed out');}

test('saved field profile binds a new copy but rejects changed fixed labels and formulas',()=>{
  const book=fixture(),saved=record(book);book.state.documentId='copy-book';book.state.workbook='Copy.xlsx';book.state.values[0][0]='작성자 값';
  const copy=createTemplateSession(book.snapshot());copy.loadProfile(saved.profile,book.snapshot());assert.equal(copy.summary().fields[0].address,'A1');assert.deepEqual(copy.missing(),[{id:'field_A1',address:'A1',label:'담당 부서',answered:false}]);
  book.state.values[0][1]='계좌번호';assert.throws(()=>createTemplateSession(book.snapshot()).loadProfile(saved.profile,book.snapshot()),/template_changed/);
});
test('saved schema never serializes instance answers, sample values or executable metadata',()=>{
  const book=fixture(),session=createTemplateSession(book.snapshot());session.confirm(session.propose(fields,book.snapshot()),book.snapshot());session.answer('field_A1','민감한 작성 값',book.snapshot());
  const r=createTemplateRecord({name:'양식',purpose:'등록',profile:session.profile()});const json=JSON.stringify(r);assert.ok(!json.includes('민감한 작성 값'));assert.ok(!json.includes('예시 부서'));
  for(const mutate of [r=>r.answers={A1:'value'},r=>r.profile.fields[0].formula='=1',r=>r.profile.fields[0].address='C1',r=>r.profile.fields.push({...r.profile.fields[0]}),r=>r.profile.structureId='not-a-hash']){const invalid=structuredClone(r);mutate(invalid);assert.throws(()=>validateTemplateRecord(invalid));}
});
test('readback comparison distinguishes observed equality, missing evidence and expected input values',()=>{
  const book=fixture(),before=book.snapshot();book.state.values[0][0]='인사';const after=book.snapshot();delete after.properties.borders;
  const report=templatePreservation(before,after,{inputAddresses:['A1']});assert.equal(report.status,'partial');assert.equal(report.expectedValueChanges,1);assert.equal(report.differenceCount,0);
  assert.equal(report.checks.find(c=>c.id==='formulas').status,'preserved');assert.equal(report.checks.find(c=>c.id==='borders').status,'unverified');assert.equal(report.checks.find(c=>c.id==='objects').status,'unverified');assert.equal(report.checks.find(c=>c.id==='nasca').status,'unverified');
  const unreadable=book.snapshot();unreadable.properties.borders=[[null,null]];unreadable.properties.validation=[[{status:'unreadable',type:3},null]];
  const missing=templatePreservation(unreadable,unreadable);assert.equal(missing.checks.find(c=>c.id==='borders').status,'unverified');assert.equal(missing.checks.find(c=>c.id==='validation').status,'unverified');
});
test('changes are reported even when another property cannot be read; formula drift is not an input value',()=>{
  const book=fixture(),before=book.snapshot();book.state.formats.bold[0][0]=true;delete book.state.formats.fontName;book.state.formulas[0][1]='=1';book.state.values[0][1]=1;
  const report=templatePreservation(before,book.snapshot(),{inputAddresses:['A1']});assert.equal(report.status,'differences');assert.equal(report.differenceCount,3);assert.equal(report.checks.find(c=>c.id==='formats').status,'changed');assert.equal(report.differences.find(c=>c.field==='수식').address,'B1');
  assert.throws(()=>templatePreservation(before,{...book.snapshot(),worksheet:'Sheet2'}),/template_comparison_invalid/);
});
test('registration completes only after save and metadata readback, retaining partial preservation evidence',async()=>{
  const book=fixture(),run=registerRun(book);let saved=0;
  const status=await drive(run,a=>{if(a.name==='template_catalog_index')return{catalogued:true,id:a.payload.templateId};if(a.name==='template_register'){saved++;return receipt(a,book);}return book.action(a);});
  assert.equal(status.state,'done',status.error);assert.equal(saved,1);assert.equal(status.registeredTemplate.catalogued,true);assert.equal(book.writes,0);assert.equal(status.registeredTemplate.metadataVerified,true);assert.equal(status.preservation.status,'partial');assert.equal(status.registeredTemplate.nascaEncryptionVerified,false);assert.equal(status.registeredTemplate.comparison,undefined);
});
test('missing save evidence never becomes success and never repeats an uncertain save',async()=>{
  for(const change of [r=>r.saved=false,r=>r.metadataVerified=false,r=>delete r.comparison]){
    const book=fixture(),run=registerRun(book);let calls=0;
    const s=await drive(run,a=>{if(a.name==='template_register'){calls++;const r=receipt(a,book);change(r);return r;}return book.action(a);});assert.equal(s.state,'failed');assert.equal(s.error,'template_save_uncertain');assert.equal(calls,1);
  }
});
test('a detected copy difference prompts a concrete review; rejecting it retains saved receipt without success',async()=>{
  const book=fixture(),run=registerRun(book);let reviews=0;
  const s=await driveApprovals(run,a=>{
    if(a.name==='request_approval'){if(a.payload.kind==='template_preservation'){reviews++;assert.equal(a.payload.preservation.differences[0].address,'A1');return{approved:false};}return{approved:true};}
    if(a.name==='template_register'){const r=receipt(a,book);r.comparison.after.formats.fontSize[0][0]=12;return r;}return book.action(a);
  });assert.equal(s.state,'cancelled');assert.equal(reviews,1);assert.equal(s.registeredTemplate.saved,true);assert.equal(s.preservation.status,'differences');assert.equal(book.writes,0);
});
test('cancel before registration never calls Excel save',async()=>{
  const book=fixture(),run=registerRun(book);let saves=0;
  const s=await driveApprovals(run,a=>{if(a.name==='request_approval')return{approved:a.payload.kind!=='template_register'};if(a.name==='template_register'){saves++;return receipt(a,book);}return book.action(a);});assert.equal(s.state,'cancelled');assert.equal(saves,0);
});
test('a saved Excel copy is not catalog registration when protected indexing fails',async()=>{
  const book=fixture(),run=registerRun(book);let saves=0,indexes=0;
  const status=await drive(run,a=>{if(a.name==='template_register'){saves++;return receipt(a,book);}if(a.name==='template_catalog_index'){indexes++;return{error:'template_catalog_unavailable'};}return book.action(a);});
  assert.equal(status.state,'failed');assert.equal(status.error,'template_catalog_unavailable');assert.equal(saves,1);assert.equal(indexes,1);assert.equal(status.registeredTemplate.saved,true);assert.notEqual(status.registeredTemplate.catalogued,true);
});
test('changed saved profile offers reanalysis and cancellation cannot reuse old mappings',async()=>{
  const book=fixture(),saved=record(book);book.state.values[0][1]='다른 양식';
  const run=startAgent({request:'저장된 양식 채워줘',scope:book.snapshot(),mode:'template',templateRecord:saved,providers:scriptedProvider()});let prompts=0;
  const s=await driveApprovals(run,a=>{if(a.name==='request_approval'){prompts++;assert.equal(a.payload.kind,'template_reanalyze');return{approved:false};}return book.action(a);});assert.equal(s.state,'cancelled');assert.equal(prompts,1);assert.equal(book.writes,0);assert.equal(s.template.fields.length,0);
});

test('an uncertain write with observed layout damage remains failed and exposes the actual difference',async()=>{
  const book=fixture(),run=startAgent({request:'담당 부서를 인사로 채워줘',scope:book.snapshot(),mode:'template',providers:scriptedProvider({task:contract([{address:'A1',field:'value',operator:'equals',expected:'인사'}]),actor:[call('define_template_fields',{fields}),call('fill_template_fields',{values:[{fieldId:'field_A1',value:'인사'}]}),text('완료')]}),resilienceOptions:{wait:async()=>{}}});
  const s=await drive(run,a=>{if(a.name==='apply_changes'){book.action(a);book.state.formats.bold[0][0]=true;return{error:'partial_change',snapshot:book.snapshot(),recoverable:false};}if(a.name==='reconcile_changes')return{outcome:'unknown'};return book.action(a);});
  assert.equal(s.state,'failed');assert.equal(s.error,'partial_change');assert.equal(book.writes,1);assert.equal(s.preservation.status,'differences');assert.equal(s.preservation.differences[0].field,'굵게');
});
