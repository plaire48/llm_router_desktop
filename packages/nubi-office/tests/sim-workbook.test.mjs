import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkbook} from '../eval/sim/workbook.mjs';

// Field order mirrors native ExcelPort.Read so fingerprints cover the same data.
const FIELDS=['value','formula','error','bold','italic','fontName','fontSize','fontColor','fillColor','numberFormat','wrapText','horizontalAlignment','verticalAlignment','displayText','locked','mergedAddress','arrayFormula','hiddenRow','hiddenColumn','rowHeight','columnWidth','borders','validation','validationValid'];
const book=()=>createWorkbook({name:'출장신청서.xlsx',sheets:[{name:'신청서',merges:['A1:D1','B3:C3'],cells:{
  A1:{value:'출장 신청서',bold:true,fontSize:14,horizontalAlignment:'center'},A3:{value:'담당 부서'},
  A4:{value:'수량'},B4:{value:3},A5:{value:'단가'},B5:{value:15000,numberFormat:'#,##0'},A6:{value:'합계'},B6:{formula:'=B4*B5',numberFormat:'#,##0'},
  A7:{value:'구분'},B7:{value:'국내',validation:{type:3,formula1:'국내,해외',ignoreBlank:true,inCellDropdown:true,listSeparator:','}}}}]});

test('a read returns every native cell field with the documented defaults',()=>{
  const w=book(),state=w.read(w.sheets[0].id,'A1:D7');
  assert.deepEqual(Object.keys(state.cells[0][0]),FIELDS);
  assert.deepEqual([state.cells.length,state.cells[0].length],[7,4]);
  const plain=state.cells[3][0];
  assert.deepEqual([plain.fontName,plain.fontSize,plain.fontColor,plain.numberFormat,plain.horizontalAlignment,plain.verticalAlignment,plain.locked,plain.rowHeight,plain.columnWidth],['맑은 고딕',11,'#000000','General','general','center',true,16.5,8.38]);
  assert.deepEqual([state.documentId,state.sheetId,state.workbook,state.worksheet,state.address,state.readOnly,state.protected,state.date1904],[w.documentId,w.sheets[0].id,'출장신청서.xlsx','신청서','A1:D7',false,false,false]);
});
test('a single cell address is reported as a range like the native reader',()=>{
  const w=book();assert.equal(w.read(w.sheets[0].id,'B4').address,'B4:B4');
});
test('merged followers are empty and carry the merge address',()=>{
  const w=book(),state=w.read(w.sheets[0].id,'A1:D3');
  assert.deepEqual(state.cells[0].map(c=>c.mergedAddress),['A1:D1','A1:D1','A1:D1','A1:D1']);
  assert.deepEqual(state.cells[0].map(c=>c.value),['출장 신청서',null,null,null]);
  assert.equal(state.cells[2][1].mergedAddress,'B3:C3');assert.equal(state.cells[2][3].mergedAddress,null);
});
test('a value placed on a merged follower is refused when the workbook is built',()=>{
  assert.throws(()=>createWorkbook({name:'b.xlsx',sheets:[{name:'S',merges:['A1:B1'],cells:{B1:{value:'x'}}}]}),/sim_merge_follower_value/);
});
test('formulas recalculate after a write and keep their number format text',()=>{
  const w=book(),id=w.sheets[0].id;
  assert.deepEqual([w.read(id,'B6').cells[0][0].value,w.read(id,'B6').cells[0][0].displayText],[45000,'45,000']);
  w.write(id,'B4',[{row:0,column:0,field:'value',value:4}]);
  const total=w.read(id,'B6').cells[0][0];
  assert.deepEqual([total.value,total.formula,total.displayText,total.error],[60000,'=B4*B5','60,000',false]);
});
test('patch offsets are relative to the written range',()=>{
  const w=book(),id=w.sheets[0].id;
  w.write(id,'A4:B5',[{row:1,column:1,field:'value',value:20000},{row:0,column:1,field:'bold',value:true}]);
  const state=w.read(id,'B4:B6');
  assert.deepEqual([state.cells[1][0].value,state.cells[0][0].bold,state.cells[2][0].value],[20000,true,60000]);
});
test('writing a value clears a formula and writing text keeps the text',()=>{
  const w=book(),id=w.sheets[0].id;
  w.write(id,'B6',[{row:0,column:0,field:'value',value:'00123'}]);
  const cell=w.read(id,'B6').cells[0][0];assert.deepEqual([cell.value,cell.formula],['00123',null]);
});
test('writing a formula clears the previous value and clearing a value empties the cell',()=>{
  const w=book(),id=w.sheets[0].id;
  w.write(id,'B4',[{row:0,column:0,field:'formula',value:'=1+2'}]);
  assert.deepEqual([w.read(id,'B4').cells[0][0].value,w.read(id,'B4').cells[0][0].formula],[3,'=1+2']);
  w.write(id,'B5',[{row:0,column:0,field:'value',value:null}]);
  assert.deepEqual([w.read(id,'B5').cells[0][0].value,w.read(id,'B5').cells[0][0].displayText],[null,'']);
});
test('a formula error is marked the way the native reader marks it',()=>{
  const w=book(),id=w.sheets[0].id;
  w.write(id,'B5',[{row:0,column:0,field:'value',value:'열'}]);
  const total=w.read(id,'B6').cells[0][0];assert.deepEqual([total.value,total.error],['#EXCEL_ERROR',true]);
});
test('list validation reports whether the current value is allowed',()=>{
  const w=book(),id=w.sheets[0].id;
  assert.equal(w.read(id,'B7').cells[0][0].validationValid,true);
  w.write(id,'B7',[{row:0,column:0,field:'value',value:'우주'}]);assert.equal(w.read(id,'B7').cells[0][0].validationValid,false);
  w.write(id,'B7',[{row:0,column:0,field:'value',value:null}]);assert.equal(w.read(id,'B7').cells[0][0].validationValid,true);
  assert.equal(w.read(id,'B4').cells[0][0].validation,null);assert.equal(w.read(id,'B4').cells[0][0].validationValid,null);
});
test('number validation compares against its bounds',()=>{
  const w=createWorkbook({name:'b.xlsx',sheets:[{name:'S',cells:{A1:{value:5,validation:{type:1,operator:1,formula1:'1',formula2:'10',ignoreBlank:false}},A2:{value:11,validation:{type:2,operator:8,formula1:'10',ignoreBlank:false}},A3:{validation:{type:1,operator:5,formula1:'0',ignoreBlank:false}}}}]});
  const state=w.read(w.sheets[0].id,'A1:A3');
  assert.deepEqual(state.cells.map(row=>row[0].validationValid),[true,false,false]);
});
test('an unsupported validation is refused instead of passing silently',()=>{
  assert.throws(()=>createWorkbook({name:'b.xlsx',sheets:[{name:'S',cells:{A1:{value:1,validation:{type:7,formula1:'=A1>0'}}}}]}),/sim_validation_unsupported/);
  assert.throws(()=>createWorkbook({name:'b.xlsx',sheets:[{name:'S',cells:{A1:{value:1,validation:{type:3,formula1:'=목록!A1:A3',listSeparator:','}}}}]}),/sim_validation_unsupported/);
});
test('hidden rows, protection and read-only state appear in the read',()=>{
  const w=createWorkbook({name:'b.xlsx',readOnly:true,sheets:[{name:'S',protected:true,hiddenRows:[2],hiddenColumns:[2],cells:{A1:{value:1}}}]});
  const state=w.read(w.sheets[0].id,'A1:B2');
  assert.deepEqual([state.readOnly,state.protected],[true,true]);
  assert.deepEqual(state.cells.map(row=>row.map(c=>[c.hiddenRow,c.hiddenColumn])),[[[false,false],[false,true]],[[true,false],[true,true]]]);
});
test('a clone is an independent document with the same content',()=>{
  const w=book();w.customXml.push({id:'x'});const copy=w.clone({name:'사본.xlsx'});
  assert.notEqual(copy.documentId,w.documentId);assert.notEqual(copy.sheets[0].id,w.sheets[0].id);assert.equal(copy.name,'사본.xlsx');assert.deepEqual(copy.customXml,[{id:'x'}]);
  copy.write(copy.sheets[0].id,'B4',[{row:0,column:0,field:'value',value:9}]);copy.customXml.push({id:'y'});
  assert.equal(w.read(w.sheets[0].id,'B4').cells[0][0].value,3);assert.equal(copy.read(copy.sheets[0].id,'B6').cells[0][0].value,135000);assert.equal(w.customXml.length,1);
});
test('a clone carries custom XML parts that were replaced after the workbook was built',()=>{
  const w=book();w.customXml=[{namespace:'urn:test',record:{id:'r1'}}];
  assert.deepEqual(w.clone().customXml,[{namespace:'urn:test',record:{id:'r1'}}]);
});
test('the used range covers every cell that has content or a merge',()=>{
  const w=book();assert.equal(w.usedRange(w.sheets[0].id),'A1:D7');
  const empty=createWorkbook({name:'b.xlsx',sheets:[{name:'S',cells:{}}]});assert.equal(empty.usedRange(empty.sheets[0].id),'A1');
});
test('an unknown sheet is reported as a closed document',()=>{
  const w=book();assert.throws(()=>w.read('missing','A1'),/document_closed/);assert.throws(()=>w.write('missing','A1',[]),/document_closed/);
});
