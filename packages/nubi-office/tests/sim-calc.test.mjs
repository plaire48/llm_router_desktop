import test from 'node:test';
import assert from 'node:assert/strict';
import {calculate} from '../eval/sim/calc.mjs';

const cell=(row,column,value,extra={})=>({row,column,value,formula:null,numberFormat:'General',...extra});
const formula=(row,column,text,extra={})=>({row,column,value:null,formula:text,numberFormat:'General',...extra});

test('formulas calculate across sheets with Korean names',()=>{
  const [main]=calculate([
    {name:'양식',cells:[cell(2,1,100),cell(3,1,250),formula(4,1,'=SUM(A2:A3)'),formula(5,1,'=SUM(동부!B2:B3,서부!B2:B3)')]},
    {name:'동부',cells:[cell(2,2,120),cell(3,2,80)]},
    {name:'서부',cells:[cell(2,2,50),cell(3,2,150)]}]);
  assert.deepEqual(main.get('4:1'),{value:350,error:false,displayText:'350'});
  assert.equal(main.get('5:1').value,400);
});
test('Excel 2016 lookup and conditional functions are available',()=>{
  const [sheet]=calculate([{name:'S',cells:[cell(2,1,100),cell(3,1,250),cell(2,2,'x'),cell(3,2,'y'),
    formula(5,1,'=INDEX(B2:B3,MATCH(250,A2:A3,0))'),formula(6,1,'=SUMIFS(A2:A3,A2:A3,">100")'),formula(7,1,'=MAX(A2:A3)-MIN(A2:A3)'),formula(8,1,'=IFERROR(1/0,0)')]}]);
  assert.equal(sheet.get('5:1').value,'y');assert.equal(sheet.get('6:1').value,250);assert.equal(sheet.get('7:1').value,150);assert.equal(sheet.get('8:1').value,0);
});
test('errors use the native error marker',()=>{
  const [sheet]=calculate([{name:'S',cells:[formula(1,1,'=1/0'),formula(2,1,'=A2'),formula(3,1,'=NOPE(1)')]}]);
  for(const key of ['1:1','2:1','3:1'])assert.deepEqual({value:sheet.get(key).value,error:sheet.get(key).error},{value:'#EXCEL_ERROR',error:true});
});
test('a formula the calculator cannot parse is an error cell, not a crash',()=>{
  const [sheet]=calculate([{name:'S',cells:[formula(1,1,'=SUM(('),cell(2,1,7)]}]);
  assert.deepEqual({value:sheet.get('1:1').value,error:sheet.get('1:1').error},{value:'#EXCEL_ERROR',error:true});
  assert.equal(sheet.get('2:1').value,7);
});
test('text keeps leading zeros and number formats shape the displayed text',()=>{
  const [sheet]=calculate([{name:'S',cells:[cell(1,1,'00123'),cell(2,1,1234.5,{numberFormat:'#,##0.00'}),cell(3,1,46296,{numberFormat:'yyyy-mm-dd'}),cell(4,1,0.125,{numberFormat:'0.00%'}),cell(5,1,true),cell(6,1,null)]}]);
  assert.deepEqual(sheet.get('1:1'),{value:'00123',error:false,displayText:'00123'});
  assert.equal(sheet.get('2:1').displayText,'1,234.50');assert.equal(sheet.get('3:1').displayText,'2026-10-01');assert.equal(sheet.get('4:1').displayText,'12.50%');
  assert.equal(sheet.get('5:1').value,true);assert.equal(sheet.has('6:1'),false);
});
test('text that looks like a number or a formula stays text',()=>{
  const [sheet]=calculate([{name:'S',cells:[cell(1,1,'42'),cell(2,1,'2026-10-01'),formula(3,1,'=ISNUMBER(A1)'),formula(4,1,'=ISTEXT(A2)')]}]);
  assert.equal(sheet.get('1:1').value,'42');assert.equal(sheet.get('3:1').value,false);assert.equal(sheet.get('4:1').value,true);
});
