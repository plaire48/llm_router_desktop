import test from'node:test';import assert from'node:assert/strict';import JSZip from'jszip';import{createExcelDocument}from'../dist/excel.js';
test('the sheet-copy bridge preserves original print names and clones their scope for a new sheet',async()=>{
 const {preparePrintNameCopy}=await import('../scripts/genoffice-sheet-copy.mjs'),cell=value=>({value,formula:null,format:'general',role:'body'}),bytes=(await createExcelDocument({title:'Print',sheets:[{name:'Source',columnWidths:[20],rows:[[cell(1)]]}]},new AbortController().signal)).bytes;
 const prepared=await preparePrintNameCopy(bytes,[{op:'duplicate_sheet',sheet:'Source',name:'Copy'}]),input=await JSZip.loadAsync(prepared.bytes);assert.ok(!(await input.file('xl/workbook.xml').async('string')).includes('localSheetId="0"'));
 let xml=await input.file('xl/workbook.xml').async('string');input.file('xl/workbook.xml',xml.replace('</sheets>','<sheet name="Copy" sheetId="2" r:id="rIdCopy"/></sheets>'));const output=await JSZip.loadAsync(await prepared.restore(await input.generateAsync({type:'uint8array'}))),result=await output.file('xl/workbook.xml').async('string');
 assert.ok(result.includes('localSheetId="0"'));assert.ok(result.includes('localSheetId="1"'));assert.ok(result.includes("&apos;Copy&apos;!")||result.includes("'Copy'!"));assert.ok(result.includes("&apos;Source&apos;!")||result.includes("'Source'!"));
 const original=await JSZip.loadAsync(bytes);assert.ok((await original.file('xl/workbook.xml').async('string')).includes('localSheetId="0"'));
});
