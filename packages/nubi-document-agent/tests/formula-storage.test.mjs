import test from 'node:test';import assert from 'node:assert/strict';import JSZip from'jszip';
import{createExcelDocument}from'../dist/excel.js';
const c=(value,formula=null)=>({value,formula,format:'general',role:'body'});
test('post-2007 worksheet functions use the existing GenOffice storage markers outside literal text',async()=>{
 const rows=[['NORM.DIST(0,0,1,TRUE)','_xlfn.NORM.DIST(0,0,1,TRUE)'],['IFNA(NA(),-1)','_xlfn.IFNA(NA(),-1)'],['"STDEV.S(1)"','"STDEV.S(1)"'],['_xlfn.XOR(TRUE,FALSE)','_xlfn.XOR(TRUE,FALSE)']].map(([formula])=>[c(null,formula)]);
 const generated=await createExcelDocument({title:'Storage',sheets:[{name:'計算',columnWidths:[40],rows}]},new AbortController().signal),zip=await JSZip.loadAsync(generated.bytes),xml=await zip.file('xl/worksheets/sheet1.xml').async('string');
 assert.ok(xml.includes('_xlfn.NORM.DIST(0,0,1,TRUE)'));assert.ok(xml.includes('_xlfn.IFNA(NA(),-1)'));assert.ok(xml.includes('&quot;STDEV.S(1)&quot;')||xml.includes('"STDEV.S(1)"'));assert.ok(!xml.includes('"_xlfn.STDEV.S(1)"'));assert.ok(!xml.includes('_xlfn._xlfn.'));
});
