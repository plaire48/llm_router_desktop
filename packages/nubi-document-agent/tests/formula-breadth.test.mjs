import test from 'node:test';
import assert from 'node:assert/strict';
import {createExcelDocument,inspectGeneratedExcel,excelDraftSchema} from '../dist/excel.js';
import {compositionSchemas,expandExcelComposition} from '../dist/composition.js';
const cell=(value,formula=null)=>({value,formula,format:'general',role:'body'});
const draft=formula=>({title:'Formula breadth',sheets:[{name:'계산',columnWidths:[20,20,20,50],rows:[[cell(2),cell(5),cell('k'),cell(null,formula)],[cell(4),cell(10),cell('m'),cell(null)],[cell(6),cell(15),cell('n'),cell(null)]]},{name:'원천 자료',columnWidths:[20],rows:[[cell(3)],[cell(7)]]}]});
const examples=['ABS(-2)','AVERAGE(A1:A3)','MIN(A1:A3)','MAX(A1:A3)','COUNT(A1:A3)','COUNTA(C1:C3)','SUMPRODUCT(A1:A3,B1:B3)','SUBTOTAL(9,A1:A3)','ROUNDUP(1.21,1)','ROUNDDOWN(1.29,1)','PMT(0.01,12,-1000)','NETWORKDAYS(DATE(2024,1,1),DATE(2024,1,5))','NORM.DIST(0,0,1,TRUE)','STDEV.S(A1:A3)','LEN(C1)','LEFT(C1,1)','CONCATENATE(C1,C2)','ISNUMBER(A1)','HLOOKUP(2,A1:B2,2,FALSE)','CHOOSE(2,10,20)','PI()','1e-3+2^3+50%','SUM({1,2;3,4})','IF(A1>0,TRUE)','IFERROR(NA(),0)','SUM(\'원천 자료\'!A1:A2)','sum(A1:A3)','SUM(A1:A3*B1:B3)','INDIRECT("A2")','SUM(OFFSET(A1,0,0,3,1))'];
for(const formula of examples)test('ordinary Office 2016 formula is not stopped by a small function allowlist: '+formula,async()=>{
 const result=await createExcelDocument(draft(formula),new AbortController().signal);
 assert.equal((await inspectGeneratedExcel(result.bytes)).sheets[0].rows[0][3].formula.replaceAll('_xlfn.',''),formula);
 assert.equal(result.calculationRequired,true);
});
test('engineering function names containing digits are not mistaken for cell addresses',async()=>{
 for(const formula of ['DEC2BIN(5)','BIN2DEC("101")','LOG10(100)'])assert.ok((await createExcelDocument(draft(formula),new AbortController().signal)).bytes.length>4000);
});
test('the schema and composition accept an actual formula longer than 240 characters',async()=>{
 const formula='SUM('+Array(150).fill('A1').join(',')+')';
 assert.equal(excelDraftSchema.properties.sheets.items.properties.rows.items.items.properties.formula.maxLength,8192);
 assert.equal(compositionSchemas.excel.properties.sheets.items.properties.cells.items.properties.formula.maxLength,8192);
 const result=await createExcelDocument(draft(formula),new AbortController().signal);assert.ok(result.bytes.length>4000);
 const plan={title:'Long',sheets:[{name:'計算',widths:[20,20],cells:[{address:'A1',value:2},{address:'B1',formula}]}],outputs:[{metric:'result',sheet:'計算',cell:'B1'}]};
 assert.equal(expandExcelComposition(plan,{}).sheets[0].rows[0][1].formula,formula);
});
test('broader function handling retains actual reference, executable and cycle checks',async()=>{
 for(const formula of ['SUMPRODUCT(A1:A3,XFE99:XFE101)','AVERAGE(D1)','SUM(\'[external.xlsx]Data\'!A1)','CALL("dll","f","J")','WEBSERVICE("https://example.com")','HYPERLINK("https://example.com")','NOT(1,2)','DATE(2024,2)','UNKNOWN_FUNCTION(1)','XLOOKUP(1,A1:A3,B1:B3)'])await assert.rejects(createExcelDocument(draft(formula),new AbortController().signal),undefined,formula);
});
