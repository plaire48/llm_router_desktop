import test from 'node:test';import assert from 'node:assert/strict';import{createExcelDocument}from'../dist/excel.js';
test('Excel can build readable summaries using string concatenation and calculated values',async()=>{
 const c=(value,formula=null)=>({value,formula,format:'general',role:'body'});const draft={title:'Summary',sheets:[{name:'집계',columnWidths:[45,20],rows:[[c('합계'),c(5340.3)],[c(null,'"지급액 "&TEXT(B1,"#,##0.00")&"만원"'),c(0)]]}]};
 const result=await createExcelDocument(draft,new AbortController().signal);assert.ok(result.bytes.length>4000);
 for(const [invalid,code] of [['"미완료&B1','excel_formula_invalid'],['"합계"&WEBSERVICE("https://example.com")','excel_formula_host_capability_required']]){const bad=structuredClone(draft);bad.sheets[0].rows[1][0].formula=invalid;await assert.rejects(createExcelDocument(bad,new AbortController().signal),{code});}
});
test('a business approval formula combines time, budget and pending conditions with AND OR NOT',async()=>{
 const c=(value,formula=null)=>({value,formula,format:'general',role:'body'});const draft={title:'Gate',sheets:[{name:'判定',columnWidths:[18,18,18,25],rows:[[c(-60),c(192.6),c(3),c(null,'IF(AND(A1>=0,B1>=0,C1=0),"승인","보류")')],[c(null,'OR(A1<0,C1>0)'),c(null,'NOT(C1=0)'),c(0),c(0)]]}]};
 assert.ok((await createExcelDocument(draft,new AbortController().signal)).bytes.length>4000);
 const bad=structuredClone(draft);bad.sheets[0].rows[1][1].formula='NOT(1,2)';await assert.rejects(createExcelDocument(bad,new AbortController().signal),{code:'excel_formula_invalid'});
});
