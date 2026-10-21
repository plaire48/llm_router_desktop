// Bookmarks as fill points and repeating sections (document forms Task J6, 2026-10-21). Older templates mark where a
// value goes with an empty bookmark (Bookmarks("성명").Range.Text); Word 2013+ forms repeat table rows as a repeating
// section content control. Measured before this task: rows inside the repeating section were not read at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDocxOperations,createDocxWriter} from '../runtime/docx-apply.mjs';
import {docxSnapshot,extractFormMap} from '../runtime/docx-snapshot.mjs';
import {applyFill,createLedger} from '../generated/office-forms.mjs';
import {docxFromBlocks} from './helpers-docx-fixture.mjs';

const label=text=>({text,bold:true});

test('an empty bookmark in a sentence is a slot named for it and takes its value between its marks',async()=>{
  const source=await docxFromBlocks([{p:{text:'위임장',style:'Title'}},{p:{runs:[{text:'위임인 '},{bookmark:'위임인',bookmarkId:3},{text:' 은(는) 아래 사항을 위임합니다.'}]}},{p:{runs:[{text:'참조 '},{bookmark:'_Ref123',bookmarkId:4}]}}]);
  const {map,items}=await extractFormMap(source);
  const marks=items.filter(item=>item.kind==='bookmark');assert.deepEqual(marks.map(m=>[m.id,m.name,m.paragraph]),[['bm-1','위임인','p-2']]);
  assert.deepEqual(map.slots.map(slot=>[slot.kind,slot.label,slot.target]),[['bookmark','위임인','bm-1']]);
  const writer=await createDocxWriter(source),run=await applyFill({map,sheet:{cells:[{slot:map.slots[0].id,value:'김민수'}],rows:[],sections:[]},read:writer.read,apply:writer.apply,ledger:createLedger(items,map)});
  assert.ok(run.done,JSON.stringify(run));assert.equal(run.operations.length,1,JSON.stringify(run));
  assert.match(writer.documentXml,/<w:bookmarkStart w:id="3" w:name="위임인"\/><w:r><w:t xml:space="preserve">김민수<\/w:t><\/w:r><w:bookmarkEnd w:id="3"\/>/);
  assert.equal((await writer.read()).items.find(item=>item.id==='p-2').text,'위임인 김민수 은(는) 아래 사항을 위임합니다.');
  const again=await applyFill({map,sheet:{cells:[{slot:map.slots[0].id,value:'김민수'}],rows:[],sections:[]},read:writer.read,apply:writer.apply,ledger:createLedger(items,map)});
  assert.equal(again.operations.length,0,'the same value is not written twice');
});

test('rows of a repeating section are read and a new row is a new item of the section',async()=>{
  const source=await docxFromBlocks([{p:{text:'참석자 명단',style:'Title'}},{table:{repeating:true,rows:[[label('성명'),label('소속')],['',''],['','']]}}]);
  const cells=(await docxSnapshot(source)).items.filter(item=>item.kind==='cell');
  assert.equal(Math.max(...cells.map(cell=>cell.row)),3,'rows inside the repeating section are cells of the table');
  const {map,items}=await extractFormMap(source);assert.deepEqual(map.slots.map(slot=>[slot.kind,slot.target]),[['rows','t1']]);
  const sheet={cells:[],rows:[{slot:map.slots[0].id,rows:[['김민수','영업팀'],['이영희','인사팀'],['박철수','총무팀']]}],sections:[]};
  const writer=await createDocxWriter(source),run=await applyFill({map,sheet,read:writer.read,apply:writer.apply,ledger:createLedger(items,map)});
  assert.ok(run.done,JSON.stringify(run));
  const xml=writer.documentXml;
  assert.equal((xml.match(/<w15:repeatingSectionItem\/>/g)??[]).length,3,'the new row is a repeating section item');
  assert.equal((xml.match(/<w:id w:val="902"\/>/g)??[]).length,1,'a copied item does not repeat its control id');
  const after=(await writer.read()).items.filter(item=>item.kind==='cell'&&item.row>1).map(cell=>cell.text);
  assert.deepEqual(after,['김민수','영업팀','이영희','인사팀','박철수','총무팀']);
});
