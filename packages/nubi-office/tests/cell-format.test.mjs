import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTypedValue,normalizePlan,FORMAT_FIELDS} from '../worker/cell-format.mjs';
import {parseTask,editChecks,inspectChecks,taskMessages} from '../worker/office-harness.mjs';
import {startAgent} from '../worker/agent.mjs';
import {workbook,contract,scriptedProvider,planCall,drive,text} from './harness-fixtures.mjs';

test('dates use the actual workbook date system and reject ambiguous or impossible dates',()=>{
  assert.equal(normalizeTypedValue('1900-01-01','date'),1);
  assert.equal(normalizeTypedValue('2026-09-23','date'),46288);
  assert.equal(normalizeTypedValue('1900-02-28','date'),59);
  assert.equal(normalizeTypedValue('1900-03-01','date'),61);
  assert.equal(normalizeTypedValue('1904-01-01','date',true),0);
  assert.equal(normalizeTypedValue('2026-09-23','date')-normalizeTypedValue('2026-09-23','date',true),1462);
  for(const value of ['1900-02-29','2026-02-30','09/10/26','2026-13-01','1899-12-31'])assert.throws(()=>normalizeTypedValue(value,'date'));
});
test('typed inputs keep codes and boolean/zero values, and require explicit percent units',()=>{
  assert.equal(normalizeTypedValue('00123','text'),'00123');assert.equal(normalizeTypedValue(0,'number'),0);
  assert.equal(normalizeTypedValue(false,'boolean'),false);assert.equal(normalizeTypedValue('12.5%','percent'),.125);
  assert.equal(normalizeTypedValue(.1,'percent'),.1);assert.equal(normalizeTypedValue('30,000','number'),30000);
  for(const value of ['10','1,2','three'])assert.throws(()=>normalizeTypedValue(value,'percent'));
  for(const value of ['3만원','1,23',Infinity,NaN,9007199254740992])assert.throws(()=>normalizeTypedValue(value,'number'));
  assert.throws(()=>normalizeTypedValue(123,'text'));
});
test('typed writes explicitly pair storage values with compatible formats, retaining a supplied template format',()=>{
  const before=workbook().snapshot();
  const plan=normalizePlan({operations:[{type:'set_typed_values',address:'A1',values:[['00123']],valueType:'text'},{type:'set_typed_values',address:'B1',values:[['10%']],valueType:'percent',numberFormat:'0.0%'}]},before);
  assert.deepEqual(plan.operations.map(op=>op.values??op.numberFormat),[[['00123']],'@',[[.1]],'0.0%']);
  const checks=editChecks(plan,before,true);assert.equal(checks.length,4);
});
test('reference formatting is copied from fresh evidence without copying values or formulas',()=>{
  const before=workbook().snapshot();before.formats.fontName=[['Arial','맑은 고딕']];before.formats.fontSize=[[14,11]];
  const plan=normalizePlan({operations:[{type:'copy_format',address:'B1',sourceAddress:'A1',fields:['fontName','fontSize','fillColor']}]},before);
  assert.deepEqual(plan.operations,[{type:'format_range',address:'B1',fontName:'Arial',fontSize:14,fillColor:null}]);
  assert.throws(()=>normalizePlan({operations:[{type:'copy_format',address:'B1',sourceAddress:'C1'}]},before),/out_of_scope/);
  assert.throws(()=>normalizePlan({operations:[{type:'copy_format',address:'B1',sourceAddress:'A1',fields:['rowHeight']}]},before),/invalid_format/);
  delete before.formats.italic;
  assert.throws(()=>normalizePlan({operations:[{type:'copy_format',address:'B1',sourceAddress:'A1'}]},before),/format_unavailable/);
});
test('typed expectations normalize with the workbook date system and validate formats separately',()=>{
  const scope=workbook().snapshot();scope.date1904=true;
  const task=contract([{address:'A1',field:'value',operator:'equals',expected:'2026-09-23',valueType:'date'},{address:'A1',field:'numberFormat',operator:'equals',expected:'yyyy-mm-dd'}]);
  const result=parseTask(text(JSON.stringify(task)),scope,'edit');assert.equal(result.checks[0].expected,normalizeTypedValue('2026-09-23','date',true));
  assert.match(taskMessages('양식에 맞춰 입력',[],scope,'edit')[0].content,/leading zeros/);
});
test('correct values with wrong formatting or invalid validation are not complete',()=>{
  const scope=workbook().snapshot();scope.values[0][0]=.1;
  const checks=[{address:'A1',field:'value',operator:'equals',expected:.1},{address:'A1',field:'numberFormat',operator:'equals',expected:'0.00%'}];
  assert.equal(inspectChecks(checks,scope).verified,false);scope.formats.numberFormat[0][0]='0.00%';assert.equal(inspectChecks(checks,scope).verified,true);
  scope.properties={validation:[[{type:1},null]],validationValid:[[false,null]]};assert.equal(inspectChecks(checks,scope).verified,false);
  scope.properties.validationValid[0][0]=null;assert.equal(inspectChecks(checks,scope).checks[0].status,'unknown');
});
test('real Pi harness applies typed values and reference font together and preserves reference cells',async()=>{
  const book=workbook();book.state.formats.fontName=[['맑은 고딕','Arial']];book.state.formats.fontSize=[[11,14]];
  const checks=[{address:'A1',field:'value',operator:'equals',expected:'00123'},{address:'A1',field:'numberFormat',operator:'equals',expected:'@'},{address:'A1',field:'fontName',operator:'equals',expected:'Arial'},{address:'A1',field:'fontSize',operator:'equals',expected:14}];
  const providers=scriptedProvider({task:contract(checks),actor:[planCall([{type:'set_typed_values',address:'A1',valueType:'text',values:[['00123']]},{type:'copy_format',address:'A1',sourceAddress:'B1',fields:['fontName','fontSize']}]),text('코드와 기준 글꼴을 반영했습니다.')]});
  const run=startAgent({request:'A1에 코드 00123을 넣고 글꼴은 B1과 맞춰줘',scope:book.snapshot(),mode:'edit',providers});
  const result=await drive(run,action=>book.action(action));assert.equal(result.state,'done');assert.equal(book.state.values[0][0],'00123');assert.equal(book.state.values[0][1],2);assert.equal(book.state.formats.fontName[0][0],'Arial');assert.equal(book.state.formats.fontSize[0][0],14);assert.equal(book.state.formats.numberFormat[0][0],'@');
});
