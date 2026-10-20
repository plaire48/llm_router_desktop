import test from 'node:test';
import assert from 'node:assert/strict';
import {validateExcelDraft,createExcelDocument} from '../dist/excel.js';
import {createGeneratedFileSession} from '../dist/file-operations.js';
import {createWordDocument} from '../dist/word.js';
const cell=value=>({value,formula:null,format:'general',role:'body'});
test('a bounded annual workbook supports eight schedules and twelve monthly columns',async()=>{
 const draft={title:'Annual delivery budget',sheets:Array.from({length:8},(_,s)=>({name:`Schedule${s}`,columnWidths:Array(16).fill(14),rows:Array.from({length:s===2?193:14},()=>Array.from({length:16},()=>cell(0)))}))};
 draft.sheets[7].rows[1][15]={...cell(null),formula:"SUM('Schedule2'!B2:B193)"};
 assert.doesNotThrow(()=>validateExcelDraft(draft));
 const created=await createExcelDocument(draft,new AbortController().signal);assert.ok(created.bytes.length>10000);
 const {default:JSZip}=await import('jszip'),zip=await JSZip.loadAsync(created.bytes);assert.match(await zip.file('xl/workbook.xml').async('string'),/_xlnm.Print_Titles/);
 for(const mutation of [d=>d.sheets.push(d.sheets[0]),d=>d.sheets[0].rows=Array(401).fill(d.sheets[0].rows[0]),d=>d.sheets[0].columnWidths=Array(21).fill(14)]){
  const bad=structuredClone(draft);mutation(bad);assert.throws(()=>validateExcelDraft(bad));
 }
});
test('complex Word layout operations are discoverable while protected originals remain unavailable',async()=>{
 const bytes=(await createWordDocument({title:'Form',sections:[{heading:'Approval',paragraphs:[[{text:'Review',bold:false}]],table:null}]},new AbortController().signal)).bytes;
 const session=await createGeneratedFileSession({domain:'word',origin:'new_unencrypted_draft',bytes},{async invoke(){throw Error('must_not_dispatch');}});
 for(const op of ['insert_section_break','insertField','insertToc'])assert.ok(session.catalog({op}).length,op);
 await assert.rejects(createGeneratedFileSession({domain:'word',origin:'encrypted_original',bytes},{}));session.dispose();
});
test('money with fractional units remains visible and large dependency graphs stay bounded',async()=>{
 const draft={title:'Money',sheets:[{name:'Amounts',columnWidths:[18],rows:[[{...cell(877.4),format:'decimal'}]]}]};
 const result=await createExcelDocument(draft,new AbortController().signal);
 const {inspectGeneratedExcel}=await import('../dist/excel.js');assert.equal((await inspectGeneratedExcel(result.bytes)).sheets[0].rows[0][0].format,'#,##0.00');
 const dense={title:'Dense',sheets:[{name:'Raw',columnWidths:Array(20).fill(10),rows:Array.from({length:400},()=>Array.from({length:20},()=>cell(1)))},{name:'Calc',columnWidths:[18],rows:Array.from({length:40},()=>[{...cell(null),formula:"SUM('Raw'!A1:T400)"}])}]};
 assert.throws(()=>validateExcelDraft(dense),{code:'excel_formula_invalid'});
});
