// The form map is a compact, deterministic reading aid for the model. It is a
// set of HINTS: it never authorizes a write and the user still confirms fields.
import test from 'node:test';
import assert from 'node:assert/strict';
import {formMap} from '../worker/form-map.mjs';
import {createSimHost} from '../eval/sim/host.mjs';
import {formById,forms} from '../eval/sim/forms.mjs';

const scopeOf=async form=>(await createSimHost().call('init',form)).scope;
const plain=(range,cells,merges=[])=>scopeOf({id:'plain',mode:'template',range,auditRange:range,cells,merges});
const addresses=list=>list.map(item=>item.address).sort();

test('label and input pairs are found from position, without relying on cell styling',async()=>{
  // No bold, no fill: only text beside empty writable cells.
  const map=formMap(await plain('A1:D4',{A1:{value:'부서'},C1:{value:'성명'},A2:{value:'사번'},A4:{value:'합계'},B4:{formula:'=1+2'}}));
  assert.deepEqual(map.inputs.map(item=>[item.address,item.label,item.labelAddress]),[['B1','부서','A1'],['D1','성명','C1'],['B2','사번','A2']]);
  assert.deepEqual(map.formulas,[{address:'B4',formula:'=1+2',label:'합계',labelAddress:'A4'}]);
});
test('a label serves the cell to its right before the cell below it',async()=>{
  // D1 labels E1. D2 below the label is an unlabeled blank, not a second input.
  const map=formMap(await plain('A1:E2',{A1:{value:'출발일'},D1:{value:'복귀일'}},['A1:B1']));
  assert.deepEqual(map.inputs.map(item=>[item.address,item.label]),[['C1','출발일'],['E1','복귀일']]);
});
test('a label above a blank cell names it when nothing is to its right',async()=>{
  const map=formMap(await plain('A1:B2',{A1:{value:'품목'},B1:{value:'수량'}}));
  assert.deepEqual(map.inputs.map(item=>[item.address,item.label,item.labelAddress]),[['A2','품목','A1'],['B2','수량','B1']]);
});
test('a merged label reaches its input and a merged input is reported with its span',async()=>{
  const map=formMap(await plain('A1:F1',{A1:{value:'출장 목적'}},['A1:B1','C1:F1']));
  assert.deepEqual(map.inputs,[{address:'C1',span:'C1:F1',label:'출장 목적',labelAddress:'A1'}]);
});
test('a value that follows a label is an input with a sample, never an approved default',async()=>{
  const map=formMap(await plain('A1:C2',{A1:{value:'신청자'},B1:{value:'성명'},C1:{value:'홍길동'},B2:{value:'부서'},C2:{value:'인사팀'}},['A1:A2']));
  assert.deepEqual(map.inputs.map(item=>[item.address,item.label,item.sample,item.section]),[['C1','성명','홍길동','신청자'],['C2','부서','인사팀','신청자']]);
});
test('input hints carry the number format and the choices that Excel enforces',async()=>{
  const map=formMap(await scopeOf(formById('trip-request'))),by=Object.fromEntries(map.inputs.map(item=>[item.address,item]));
  assert.equal(by.C4.numberFormat,'@');assert.equal(by.C6.numberFormat,'yyyy-mm-dd');assert.equal(by.C10.numberFormat,'#,##0');assert.equal(by.C3.numberFormat,undefined);
  assert.deepEqual(by.C5.choices,['국내','해외']);assert.equal(by.E3.span,'E3:F3');
});
test('every answer-key field of the plain forms appears among the input hints',async()=>{
  for(const id of ['expense-report','trip-request','training-request']){
    const form=formById(id),map=formMap(await scopeOf(form));
    assert.deepEqual(addresses(map.inputs),form.fields.map(field=>field.address).sort(),id);
    assert.deepEqual(map.inputs.map(item=>item.label).sort(),form.fields.map(field=>field.label).sort(),id);
  }
});
test('computed cells are listed with their labels and are never input hints',async()=>{
  const map=formMap(await scopeOf(formById('trip-request')));
  assert.deepEqual(map.formulas.map(item=>[item.address,item.label]),[['C7','출장 일수'],['E10','예상 경비']]);
  assert.equal(map.inputs.some(item=>['C7','E10'].includes(item.address)),false);
});
test('the title and free notes are reported as fixed text',async()=>{
  const map=formMap(await scopeOf(formById('trip-request')));
  assert.deepEqual(map.title,{address:'A1',span:'A1:F1',text:'출장 신청서'});
  assert.deepEqual(map.notes.map(note=>note.address),['A12']);
});
test('an item table is described once by its columns instead of cell by cell',async()=>{
  const map=formMap(await scopeOf(formById('quotation')));
  assert.equal(map.tables.length,1);const [table]=map.tables;
  assert.deepEqual([table.address,table.headerRow,table.firstRow,table.lastRow],['A6:F10',6,7,10]);
  assert.deepEqual(table.columns.map(column=>[column.column,column.header,column.role]),[['A','No','fixed'],['B','품목','input'],['C','규격','input'],['D','수량','input'],['E','단가','input'],['F','금액','formula']]);
  assert.equal(table.columns[5].formula,'=IF(OR(D{r}="",E{r}=""),"",D{r}*E{r})');assert.equal(table.columns[4].numberFormat,'#,##0');
  assert.deepEqual(addresses(map.inputs),['B14','B3','B4','E3','E4']);
  assert.deepEqual(map.formulas.map(item=>[item.address,item.label]),[['F11','공급가액'],['F12','부가세'],['F13','합계']]);
});
test('table cells and scalar inputs together cover the whole answer key',async()=>{
  const form=formById('quotation'),map=formMap(await scopeOf(form)),cells=[...map.inputs.map(item=>item.address)];
  for(const table of map.tables)for(const column of table.columns.filter(item=>item.role==='input'))for(let row=table.firstRow;row<=table.lastRow;row++)cells.push(column.column+row);
  assert.deepEqual(cells.sort(),form.fields.map(field=>field.address).sort());
});
test('the map is much smaller than the page by page listing it replaces',async()=>{
  const {analyzeTemplate}=await import('../worker/template.mjs');
  for(const form of forms){
    const scope=await scopeOf(form),map=JSON.stringify(formMap(scope)).length,paged=JSON.stringify(analyzeTemplate(scope).cells).length;
    assert.ok(map<paged/3,`${form.id}: map ${map} vs pages ${paged}`);assert.ok(map<6000,`${form.id}: map ${map}`);
  }
});
test('a form too large for the budget is cut with the omitted counts stated',async()=>{
  const cells={};for(let row=1;row<=60;row++){cells['A'+row]={value:'항목 '+row+' '+'가'.repeat(40)};}
  const map=formMap(await plain('A1:B60',cells),{maxCharacters:3000});
  assert.ok(JSON.stringify(map).length<=3000);assert.ok(map.omitted.inputs>0);assert.equal(map.inputs.length+map.omitted.inputs,60);
  assert.match(map.note,/inspect_template/);
});
test('cells that cannot be written are never offered as inputs',async()=>{
  const hidden=formMap(await scopeOf({id:'h',mode:'template',range:'A1:B2',auditRange:'A1:B2',cells:{A1:{value:'부서'},A2:{value:'성명'}},hiddenRows:[2]}));
  assert.deepEqual(addresses(hidden.inputs),['B1']);
  const locked=formMap(await scopeOf({id:'p',mode:'template',range:'A1:B1',auditRange:'A1:B1',cells:{A1:{value:'부서'}},protected:true}));
  assert.deepEqual(locked.inputs,[]);assert.equal(locked.writable,false);
});
