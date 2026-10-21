import test from 'node:test';
import assert from 'node:assert/strict';
import {compareDocx} from '../runtime/docx-compare.mjs';
import {applyDocxOperations} from '../runtime/docx-apply.mjs';
import {docxFromBlocks,FORMS} from './helpers-docx-fixture.mjs';

// §8 답 33: the written copy is compared with the source in the block shape the existing Office change viewer
// renders, with before texts under changed items and no guessed values.
test('filled cells, rewritten and inserted paragraphs are flagged with their old text, unchanged ones keep their ids',async()=>{
  const source=await docxFromBlocks(FORMS.gianmun);
  const {buffer}=await applyDocxOperations(source,[{type:'fill_cell',targetId:'t1/r1/c2',text:'영업팀-2026-001'},{type:'fill_cell',targetId:'t1/r2/c2',text:'김민수'},
    {type:'replace_text',targetId:'p-15',text:'거래처 방문 결과를 보고합니다.'},{type:'insert_paragraphs',after:'p-15',like:'p-15',paragraphs:[{text:'둘째 문단'}]}]);
  const compare=await compareDocx(source,buffer);
  assert.equal(compare.app,'word');assert.deepEqual(compare.counts,{changedParagraphs:1,insertedParagraphs:1,removedParagraphs:0,changedCells:2});
  const table=compare.after.blocks.find(block=>block.kind==='table');
  assert.equal(table.changed,true);assert.deepEqual(table.cells.filter(cell=>cell.changed).map(cell=>[cell.row,cell.col,cell.before,cell.text]),[[1,2,'○○팀-2026-000','영업팀-2026-001'],[2,2,'','김민수']]);
  const oldTable=compare.before.blocks.find(block=>block.id===table.id);assert.equal(oldTable.cells.find(cell=>cell.row===1&&cell.col===2).text,'○○팀-2026-000');
  const rewritten=compare.after.blocks.find(block=>block.id==='p-15');
  assert.deepEqual([rewritten.changed,rewritten.before,rewritten.text],[true,'(추진 배경과 목적을 기재)','거래처 방문 결과를 보고합니다.']);
  const inserted=compare.after.blocks.find(block=>block.id==='inserted-p-16');assert.deepEqual([inserted.changed,inserted.text,inserted.before],[true,'둘째 문단',undefined]);
  const heading=compare.after.blocks.find(block=>block.text==='2. 추진 내용');
  assert.deepEqual([heading.id,heading.changed,heading.target],['p-16',false,'p-17'],'a paragraph after the insertion keeps its before id and is not marked changed');
  assert.ok(compare.after.blocks.filter(block=>block.kind==='paragraph'&&!block.changed).length>=6);
  assert.deepEqual(compare.changes.map(change=>[change.kind,change.change,change.title]).sort(),[['cell','changed','표 1 (1, 2)'],['cell','changed','표 1 (2, 2)'],['paragraph','changed','문단 15'],['paragraph','inserted','문단 16 (새 문단)']].sort());
  assert.deepEqual(compare.after.page,{width:595,height:842,TopMargin:72,BottomMargin:72,LeftMargin:72,RightMargin:72,changed:true});
  const same=await compareDocx(source,source);assert.deepEqual([same.changes,same.after.page.changed],[[],false]);
});
