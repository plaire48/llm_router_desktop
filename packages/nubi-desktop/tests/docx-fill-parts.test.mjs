// Word fill of headers and footers (document forms Task J2, 2026-10-21): Sections(n).Headers and Footers hold form
// fields too (a document number cell, a date line, a security level). They are mapped with a 머리글/바닥글 label and
// written in their own part; the body part and every other zip entry stay byte for byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {createDocxWriter,verifyDocxCopy} from '../runtime/docx-apply.mjs';
import {docxSnapshot,extractFormMap} from '../runtime/docx-snapshot.mjs';
import {compareDocx} from '../runtime/docx-compare.mjs';
import {applyFill,createLedger} from '../generated/office-forms.mjs';
import {docxFromBlocks} from './helpers-docx-fixture.mjs';

const label=text=>({text,bold:true});
const form=()=>docxFromBlocks([{p:{text:'업무 연락',style:'Title'}},{table:{rows:[[label('수신'),'']]}}],{
  header:[{table:{rows:[[label('문서번호'),{text:'○○팀-2026-000'}]]}},{p:{text:'작성일: 20XX. XX. XX.'}}],
  footer:[{p:{runs:[{text:'보안 등급: '},{control:{type:'dropdown',title:'보안 등급',items:['일반','대외비']}}]}}]});

test('header and footer items carry their part and ids that cannot meet the body ids',async()=>{
  const items=(await docxSnapshot(await form())).items;
  const header=items.filter(item=>item.part==='header1'),footer=items.filter(item=>item.part==='footer1');
  assert.deepEqual(header.map(item=>item.id),['header1:t1/r1/c1','header1:t1/r1/c2','header1:p-3']);
  assert.ok(header.every(item=>item.partKind==='header'&&item.partType==='default'));
  assert.deepEqual(footer.map(item=>[item.id,item.kind]),[['footer1:p-1','paragraph'],['footer1:f-1','field']]);
  assert.equal(footer[1].paragraph,'footer1:p-1');
  assert.ok(items.filter(item=>!item.part).every(item=>!item.id.includes(':')),'body ids are unchanged');
});

test('the map labels header and footer slots and the fill writes only those parts',async()=>{
  const source=await form(),{map,items}=await extractFormMap(source);
  const labels=map.slots.map(slot=>[slot.label,slot.target]);
  assert.deepEqual(labels,[['수신','t1/r1/c2'],['머리글 문서번호','header1:t1/r1/c2'],['머리글 작성일','header1:p-3'],['바닥글 보안 등급','footer1:f-1']]);
  const [to,number,date,level]=map.slots;
  const sheet={cells:[{slot:to.id,value:'인사팀'},{slot:number.id,value:'영업팀-2026-117'},{slot:date.id,value:'2026. 10. 21.'},{slot:level.id,value:'대외비'}],rows:[],sections:[]};
  const writer=await createDocxWriter(source),run=await applyFill({map,sheet,read:writer.read,apply:writer.apply,ledger:createLedger(items,map)});
  assert.ok(run.done,JSON.stringify(run));assert.equal(run.operations.length,4,JSON.stringify(run));
  const copy=await writer.bytes(),after=(await docxSnapshot(copy)).items;
  assert.equal(after.find(item=>item.id==='header1:t1/r1/c2').text,'영업팀-2026-117');
  assert.equal(after.find(item=>item.id==='header1:p-3').text,'작성일: 2026. 10. 21.');
  assert.equal(after.find(item=>item.id==='footer1:f-1').text,'대외비');
  const verify=await verifyDocxCopy(source,copy,{targets:map.slots.map(slot=>slot.target)});
  assert.deepEqual(verify.changedEntries,['word/document.xml','word/footer1.xml','word/header1.xml']);assert.deepEqual(verify.violations,[]);assert.equal(verify.sameEntries,true);
  const [a,b]=await Promise.all([JSZip.loadAsync(source),JSZip.loadAsync(copy)]);
  assert.equal(await a.file('word/styles.xml').async('string'),await b.file('word/styles.xml').async('string'));
  const compared=await compareDocx(source,copy);assert.ok(compared.after.headers.some(h=>h.changed)&&compared.after.footers.some(f=>f.changed));
  assert.ok(compared.after.blocks.every(block=>!String(block.id??'').includes(':')),'header items are not body blocks');
});
