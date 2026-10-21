// Restrict Editing and Track Changes (document forms Task J7, 2026-10-21), as Word 2016 applies them to a person typing:
// a form protected for filling in takes values only in its form fields, a read-only one takes none, and with Track
// Changes on every write is recorded as a tracked insertion and deletion by 누비.
import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDocxOperations,createDocxWriter} from '../runtime/docx-apply.mjs';
import {docxSnapshot,extractFormMap} from '../runtime/docx-snapshot.mjs';
import {applyFill,createLedger} from '../generated/office-forms.mjs';
import {docxFromBlocks} from './helpers-docx-fixture.mjs';

const label=text=>({text,bold:true});
const BLOCKS=[{p:{text:'신청서',style:'Title'}},{table:{rows:[[label('성명'),''],[label('동의'),{runs:[{control:{type:'checkbox',title:'동의'}}]}]]}},{p:{text:'시행일: 20XX. XX. XX.'}}];

test('a form protected for filling in maps and writes only its form fields',async()=>{
  const source=await docxFromBlocks(BLOCKS,{protection:'forms'}),snapshot=await docxSnapshot(source);
  assert.deepEqual(snapshot.protection,{edit:'forms',enforced:true});
  const {map,items}=await extractFormMap(source);
  assert.deepEqual(map.slots.map(slot=>[slot.kind,slot.label]),[['field','동의']]);
  assert.ok(map.unsure.some(entry=>/양식 보호/.test(entry.reason)));
  const writer=await createDocxWriter(source),run=await applyFill({map,sheet:{cells:[{slot:map.slots[0].id,value:'예'}],rows:[],sections:[]},read:writer.read,apply:writer.apply,ledger:createLedger(items,map)});
  assert.ok(run.done,JSON.stringify(run));assert.equal(run.operations.length,1,JSON.stringify(run));
  await assert.rejects(applyDocxOperations(source,[{type:'fill_cell',targetId:'t1/r1/c2',text:'김민수'}]),/document_not_writable/);
});

test('a read-only document takes no write and its map says why',async()=>{
  const source=await docxFromBlocks(BLOCKS,{protection:'readOnly'}),{map}=await extractFormMap(source);
  assert.deepEqual(map.slots,[]);assert.ok(map.unsure.some(entry=>/읽기 전용/.test(entry.reason)));
  await assert.rejects(applyDocxOperations(source,[{type:'fill_field',targetId:'f-1',checked:true}]),/document_not_writable/);
});

test('with Track Changes on, writes are tracked insertions and deletions by 누비 and read as the new text',async()=>{
  const source=await docxFromBlocks(BLOCKS,{trackRevisions:true});
  const done=await applyDocxOperations(source,[{type:'fill_cell',targetId:'t1/r1/c2',text:'김민수'},{type:'replace_guide',targetId:'p-6',guide:'20XX. XX. XX.',text:'2026. 11. 1.'},{type:'fill_field',targetId:'f-1',checked:true}]);
  assert.ok(done.applied.every(entry=>entry.receipt.checks.every(check=>check.status==='met')),JSON.stringify(done.applied.map(e=>e.receipt)));
  const xml=done.documentXml;
  assert.match(xml,/<w:ins w:id="\d+" w:author="누비" w:date="[^"]+"><w:r>(?:<w:rPr>.*?<\/w:rPr>)?<w:t xml:space="preserve">김민수<\/w:t><\/w:r><\/w:ins>/);
  assert.match(xml,/<w:del w:id="\d+" w:author="누비" w:date="[^"]+"><w:r>(?:<w:rPr>.*?<\/w:rPr>)?<w:delText xml:space="preserve">20XX\. XX\. XX\.<\/w:delText><\/w:r><\/w:del>/);
  const ids=[...xml.matchAll(/<w:(?:ins|del) w:id="(\d+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,'revision ids are unique');
  const items=(await docxSnapshot(done.buffer)).items;
  assert.equal(items.find(item=>item.id==='t1/r1/c2').text,'김민수');assert.equal(items.find(item=>item.id==='p-6').text,'시행일: 2026. 11. 1.');
  assert.equal(items.find(item=>item.kind==='field').checked,true);
});

test('a read-only form is stored but not offered for filling, with the reason; a typed slot keeps its choices',async()=>{
  const {formPreview,formQuestionPlan}=await import('../runtime/document-forms.mjs');
  const readOnly=await extractFormMap(await docxFromBlocks(BLOCKS,{protection:'readOnly'}));
  const preview=formPreview(readOnly.map,{name:'신청서',source:'신청서.docx',registeredAt:'2026-10-21T00:00:00Z'});
  assert.equal(preview.fillable,false);assert.match(preview.notFillable,/읽기 전용/);
  const open=await extractFormMap(await docxFromBlocks([{p:{text:'신청서',style:'Title'}},{table:{rows:[[label('구분'),{runs:[{control:{type:'dropdown',items:['신규','변경']}}]}]]}}]));
  const plan=formQuestionPlan(open.map);
  assert.deepEqual(plan.questions[0].fields[0].options,['신규','변경']);assert.equal(plan.questions[0].fields[0].kind,'choice');
});
