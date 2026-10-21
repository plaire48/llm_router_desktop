// Legacy form fields (document forms Task J4, 2026-10-21): FormFields of type text input, check box and drop-down, as
// Word 97-2003 forms and many protected templates still use them in Word 2016. Each is a field slot of its own type.
import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDocxOperations,createDocxWriter,verifyDocxCopy} from '../runtime/docx-apply.mjs';
import {docxSnapshot,extractFormMap} from '../runtime/docx-snapshot.mjs';
import {applyFill,createLedger} from '../generated/office-forms.mjs';
import {docxFromBlocks} from './helpers-docx-fixture.mjs';

const label=text=>({text,bold:true});
const form=()=>docxFromBlocks([{p:{text:'출장 신청서',style:'Title'}},
  {p:{runs:[{text:'성명: '},{legacy:{type:'text',name:'Text1',maxLength:10}}]}},
  {table:{rows:[[label('숙박 필요'),{runs:[{legacy:{type:'checkbox',name:'Check1'}}]}],[label('교통편'),{runs:[{legacy:{type:'dropdown',name:'Drop1',items:['기차','버스','항공']}}]}]]}}]);
const legacy=async bytes=>(await docxSnapshot(bytes)).items.filter(item=>item.legacy);

test('the snapshot reads each legacy form field with its type, state and place',async()=>{
  const [text,check,drop]=await legacy(await form());
  assert.deepEqual([text.id,text.controlType,text.name,text.maxLength,text.paragraph,text.writable],['ff-1','text','Text1',10,'p-2',true]);
  assert.deepEqual([check.id,check.controlType,check.checked,check.cell],['ff-2','checkbox',false,'t1/r1/c2']);
  assert.deepEqual([drop.id,drop.controlType,drop.options.map(o=>o.text),drop.text],['ff-3','dropdown',['기차','버스','항공'],'기차']);
});

test('legacy fields are filled by type and the rest of the field stays a form field',async()=>{
  const source=await form(),{map,items}=await extractFormMap(source);
  assert.deepEqual(map.slots.map(slot=>[slot.label,slot.valueType,slot.target]),[['성명','text','ff-1'],['숙박 필요','boolean','ff-2'],['교통편','choice','ff-3']]);
  const sheet={cells:[{slot:map.slots[0].id,value:'김민수'},{slot:map.slots[1].id,value:'예'},{slot:map.slots[2].id,value:'항공'}],rows:[],sections:[]};
  const writer=await createDocxWriter(source),run=await applyFill({map,sheet,read:writer.read,apply:writer.apply,ledger:createLedger(items,map)});
  assert.ok(run.done,JSON.stringify(run));assert.equal(run.operations.length,3,JSON.stringify(run));
  const copy=await writer.bytes(),[text,check,drop]=await legacy(copy);
  assert.deepEqual([text.text,check.checked,drop.text],['김민수',true,'항공']);
  assert.match(writer.documentXml,/FORMTEXT[\s\S]*fldCharType="separate"[\s\S]*김민수[\s\S]*fldCharType="end"/);assert.match(writer.documentXml,/<w:result w:val="2"\/>/);
  assert.deepEqual((await verifyDocxCopy(source,copy,{targets:map.slots.map(slot=>slot.target)})).violations,[]);
  await assert.rejects(applyDocxOperations(source,[{type:'fill_field',targetId:'ff-1',text:'열한 글자를 넘는 이름입니다'}]),/invalid_plan/,'maxLength holds');
  await assert.rejects(applyDocxOperations(source,[{type:'fill_field',targetId:'ff-3',text:'자가용'}]),/invalid_plan/);
});
