// Writes never drop what a paragraph holds besides its text (document forms Task J3, 2026-10-21). Measured: a paragraph
// anchoring a text box read as its own text plus the box text twice (DrawingML and VML copies) and was writable, so a
// write rebuilt it from text runs and the text box was gone; an inline picture was lost the same way.
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {applyDocxOperations} from '../runtime/docx-apply.mjs';
import {docxSnapshot} from '../runtime/docx-snapshot.mjs';
import {docxFromBlocks} from './helpers-docx-fixture.mjs';

const PNG=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082','hex');
const documentXml=async bytes=>(await JSZip.loadAsync(bytes)).file('word/document.xml').async('string');

test('a paragraph anchoring a text box reads only its own text and keeps the box when written',async()=>{
  const source=await docxFromBlocks([{p:{text:'제목',style:'Title'}},{p:{runs:[{text:'담당: (성명)'},{textbox:['성명: ○○○']}]}}]);
  const anchor=(await docxSnapshot(source)).items.find(item=>item.id==='p-2');
  assert.deepEqual([anchor.text,anchor.writable],['담당: (성명)',true]);
  const done=await applyDocxOperations(source,[{type:'replace_guide',targetId:'p-2',guide:'(성명)',text:'김민수'}]);
  assert.ok(done.applied[0].receipt.checks.every(c=>c.status==='met'),JSON.stringify(done.applied[0].receipt));
  const xml=await documentXml(done.buffer);
  assert.equal((xml.match(/<w:txbxContent>/g)??[]).length,2,'both copies of the text box stay');assert.match(xml,/담당: 김민수/);
});

test('a paragraph with an inline picture, a link or a footnote mark is not rewritten',async()=>{
  const source=await docxFromBlocks([{p:{text:'제목',style:'Title'}},{image:{name:'sign.png',bytes:PNG}}]);
  const zip=await JSZip.loadAsync(source),xml=await zip.file('word/document.xml').async('string');
  // The picture paragraph gets a guide next to the picture, and a link paragraph and a footnote paragraph follow.
  const withGuide=xml.replace(/(<w:p>)(<w:r><w:drawing>)/,'$1<w:r><w:t xml:space="preserve">서명: (서명)</w:t></w:r>$2')
    .replace('<w:sectPr>','<w:p><w:hyperlink r:id="rIdLink"><w:r><w:t>안내 링크</w:t></w:r></w:hyperlink><w:r><w:t xml:space="preserve"> (내용 기재)</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">근거 (내용 기재)</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p><w:sectPr>');
  zip.file('word/document.xml',withGuide);const bytes=await zip.generateAsync({type:'nodebuffer'});
  const items=(await docxSnapshot(bytes)).items.filter(item=>item.kind==='paragraph');
  const picture=items.find(item=>item.text.startsWith('서명')),link=items.find(item=>item.text.startsWith('안내 링크')),note=items.find(item=>item.text.startsWith('근거'));
  assert.deepEqual([picture.writable,link.writable,note.writable],[false,false,false]);
  for(const target of [picture,link,note])await assert.rejects(applyDocxOperations(bytes,[{type:'replace_text',targetId:target.id,text:'바꿈'}]),/unsupported_target/);
  await assert.rejects(applyDocxOperations(bytes,[{type:'replace_guide',targetId:picture.id,guide:'(서명)',text:'김민수'}]),/unsupported_target/);
});

test('a text box is mapped as 글상자 and a write changes both of its copies',async()=>{
  const {extractFormMap}=await import('../runtime/docx-snapshot.mjs'),{createDocxWriter,verifyDocxCopy}=await import('../runtime/docx-apply.mjs'),{applyFill,createLedger}=await import('../generated/office-forms.mjs');
  const source=await docxFromBlocks([{p:{text:'안내문',style:'Title'}},{p:{runs:[{text:'본문'},{textbox:['성명: ○○○','소속: (소속 기재)']}]}}]);
  const {map,items}=await extractFormMap(source);
  const box=items.filter(item=>item.part==='box1');
  assert.deepEqual(box.map(item=>[item.id,item.text]),[['box1:p-1','성명: ○○○'],['box1:p-2','소속: (소속 기재)']]);
  assert.deepEqual(map.slots.map(slot=>[slot.label,slot.target]),[['글상자 성명','box1:p-1'],['글상자 소속','box1:p-2']]);
  const sheet={cells:[{slot:map.slots[0].id,value:'김민수'},{slot:map.slots[1].id,value:'영업팀'}],rows:[],sections:[]};
  const writer=await createDocxWriter(source),run=await applyFill({map,sheet,read:writer.read,apply:writer.apply,ledger:createLedger(items,map)});
  assert.ok(run.done,JSON.stringify(run));assert.equal(run.operations.length,2,JSON.stringify(run));
  const copy=await writer.bytes(),xml=await documentXml(copy);
  const boxes=[...xml.matchAll(/<w:txbxContent>(.*?)<\/w:txbxContent>/g)].map(m=>m[1]);
  assert.equal(boxes.length,2);assert.equal(boxes[0],boxes[1],'the VML copy matches the DrawingML copy');
  assert.match(boxes[0],/성명: 김민수/);assert.match(boxes[0],/소속: 영업팀/);
  const verify=await verifyDocxCopy(source,copy,{targets:map.slots.map(slot=>slot.target)});assert.deepEqual(verify.violations,[]);
});
