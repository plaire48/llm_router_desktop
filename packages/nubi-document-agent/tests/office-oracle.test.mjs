import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createExcelDocument} from '../dist/excel.js';
import {createPowerPointDocument} from '../dist/powerpoint.js';
import JSZip from 'jszip';
const path=new URL('../eval/office-create-oracle.mjs',import.meta.url);
const oracle=existsSync(path)?await import(path):{};
const excel=JSON.parse(await readFile(new URL('../eval/EX-CREATE-01.reference-draft.json',import.meta.url)));
const ppt=JSON.parse(await readFile(new URL('../eval/PP-CREATE-01.reference-draft.json',import.meta.url)));
const signal=()=>new AbortController().signal;
test('fixed Excel oracle checks source facts and live total references without claiming calculation',async()=>{
  assert.equal(typeof oracle.evaluateExcelCreate01,'function','Independent Excel task checks are missing');
  const result=await oracle.evaluateExcelCreate01((await createExcelDocument(excel,signal())).bytes);
  assert.equal(result.passed,true);assert.equal(result.calculationVerified,false);
  const wrong=structuredClone(excel);wrong.sheets[0].rows[4][1].formula='SUM(B2:B3)';
  assert.equal((await oracle.evaluateExcelCreate01((await createExcelDocument(wrong,signal())).bytes)).passed,false);
});
test('fixed PPT oracle rejects incorrect totals and dates assigned to the wrong owner',async()=>{
  assert.equal(typeof oracle.evaluatePowerPointCreate01,'function','Independent PowerPoint task checks are missing');
  const result=await oracle.evaluatePowerPointCreate01((await createPowerPointDocument(ppt,signal())).bytes);
  assert.equal(result.passed,true);
  const wrong=structuredClone(ppt);wrong.slides[1].table.rows[3][1]='7';wrong.slides[2].table.rows[0][3]='10월 19일';
  assert.equal((await oracle.evaluatePowerPointCreate01((await createPowerPointDocument(wrong,signal())).bytes)).passed,false);
});
test('the Excel oracle accepts equivalent unquoted internal sheet references after a calculation-engine save',async()=>{
  const bytes=(await createExcelDocument(excel,signal())).bytes,zip=await JSZip.loadAsync(bytes);
  const sheet=await zip.file('xl/worksheets/sheet1.xml').async('string');
  const resaved=sheet.replaceAll('&apos;원본&apos;!','원본!').replaceAll("'원본'!",'원본!');
  assert.notEqual(resaved,sheet,'The fixture must exercise a changed serialized reference');
  zip.file('xl/worksheets/sheet1.xml',resaved);
  assert.equal((await oracle.evaluateExcelCreate01(await zip.generateAsync({type:'uint8array'}))).passed,true);
});
