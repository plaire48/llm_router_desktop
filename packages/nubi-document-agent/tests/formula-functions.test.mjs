import test from 'node:test';import assert from 'node:assert/strict';
import {createExcelDocument,inspectGeneratedExcel} from '../dist/excel.js';
const cell=value=>({value,formula:null,format:'general',role:'body'});
const formulas=['COUNTIF(A2:A4,"완료")','COUNTIFS(A2:A4,"완료",B2:B4,">=20")','SUMIF(A2:A4,"완료",B2:B4)','SUMIFS(B2:B4,A2:A4,"완료",B2:B4,">=20")','ROUND(10.125,2)','IFERROR(1/0,0)','VLOOKUP("완료",A2:B4,2,FALSE)','INDEX(B2:B4,MATCH("진행",A2:A4,0))','MATCH("진행",A2:A4,0)','DATE(2024,2,29)','TEXT(DATE(2024,2,29),"yyyy-mm-dd")'];
const draft=formula=>({title:'함수 검사',sheets:[{name:'결과',columnWidths:[20,20,40],rows:[[cell('상태'),cell('금액'),{...cell(null),formula}],[cell('완료'),cell(10),cell(null)],[cell('진행'),cell(20),cell(null)],[cell('완료'),cell(30),cell(null)]]}]});
for(const formula of formulas)test(`Excel serializes bounded Excel 2016 function ${formula}`,async()=>{const r=await createExcelDocument(draft(formula),new AbortController().signal);assert.equal((await inspectGeneratedExcel(r.bytes)).sheets[0].rows[0][2].formula,formula);});
test('new function syntax retains executable-function, external-reference, arity and cycle rejection',async()=>{
 for(const formula of ['COUNTIFS(A2:A4,"완료",B2:B4)','SUMIFS(B2:B4,A2:A4)','DATE(2024,2)','VLOOKUP("x",A2:XFE999,2,FALSE)','IFERROR(C1,0)','TEXT(1,"unterminated)','SUM(\'[external.xlsx]Sheet\'!A1)'])await assert.rejects(createExcelDocument(draft(formula),new AbortController().signal),{code:'excel_formula_invalid'},formula);
 await assert.rejects(createExcelDocument(draft('HYPERLINK("https://example.com")'),new AbortController().signal),{code:'excel_formula_host_capability_required'});
});
test('date-returning formulas keep an actual Excel date display format',async()=>{
 const value=draft('DATE(2024,2,29)');value.sheets[0].rows[0][2].format='date';
 const result=await createExcelDocument(value,new AbortController().signal),read=await inspectGeneratedExcel(result.bytes);
 assert.equal(read.sheets[0].rows[0][2].formula,'DATE(2024,2,29)');assert.equal(read.sheets[0].rows[0][2].format,'yyyy-mm-dd');
});
export {formulas};
