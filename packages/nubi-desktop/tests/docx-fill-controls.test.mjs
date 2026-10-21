// Word fill of typed content controls (document forms Task J1, 2026-10-21): a checkbox is checked, a dropdown takes one
// of its items, a date takes its date and the display its format asks for. Nothing is written as free text into them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDocxOperations,createDocxWriter} from '../runtime/docx-apply.mjs';
import {docxSnapshot,extractFormMap} from '../runtime/docx-snapshot.mjs';
import {applyFill,createLedger,nextOperation} from '../generated/office-forms.mjs';
import {docxFromBlocks} from './helpers-docx-fixture.mjs';

const met=receipt=>receipt.checks.every(check=>check.status==='met');
const FORM=[{p:{text:'신청서',style:'Title'}},
  {p:{runs:[{text:'개인정보 수집에 동의합니다 '},{control:{type:'checkbox',title:'개인정보 동의',tag:'agree'}}]}},
  {p:{runs:[{text:'구분: '},{control:{type:'dropdown',title:'구분',items:['신규','변경','해지'],placeholder:true,text:'항목을 선택하세요'}}]}},
  {p:{runs:[{text:'신청일: '},{control:{type:'date',title:'신청일',format:'yyyy. M. d.',placeholder:true,text:'날짜를 선택하세요'}}]}},
  {p:{runs:[{text:'부서: '},{control:{type:'combo',title:'부서',items:['영업팀','인사팀']}}]}}];
const fields=async bytes=>(await docxSnapshot(bytes)).items.filter(item=>item.kind==='field');

test('the snapshot reads each control type with its state, items and date format',async()=>{
  const [check,list,date,combo]=await fields(await docxFromBlocks(FORM));
  assert.deepEqual([check.controlType,check.checked,check.writable],['checkbox',false,true]);
  assert.deepEqual([list.controlType,list.options.map(o=>o.text),list.showingPlaceholder],['dropdown',['신규','변경','해지'],true]);
  assert.deepEqual([date.controlType,date.dateFormat,date.date],['date','yyyy. M. d.',null]);
  assert.deepEqual([combo.controlType,combo.options.length],['combo',2]);
});

test('typed writes: checkbox state and symbol, a listed item only, a date with its stored value and display',async()=>{
  const source=await docxFromBlocks(FORM);
  const done=await applyDocxOperations(source,[{type:'fill_field',targetId:'f-1',checked:true},{type:'fill_field',targetId:'f-2',text:'변경'},
    {type:'fill_field',targetId:'f-3',date:'2026-10-21'},{type:'fill_field',targetId:'f-4',text:'총무팀'}]);
  assert.ok(done.applied.every(entry=>met(entry.receipt)),JSON.stringify(done.applied.map(e=>e.receipt)));
  const [check,list,date,combo]=await fields(done.buffer);
  assert.deepEqual([check.checked,check.text],[true,'☒']);
  assert.deepEqual([list.text,list.showingPlaceholder],['변경',false]);
  assert.deepEqual([date.date,date.text,date.showingPlaceholder],['2026-10-21','2026. 10. 21.',false]);
  assert.equal(combo.text,'총무팀','a combo box also takes free text');
  assert.match(done.documentXml,/w14:checked w14:val="1"/);assert.match(done.documentXml,/w:fullDate="2026-10-21T00:00:00Z"/);
  const back=await applyDocxOperations(done.buffer,[{type:'fill_field',targetId:'f-1',checked:false}]);
  assert.deepEqual((await fields(back.buffer)).slice(0,1).map(f=>[f.checked,f.text]),[[false,'☐']]);
  await assert.rejects(applyDocxOperations(source,[{type:'fill_field',targetId:'f-2',text:'보류'}]),/invalid_plan/,'a dropdown takes only its items');
  await assert.rejects(applyDocxOperations(source,[{type:'fill_field',targetId:'f-1',text:'예'}]),/invalid_plan/,'a checkbox is not free text');
  await assert.rejects(applyDocxOperations(source,[{type:'fill_field',targetId:'f-3',date:'2026-02-30'}]),/invalid_plan/);
});

test('the form map types the slots and the fill writes them from the user words',async()=>{
  const source=await docxFromBlocks(FORM),{map,items}=await extractFormMap(source);
  const slots=map.slots.filter(slot=>slot.kind==='field');
  assert.deepEqual(slots.map(slot=>slot.valueType),['boolean','choice','date','text']);
  assert.deepEqual(slots[1].options,['신규','변경','해지']);
  const sheet={cells:[{slot:slots[0].id,value:'동의'},{slot:slots[1].id,value:'변경'},{slot:slots[2].id,value:'2026. 10. 21.'},{slot:slots[3].id,value:'총무팀'}],rows:[],sections:[]};
  const writer=await createDocxWriter(source),ledger=createLedger(items,map);
  const run=await applyFill({map,sheet,read:writer.read,apply:writer.apply,ledger});
  assert.ok(run.done,JSON.stringify(run));assert.equal(run.operations.length,4,JSON.stringify(run));
  const [check,list,date,combo]=await fields(await writer.bytes());
  assert.deepEqual([check.checked,list.text,date.date,combo.text],[true,'변경','2026-10-21','총무팀']);
  // A value the control cannot hold stops with a reason instead of writing text into it.
  const snapshot=await (await createDocxWriter(source)).read();
  const blocked=nextOperation(snapshot,map,{cells:[{slot:slots[1].id,value:'보류'}],rows:[],sections:[]},createLedger(items,map));
  assert.match(blocked.blocked,/신규, 변경, 해지/);
  const unsure=nextOperation(snapshot,map,{cells:[{slot:slots[0].id,value:'글쎄요'}],rows:[],sections:[]},createLedger(items,map));
  assert.match(unsure.blocked,/체크/);
});

test('controls inside table cells are value cells labelled by their row and filled by type',async()=>{
  const label=text=>({text,bold:true});
  const source=await docxFromBlocks([{p:{text:'참가 신청서',style:'Title'}},{table:{rows:[
    [label('성명'),''],
    [label('참석 여부'),{runs:[{control:{type:'checkbox',title:'참석'}}]}],
    [label('신청일'),{runs:[{control:{type:'date',format:'yyyy년 M월 d일',placeholder:true,text:'날짜 선택'}}]}],
    [label('식사'),{runs:[{control:{type:'dropdown',items:['한식','양식']}}]}]]}}]);
  const {map,items}=await extractFormMap(source);
  assert.deepEqual(map.slots.map(slot=>[slot.kind,slot.label,slot.valueType]),[['cell','성명','text'],['field','참석 여부','boolean'],['field','신청일','date'],['field','식사','choice']]);
  const [name,attend,day,meal]=map.slots;
  const sheet={cells:[{slot:name.id,value:'김민수'},{slot:attend.id,value:'참석'},{slot:day.id,value:'2026. 11. 3.'},{slot:meal.id,value:'한식'}],rows:[],sections:[]};
  const writer=await createDocxWriter(source),run=await applyFill({map,sheet,read:writer.read,apply:writer.apply,ledger:createLedger(items,map)});
  assert.ok(run.done,JSON.stringify(run));assert.equal(run.operations.length,4,JSON.stringify(run));
  const after=(await docxSnapshot(await writer.bytes())).items;
  assert.deepEqual(after.filter(item=>item.kind==='field').map(f=>[f.checked??f.date??f.text]),[[true],['2026-11-03'],['한식']]);
  assert.equal(after.find(item=>item.kind==='field'&&item.controlType==='date').text,'2026년 11월 3일');
  assert.equal(after.find(item=>item.id==='t1/r1/c2').text,'김민수');
});

test('a control bound to custom XML is not written, since Word would restore the bound value on open',async()=>{
  const source=await docxFromBlocks([{p:{text:'신청서',style:'Title'}},{control:{type:'text',title:'성명',text:'홍길동'}}]);
  const JSZip=(await import('jszip')).default,zip=await JSZip.loadAsync(source),xml=await zip.file('word/document.xml').async('string');
  zip.file('word/document.xml',xml.replace('<w:text/>','<w:dataBinding w:xpath="/root/name" w:storeItemID="{00000000-0000-0000-0000-000000000001}"/><w:text/>'));
  const bound=await zip.generateAsync({type:'nodebuffer'}),{map,items}=await extractFormMap(bound);
  const field=items.find(item=>item.kind==='field');assert.deepEqual([field.mapped,field.writable],[true,false]);
  assert.equal(map.slots.filter(slot=>slot.kind==='field').length,0);assert.ok(map.unsure.some(entry=>entry.target===field.id));
  await assert.rejects(applyDocxOperations(bound,[{type:'fill_field',targetId:'f-1',text:'김민수'}]),/unsupported_target/);
});
