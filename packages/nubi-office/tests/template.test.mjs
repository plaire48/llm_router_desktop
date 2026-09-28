import test from 'node:test';
import assert from 'node:assert/strict';
import {createTemplateSession,analyzeTemplate} from '../worker/template.mjs';
import {startAgent} from '../worker/agent.mjs';
import {workbook,scriptedProvider,contract,call,text,drive} from './harness-fixtures.mjs';

function fixture(){const book=workbook();Object.assign(book.state,{readOnly:false,protected:false});book.state.values=[[null,null]];return book;}
const field=(address='A1',overrides={})=>({address,label:'담당 부서',valueType:'text',required:true,...overrides});
function mapped(book,definitions=[field()]){const session=createTemplateSession(book.snapshot());session.confirm(session.propose(definitions,book.snapshot()),book.snapshot());return session;}
// Native reads keep a merged label's text only at its top-left anchor; followers are null.
function form(address,values,merges){
  const fill=value=>values.map(row=>row.map(()=>value));
  return{worksheet:'양식',address,readOnly:false,protected:false,values,formulas:fill(null),formats:{numberFormat:fill('General')},
    properties:{mergedAddress:merges,arrayFormula:fill(false),hiddenRow:fill(false),hiddenColumn:fill(false),locked:fill(true),validation:fill(null)}};
}
const hintsAt=(snapshot,address)=>analyzeTemplate(snapshot).cells.find(cell=>cell.address===address).hints;

test('template analysis separates computed cells and merged followers without authorizing candidates',()=>{
  const book=fixture();book.state.properties.mergedAddress=[['A1:B1','A1:B1']];
  const schema=analyzeTemplate(book.snapshot());assert.equal(schema.cells[0].role,'candidate');assert.equal(schema.cells[1].reason,'merged_follower');
  book.state.formulas[0][0]='=1+1';assert.equal(analyzeTemplate(book.snapshot()).cells[0].reason,'formula');
  book.state.formulas[0][0]=null;book.state.properties.mergedAddress=[['A1:C1','A1:C1']];assert.equal(analyzeTemplate(book.snapshot()).cells[0].reason,'partial_merge');
});
test('an input beside a label merged across columns receives the label from the merge anchor',()=>{
  const snapshot=form('B5:D5',[['담당 부서',null,null]],[['B5:C5','B5:C5',null]]);
  assert.deepEqual(hintsAt(snapshot,'D5'),[{address:'B5',text:'담당 부서'}]);
});
test('an input below a label merged across rows receives the label from the merge anchor',()=>{
  const snapshot=form('A1:A3',[['수량'],[null],[null]],[['A1:A2'],['A1:A2'],[null]]);
  assert.deepEqual(hintsAt(snapshot,'A3'),[{address:'A1',text:'수량'}]);
});
test('a merged label whose anchor lies outside the observed range gives no hint',()=>{
  const snapshot=form('B5:D5',[[null,null,null]],[['A5:C5','A5:C5',null]]);
  assert.deepEqual(hintsAt(snapshot,'D5'),[]);
});
test('a neighbor merge too large to resolve gives no hint and does not stop the analysis',()=>{
  const snapshot=form('A1:B1',[[2,null]],[['A1:ZZ100',null]]);snapshot.formulas=[['=1+1',null]];
  assert.deepEqual(hintsAt(snapshot,'B1'),[]);
});
test('a cell inside a merged label lists its own anchor once',()=>{
  const snapshot=form('A1:B2',[['결재',null],[null,null]],[['A1:B2','A1:B2'],['A1:B2','A1:B2']]);
  assert.deepEqual(hintsAt(snapshot,'B2'),[{address:'A1',text:'결재'}]);
});
test('locked cells in an unprotected sheet are not automatically treated as protected',()=>{
  const book=fixture();assert.equal(analyzeTemplate(book.snapshot()).cells[0].role,'candidate');
  book.state.protected=true;assert.equal(analyzeTemplate(book.snapshot()).cells[0].reason,'workbook_not_writable');
  assert.throws(()=>mapped(book),/template_mapping_invalid/);
  delete book.state.protected;assert.throws(()=>analyzeTemplate(book.snapshot()),/template_metadata_missing/);
});
test('formula cells, followers, duplicate fields and out-of-scope bindings cannot be confirmed',()=>{
  const book=fixture();book.state.formulas[0][1]='=SUM(A1)';const session=createTemplateSession(book.snapshot());
  for(const definitions of [[field('B1')],[field('C1')],[field(),field()],[field('A1:B1')]])assert.throws(()=>session.propose(definitions,book.snapshot()),/template_mapping_invalid/);
  assert.throws(()=>session.plan([{fieldId:'field_A1',value:'인사'}],book.snapshot()),/template_mapping_required/);
});
test('literal validation choices use the observed locale separator; referenced lists are not guessed',()=>{
  const book=fixture();book.state.properties.validation[0][0]={type:3,formula1:'영업;인사;기획',listSeparator:';',ignoreBlank:false};
  const session=mapped(book);assert.deepEqual(session.question('field_A1').options.map(o=>o.label),['영업','인사','기획']);
  assert.throws(()=>session.answer('field_A1','연구',book.snapshot()),/template_choice_invalid/);
  session.answer('field_A1','인사',book.snapshot());assert.equal(session.plan([],book.snapshot()).operations[0].values[0][0],'인사');
  book.state.properties.validation[0][0]={type:3,formula1:'=DepartmentList'};assert.deepEqual(mapped(book).question('field_A1').options,[]);
});
test('typed input preserves original formats, dates and leading zeros without adding formatting writes',()=>{
  const book=fixture();book.state.formats.numberFormat[0][0]='yyyy"년" m"월" d"일"';book.state.date1904=true;
  const session=mapped(book,[field('A1',{valueType:'date'})]);session.answer('field_A1','1904-01-02',book.snapshot());
  assert.deepEqual(session.plan([],book.snapshot()),{operations:[{type:'set_values',address:'A1',values:[[1]]}]});
  assert.equal(mapped(book).plan([{fieldId:'field_A1',value:'00123'}],book.snapshot()).operations[0].values[0][0],'00123');
});
test('human answers cannot be overwritten, repeated completed fields are skipped, and zero/false are present',()=>{
  const book=fixture(),session=mapped(book,[field('A1',{valueType:'number'}),field('B1',{valueType:'boolean'})]);
  session.answer('field_A1','0',book.snapshot());session.answer('field_B1','아니오',book.snapshot());
  assert.throws(()=>session.plan([{fieldId:'field_A1',value:9}],book.snapshot()),/template_answer_conflict/);
  const plan=session.plan([],book.snapshot(),['A1']);assert.equal(plan.operations.length,1);assert.equal(plan.operations[0].values[0][0],0);
  const after=book.action({name:'apply_changes',plan}).snapshot;session.accept(after,plan);
  assert.deepEqual(session.missing(),[{id:'field_B1',label:'담당 부서',address:'B1',answered:true}]);
  assert.equal(session.plan([],book.snapshot(),['B1']).operations[0].values[0][0],false);
  assert.throws(()=>session.propose([field()],book.snapshot()),/template_mapping_locked/);
});
test('manual values, formulas, styles and protection changes invalidate the field session',()=>{
  for(const change of [b=>b.state.values[0][1]='변경',b=>b.state.formulas[0][1]='=2',b=>b.state.formats.bold[0][1]=true,b=>b.state.protected=true]){
    const book=fixture(),session=mapped(book);change(book);assert.throws(()=>session.plan([{fieldId:'field_A1',value:'인사'}],book.snapshot()),/template_changed/);
  }
});
test('template agent keeps mapping and free-text answers within one run and writes only after answers',async()=>{
  const book=fixture();book.state.properties.mergedAddress=[['A1:B1','A1:B1']];
  const task=contract([{address:'A1',field:'value',operator:'not_empty'}]);
  const providers=scriptedProvider({task,actor:[call('inspect_template'),call('define_template_fields',{fields:[field()]}),call('ask_template_field',{fieldId:'field_A1'}),call('fill_template_fields',{values:[]}),text('담당 부서를 입력했습니다.')]});
  const run=startAgent({request:'이 양식의 담당 부서를 채워줘. 부서는 나에게 물어봐.',scope:book.snapshot(),mode:'template',providers,resilienceOptions:{wait:async()=>{}}});
  let questions=0;const status=await drive(run,action=>{if(action.name==='request_input'){assert.equal(action.payload.inputLimit,10000);assert.throws(()=>run.respond(action.callId,{text:'x'.repeat(10001)}),/invalid_question/);assert.equal(run.status().action.callId,action.callId);questions++;assert.equal(book.writes,0);assert.equal(run.status().state,'running');assert.equal(run.status().template.fields[0].id,'field_A1');return{text:'인사'};}return book.action(action);});
  assert.equal(status.state,'done',status.error);assert.equal(questions,1);assert.equal(book.writes,1);assert.equal(book.state.values[0][0],'인사');assert.equal(book.state.properties.mergedAddress[0][1],'A1:B1');assert.equal(status.template.fields[0].applied,true);
});
test('cancel during a template question never resumes or writes',async()=>{
  const book=fixture(),providers=scriptedProvider({actor:[call('define_template_fields',{fields:[field()]}),call('ask_template_field',{fieldId:'field_A1'})]});
  const run=startAgent({request:'양식 작성',scope:book.snapshot(),mode:'template',providers});
  const status=await drive(run,action=>action.name==='request_input'?{cancelled:true}:book.action(action));assert.equal(status.state,'cancelled');assert.equal(book.writes,0);
});
test('manual Excel changes while answering stop before writing',async()=>{
  const book=fixture(),providers=scriptedProvider({actor:[call('define_template_fields',{fields:[field()]}),call('ask_template_field',{fieldId:'field_A1'})]});
  const run=startAgent({request:'양식 작성',scope:book.snapshot(),mode:'template',providers});
  const status=await drive(run,action=>{if(action.name==='request_input'){book.state.values[0][1]='직접 수정';return{text:'인사'};}return book.action(action);});assert.equal(status.state,'failed');assert.equal(status.error,'template_changed');assert.equal(book.writes,0);
});
test('template mode never advertises raw apply_changes',async()=>{
  const book=fixture(),providers=scriptedProvider({task:contract([],{intent:'analyze'}),actor:(_messages,tools)=>{assert.equal(tools.some(t=>t.function.name==='apply_changes'),false);assert.equal(tools.some(t=>t.function.name==='fill_template_fields'),false);return text('양식을 분석했습니다.');}});
  const run=startAgent({request:'양식 분석만 해줘',scope:book.snapshot(),mode:'template',providers});assert.equal((await drive(run,a=>book.action(a))).state,'done');assert.equal(book.writes,0);
});

test('existing sample text does not skip input collection or count as the completed template task',async()=>{
  const book=fixture();book.state.values[0][0]='예시 부서';
  const providers=scriptedProvider({task:contract([{address:'A1',field:'value',operator:'not_empty'}]),actor:[call('define_template_fields',{fields:[field()]}),call('ask_template_field',{fieldId:'field_A1'}),call('fill_template_fields',{values:[]}),text('인사 부서로 작성했습니다.')]});
  const run=startAgent({request:'내 부서를 물어서 양식을 채워줘',scope:book.snapshot(),mode:'template',providers,resilienceOptions:{wait:async()=>{}}});
  const status=await drive(run,a=>a.name==='request_input'?{text:'인사'}:book.action(a));assert.equal(status.state,'done',status.error);assert.equal(book.writes,1);assert.equal(book.state.values[0][0],'인사');
});
