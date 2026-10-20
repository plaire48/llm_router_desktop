import test from 'node:test';import assert from 'node:assert/strict';import ExcelJS from 'exceljs';import{createExcelDocument}from'../dist/excel.js';
test('numeric column headings align with their data while text columns retain a readable boundary',async()=>{
 const c=(value,role='body',format='general')=>({value,role,format,formula:null});const source={title:'Reader formatting',sheets:[{name:'Data',columnWidths:[20,20],rows:[[c('금액','header'),c('설명','header')],[c(1831.8,'body','decimal'),c('승인 계약 기준')],[c(null),c(null)]]}]};
 const r=await createExcelDocument(source,new AbortController().signal),book=new ExcelJS.Workbook();await book.xlsx.load(r.bytes);const s=book.getWorksheet('Data');assert.equal(s.getCell('A1').alignment.horizontal,'right');assert.equal(s.getCell('A2').alignment.horizontal,'right');assert.equal(s.getCell('B1').alignment.horizontal,'left');assert.equal(s.getCell('B2').alignment.indent,1);assert.equal(s.getCell('A2').border.right.color.argb,'FFE5E8EB');assert.equal(s.getCell('A2').value,1831.8);
 assert.equal(s.getCell('A3').border?.right,undefined,'Empty spacing rows must not become visible table grid lines');
});
