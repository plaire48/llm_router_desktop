import test from 'node:test';
import assert from 'node:assert/strict';
import {docxSnapshot,extractFormMap,parseXml} from '../runtime/docx-snapshot.mjs';
import {mapSummary} from '../generated/office-forms.mjs';
import {docxFromBlocks,FORMS} from './helpers-docx-fixture.mjs';

// Document forms plan Task A: a docx read without Word yields the items the Word host reports, so the Office form map
// built from a file equals the one built from the simulated host (word-form-map.test.mjs expectations).
const slotRows=map=>map.slots.map(slot=>[slot.id,slot.kind,slot.target,slot.label,slot.valueType]);
const mapOf=async blocks=>(await extractFormMap(await docxFromBlocks(blocks),{name:'양식.docx'})).map;

test('a 기안문 docx maps to six labelled cells, three sections over guide paragraphs and a note kept',async()=>{
  const map=await mapOf(FORMS.gianmun);
  assert.deepEqual(slotRows(map),[['s1','cell','t1/r1/c2','문서번호','text'],['s2','cell','t1/r1/c4','기안일자','date'],['s3','cell','t1/r2/c2','기안자','text'],
    ['s4','cell','t1/r2/c4','결재','text'],['s5','cell','t1/r3/c2','수신','text'],['s6','cell','t1/r4/c2','제목','text']]);
  assert.deepEqual(map.slots[0].guides,['○○','000']);
  assert.deepEqual(map.sections.map(s=>[s.id,s.title,s.needsText,s.style,s.guideParagraphs.length]),[['sec-1','1. 개요',true,'본문',1],['sec-2','2. 추진 내용',true,'본문',1],['sec-3','3. 행정 사항',true,'본문',1]]);
  assert.deepEqual(map.notes.map(note=>[note.action,note.section]),[['keep','sec-3']]);
  assert.equal(mapSummary(map),'칸 6개, 목차 3개, 작성 요령 1개');assert.deepEqual(map.unsure,[]);
  assert.equal(map.host,'word');assert.match(map.source.fingerprint,/^sha256:/);
});

test('a schedule table under a header row is a rows slot of its section, amounts and periods are typed, list styles carry their mark',async()=>{
  const trip=await mapOf(FORMS.trip);
  assert.deepEqual(slotRows(trip),[['s1','cell','t1/r1/c2','출장자','text'],['s2','cell','t1/r1/c4','소속','text'],['s3','cell','t1/r2/c2','출장지','text'],['s4','cell','t1/r3/c2','출장 기간','period'],['s5','rows','t2','2. 주요 일정',undefined]]);
  const rows=trip.slots[4];assert.deepEqual([rows.header,rows.columns,rows.emptyRows,rows.section,rows.required],[['일자','시간','내용'],3,3,'sec-2',false]);
  assert.deepEqual(trip.sections.map(s=>[s.title,s.needsText,s.tables??[]]),[['1. 출장 목적',true,[]],['2. 주요 일정',false,[2]],['3. 결과 및 향후 계획',true,[]]]);
  assert.equal(mapSummary(trip),'칸 4개, 표 행 1개, 목차 2개');
  const pumui=await mapOf(FORMS.pumui);
  assert.deepEqual(slotRows(pumui).map(row=>row.slice(3)),[['품의 번호','text'],['품의 일자','date'],['품의 부서','text'],['품의자','text'],['건명','text'],['금액','amount'],['내용','text']]);
  assert.deepEqual([pumui.sections,pumui.slots[5].guides],[[],['○○○','0,000,000']]);
  const weekly=await mapOf(FORMS.weekly);
  assert.deepEqual(slotRows(weekly).map(row=>row.slice(1,4)),[['cell','t1/r1/c2','보고자'],['cell','t1/r1/c4','보고 기간'],['rows','t2','1. 금주 실적'],['rows','t3','2. 차주 계획']]);
  assert.equal(weekly.slots[1].valueType,'period');
  const list=await mapOf(FORMS.gianmunList);
  assert.deepEqual(list.sections.map(s=>[s.style,s.listString]),[['개조식 1','가.'],['개조식 1','가.'],['개조식 1','가.']]);
});

test('a guide inside a sentence is a slot, a two-format guide paragraph leaves room only, and a label inside a cell is kept',async()=>{
  const map=await mapOf(FORMS.report);
  assert.deepEqual(map.slots.filter(slot=>slot.kind==='guide').map(slot=>[slot.label,slot.guide,slot.valueType]),[['시행 예정일','20XX. XX. XX.','date']]);
  const overview=map.sections.find(s=>s.title==='1. 보고 개요');
  assert.equal(overview.guideParagraphs.length,1);assert.equal(overview.room,1,'a mark plus a bold guide is two runs: the paragraph is not editable whole');
  assert.equal(map.slots.find(slot=>slot.target==='t1/r3/c2').inner,'담당');
  assert.deepEqual(map.slots.find(slot=>slot.target==='t1/r1/c4').guides,['20XX년 XX월 XX일']);
});

test('items keep ids, styles, list strings, run counts and the XML range of each element',async()=>{
  const bytes=await docxFromBlocks(FORMS.gianmunList),snapshot=await docxSnapshot(bytes,{name:'기안문.docx'});
  const paragraphs=snapshot.items.filter(item=>item.kind==='paragraph'),cells=snapshot.items.filter(item=>item.kind==='cell');
  // Word numbers the 12 cell paragraphs of the header table too, so the first heading is p-14 as the Word host says.
  assert.deepEqual(paragraphs.slice(0,3).map(p=>[p.id,p.text,p.style,p.outlineLevel,p.listString]),[['p-1','기 안 문','Title',10,null],['p-14','1. 개요','heading 1',1,null],['p-15','(추진 배경을 기재)','개조식 1',10,'가.']]);
  assert.equal(paragraphs.at(-1).text,'','the trailing empty paragraph is an item too');
  assert.deepEqual(cells.slice(0,4).map(c=>[c.id,c.text,c.bold,c.span,c.width>0]),[['t1/r1/c1','문서번호',true,1,true],['t1/r1/c2','○○팀-2026-000',false,1,true],['t1/r1/c3','기안일자',true,1,true],['t1/r1/c4','20XX. XX. XX.',false,1,true]]);
  assert.deepEqual(cells.find(c=>c.id==='t1/r3/c2').span,3);
  assert.ok(paragraphs.every(p=>p.editable&&p.writable&&p.runs<=1&&p.fields===0&&p.controls===0));
  const range=snapshot.locations.get('p-14'),xml=snapshot.documentXml.slice(range.start,range.end);
  assert.ok(xml.startsWith('<w:p>')&&xml.endsWith('</w:p>')&&xml.includes('1. 개요'));
  const cell=snapshot.locations.get('t1/r1/c2');assert.ok(snapshot.documentXml.slice(cell.start,cell.end).startsWith('<w:tc>'));
  assert.ok(cell.paragraph.start>cell.start&&cell.paragraph.end<=cell.end);
  assert.ok(snapshot.styles.some(style=>style.name==='heading 1'&&style.outlineLevel===1));
  const report=await docxSnapshot(await docxFromBlocks(FORMS.report));
  const twoRuns=report.items.find(item=>item.text==='○ (보고 목적을 기재)');
  assert.deepEqual([twoRuns.runs,twoRuns.editable,twoRuns.writable,twoRuns.textRuns],[2,false,true,[{start:0,length:2},{start:2,length:11}]]);
});

test('a content control is a field item with its tag, title, type and placeholder state, and a broken file is refused',async()=>{
  const bytes=await docxFromBlocks([{p:{text:'신청서',style:'Title'}},{control:{tag:'dept',title:'부서명',type:'text',placeholder:true,text:'부서를 입력하세요'}},{p:{text:'끝.',style:'본문'}}]);
  const {map,items}=await extractFormMap(bytes);
  const field=items.find(item=>item.kind==='field');
  assert.deepEqual([field.id,field.tag,field.title,field.controlType,field.showingPlaceholder,field.text,field.writable],['f-1','dept','부서명','text',true,'부서를 입력하세요',false]);
  assert.deepEqual(map.slots.map(slot=>[slot.kind,slot.target,slot.label,slot.required]),[['field','f-1','부서명',true]]);
  await assert.rejects(docxSnapshot(Buffer.from('not a zip')),/docx_invalid/);
  await assert.rejects(docxSnapshot(Buffer.alloc(0)),/docx_invalid/);
  assert.throws(()=>parseXml('<w:p><w:r></w:p>'),/docx_xml_invalid/);
});
