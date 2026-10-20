import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {createWordDocument} from '../dist/word.js';
const reference=JSON.parse(await readFile(new URL('../eval/WD-CREATE-01.reference-draft.json',import.meta.url),'utf8'));
async function oracle(){const url=new URL('../eval/word-create-oracle.mjs',import.meta.url);assert.equal(await access(url).then(()=>true,()=>false),true,'The independent Word task oracle is missing');return import(url.href);}
test('the generated fixed report meets independently specified facts and structure',async()=>{
  const {evaluateWordCreate01}=await oracle();const {bytes}=await createWordDocument(reference,new AbortController().signal);
  const report=await evaluateWordCreate01(bytes);assert.equal(report.passed,true);assert.deepEqual(report.failed,[]);
  assert.equal(report.visualVerified,false);assert.equal(report.officeVerified,false);
});
test('the task oracle detects a wrong total even if the file is valid',async()=>{
  const {evaluateWordCreate01}=await oracle();const draft=structuredClone(reference);draft.sections[1].table.rows[3][1]='7';
  const report=await evaluateWordCreate01((await createWordDocument(draft,new AbortController().signal)).bytes);
  assert.equal(report.passed,false);assert.ok(report.failed.includes('counts_and_totals'));
});
test('the task oracle rejects an invented cost and missing owner',async()=>{
  const {evaluateWordCreate01}=await oracle();const draft=structuredClone(reference);draft.sections[2].paragraphs[1][0].text='출처 확인 비용은 100만원입니다.';
  const report=await evaluateWordCreate01((await createWordDocument(draft,new AbortController().signal)).bytes);
  assert.equal(report.passed,false);assert.ok(report.failed.includes('no_invented_cost'));assert.ok(report.failed.includes('pending_owners_and_dates'));
});
test('the task oracle catches dates assigned to the wrong owners and an incorrect completion rate',async()=>{
  const {evaluateWordCreate01}=await oracle();const draft=structuredClone(reference);
  draft.sections[2].paragraphs[0][0].text='김민수는 Word 표 서식을 10월 19일까지 검토합니다. 이지은은 Excel 합계 수식을 10월 16일까지 검증합니다.';
  draft.sections[2].paragraphs[1][0].text='박서준은 PowerPoint의 출처를 10월 16일까지 확인합니다. 비용 근거는 확인 중입니다.';
  draft.sections[0].paragraphs[0][1].text=' 검토 완료율은 70%입니다. 별도 수치는 50%입니다. 검토 대기 3건을 처리한 뒤 10월 19일 16시에 다시 결정합니다.';
  const report=await evaluateWordCreate01((await createWordDocument(draft,new AbortController().signal)).bytes);
  assert.ok(report.failed.includes('pending_owners_and_dates'));assert.ok(report.failed.includes('completion_rate'));
});
