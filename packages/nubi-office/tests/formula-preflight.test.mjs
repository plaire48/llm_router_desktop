import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectFormula,documentFormulaAudit} from '../worker/formula-preflight.mjs';
import {validateFormula} from '../worker/document-schema.mjs';
const options={sheets:['Sheet1','성적 표',"A'B"],worksheet:'Sheet1',strict:true};

test('Excel 2016 formula tokens preserve literals, scientific notation and quoted references',()=>{
 for(const formula of ['=RANK.EQ(A2,$A$2:$A$10,0)','=IFNA(INDEX(A1:B9,MATCH(2,A1:A9,0),2),0)','=ROUND(SUM(A1:A4),2)','=AVERAGEIFS(B1:B9,A1:A9,">0")','=1e-3+2E3','=IF(A1,,0)','="XLOOKUP([external])"','="a""b"']){
  assert.equal(validateFormula(formula,options.sheets),formula);
 }
 assert.equal(inspectFormula("='성적 표'!$B$2+'sHeEt1'!A1",options).references[1].sheet,'sHeEt1');
 assert.equal(inspectFormula("='A''B'!A1",options).references[0].sheet,"A'B");
});

test('malformed expressions and unsupported formula features return actionable causes',()=>{
 for(const formula of ['=SUM(1,','=A1+','=SUM(A1))','=IF(A1)','=TODAY(1)','=SUM(1+,2)','=ROUND(A1,) +','=A1 B1 +','=SUM("open)','=SUM(())']){
  assert.throws(()=>inspectFormula(formula,options),e=>e.message==='formula_syntax_invalid'&&!!e.issue,formula);
 }
 for(const formula of ['=XLOOKUP(A1,A2:A9,B2:B9)','=LET(x,1,x)','=EVILUDF(A1)','=INDIRECT("A1")','=Table1[Value]','=[Book.xlsx]Sheet1!A1','=SUM(Sheet1:Sheet2!A1)']){
  assert.throws(()=>inspectFormula(formula,options),e=>e.message==='unsupported_formula'&&!!e.issue,formula);
 }
 assert.throws(()=>inspectFormula('=A1#',options),/formula_syntax_invalid|unsupported_formula/);
 for(const formula of ["='Missing'!A1",'=#REF!','=UnknownName','=XFE1','=A1048577'])assert.throws(()=>inspectFormula(formula,options),/document_reference_invalid/);
});

test('formula graph finds self, range and cross-sheet cycles before workbook creation',()=>{
 const specs=[{name:'Sheet1',cells:[{address:'A1',formula:"='성적 표'!B1"},{address:'A2',formula:'=SUM(A1:A2)'},{address:'B1',value:2}]},{name:'성적 표',cells:[{address:'B1',formula:'=Sheet1!A1'},{address:'B2',formula:'=B1*2'}]}];
 const result=documentFormulaAudit(specs);assert.equal(result.verified,false);assert.equal(result.issues.length,3);assert.equal(result.affectedFormulaCount,4);assert.ok(result.issues.every(i=>i.code==='circular_formula'));
 specs[1].cells[0].formula='=Sheet1!B1';specs[0].cells[1].formula='=SUM(A1)';
 assert.equal(documentFormulaAudit(specs).verified,true);
});

test('preflight handles 8000 simple references without a quadratic candidate limit or formula rewriting',()=>{
 const specs=Array.from({length:8},(_,s)=>({name:'S'+s,cells:Array.from({length:1000},(_,i)=>({address:'A'+(i+1),formula:i?'=A'+i:'=1'}))}));
 const original=structuredClone(specs),result=documentFormulaAudit(specs);
 assert.equal(result.verified,true);assert.equal(result.formulaCount,8000);assert.deepEqual(specs,original);
});
