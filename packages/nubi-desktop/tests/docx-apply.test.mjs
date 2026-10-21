import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDocxOperations,createDocxWriter,verifyDocxCopy} from '../runtime/docx-apply.mjs';
import {docxSnapshot,extractFormMap} from '../runtime/docx-snapshot.mjs';
import {applyFill,createLedger,formChecks,userSources} from '../generated/office-forms.mjs';
import {docxFromBlocks,FORMS} from './helpers-docx-fixture.mjs';

// Document forms plan Task D: writes touch only the element they address, formats stay, every other zip entry is
// byte-identical, and the same fill sheet applied again writes nothing.
const met=receipt=>receipt.checks.length>0&&receipt.checks.every(check=>check.status==='met');
const paragraphXml=(snapshot,id)=>{const range=snapshot.locations.get(id);return snapshot.documentXml.slice(range.start,range.end);};

test('a cell is filled in place: its first paragraph keeps its properties, nothing else in the document or the zip changes',async()=>{
  const source=await docxFromBlocks(FORMS.gianmun);
  const {buffer,applied}=await applyDocxOperations(source,[{type:'fill_cell',targetId:'t1/r1/c2',text:'영업팀-2026-001'}]);
  assert.ok(met(applied[0].receipt),JSON.stringify(applied[0].receipt));
  const after=await docxSnapshot(buffer);
  assert.equal(after.items.find(item=>item.id==='t1/r1/c2').text,'영업팀-2026-001');
  assert.equal(after.items.find(item=>item.id==='t1/r1/c1').text,'문서번호');
  const check=await verifyDocxCopy(source,buffer,{targets:['t1/r1/c2']});
  assert.equal(check.sameEntries,true);assert.deepEqual(check.changedEntries,['word/document.xml']);
  assert.deepEqual(check.changedParagraphs,[{id:'t1/r1/c2',kind:'changed',before:'○○팀-2026-000',after:'영업팀-2026-001'}]);assert.deepEqual(check.violations,[]);
  const wrong=await verifyDocxCopy(source,buffer,{targets:['t1/r1/c4']});assert.equal(wrong.violations.length,1);
});

test('a guide inside a two-format paragraph is replaced in its own run, and a whole paragraph keeps its style',async()=>{
  const source=await docxFromBlocks(FORMS.report),before=await docxSnapshot(source);
  const marked=before.items.find(item=>item.text==='○ (보고 목적을 기재)');
  const {buffer,applied}=await applyDocxOperations(source,[{type:'replace_guide',targetId:marked.id,guide:'(보고 목적을 기재)',text:'시장 조사 결과 보고'}]);
  assert.ok(met(applied[0].receipt),JSON.stringify(applied[0].receipt));
  const after=await docxSnapshot(buffer),item=after.items.find(x=>x.id===marked.id);
  assert.deepEqual([item.text,item.runs,item.textRuns],['○ 시장 조사 결과 보고',2,[{start:0,length:2},{start:2,length:11}]]);
  const xml=paragraphXml(after,marked.id);
  assert.match(xml,/<w:r><w:t xml:space="preserve">○ <\/w:t><\/w:r><w:r><w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">시장 조사 결과 보고<\/w:t><\/w:r>/,'the mark keeps its plain run and the value takes the bold run of the guide');
  const plain=before.items.find(item=>item.text==='(향후 계획을 기재)');
  const whole=await applyDocxOperations(source,[{type:'replace_text',targetId:plain.id,text:'내년 상반기 확대'}]);
  const written=(await docxSnapshot(whole.buffer)).items.find(x=>x.id===plain.id);
  assert.deepEqual([written.text,written.style,written.runs],['내년 상반기 확대','본문',1]);assert.ok(met(whole.applied[0].receipt));
  await assert.rejects(applyDocxOperations(source,[{type:'replace_guide',targetId:marked.id,guide:'없는 안내',text:'x'}]),/unsupported_target/);
});

test('paragraphs are inserted like their sample and removed, rows are added empty with their cell properties, and a control is filled',async()=>{
  const source=await docxFromBlocks(FORMS.gianmun),before=await docxSnapshot(source);
  const guide=before.items.find(item=>item.text==='(추진 배경과 목적을 기재)');
  const writer=await createDocxWriter(source);
  const inserted=await writer.apply({type:'insert_paragraphs',after:guide.id,like:guide.id,paragraphs:[{text:'둘째 문단'},{text:'셋째 문단'}]});
  assert.ok(met(inserted),JSON.stringify(inserted));assert.deepEqual(inserted.inserted,['p-16','p-17']);
  let items=(await writer.read()).items;
  assert.deepEqual(items.filter(item=>['p-15','p-16','p-17','p-18'].includes(item.id)).map(item=>[item.id,item.text,item.style]),[['p-15','(추진 배경과 목적을 기재)','본문'],['p-16','둘째 문단','본문'],['p-17','셋째 문단','본문'],['p-18','2. 추진 내용','heading 1']]);
  const removed=await writer.apply({type:'remove_paragraph',targetId:'p-16'});assert.ok(met(removed));
  items=(await writer.read()).items;assert.equal(items.find(item=>item.id==='p-16').text,'셋째 문단');
  await assert.rejects(writer.apply({type:'remove_paragraph',targetId:items.at(-1).id}),/unsupported_target/,'the last paragraph mark stays');
  const trip=await docxFromBlocks(FORMS.trip),rows=await applyDocxOperations(trip,[{type:'add_rows',targetId:'t2',count:2}]);
  assert.ok(met(rows.applied[0].receipt),JSON.stringify(rows.applied[0].receipt));assert.equal(rows.applied[0].receipt.targetId,'t2/r5/c1');
  const table=(await docxSnapshot(rows.buffer)).items.filter(item=>item.kind==='cell'&&item.table===2);
  assert.equal(Math.max(...table.map(cell=>cell.row)),6);assert.ok(table.filter(cell=>cell.row>4).every(cell=>cell.text===''&&cell.width>0&&cell.span===1));
  const control=await docxFromBlocks([{p:{text:'신청서',style:'Title'}},{control:{tag:'dept',title:'부서명',type:'text',placeholder:true,text:'부서를 입력하세요'}}]);
  const filled=await applyDocxOperations(control,[{type:'fill_field',targetId:'f-1',text:'영업팀'}]);
  const field=(await docxSnapshot(filled.buffer)).items.find(item=>item.kind==='field');
  assert.deepEqual([field.text,field.showingPlaceholder,met(filled.applied[0].receipt)],['영업팀',false,true]);
  await assert.rejects(applyDocxOperations(source,[{type:'fill_cell',targetId:'t9/r1/c1',text:'x'}]),/unsupported_target/);
  await assert.rejects(applyDocxOperations(source,[{type:'rename',targetId:'p-1'}]),/unsupported_operation/);
});

test('the Office fill writes a whole sheet into the copy, applies nothing the second time, and the checks pass',async()=>{
  const source=await docxFromBlocks(FORMS.trip),{map,items:original}=await extractFormMap(source);
  const request='김민수 영업팀 부산 거래처 방문 2026. 10. 21. ~ 2026. 10. 22. 일정 10. 21. 10:00 거래처 방문, 10. 22. 09:00 보고. 목적은 거래처 방문. 결과는 계약 협의와 후속 보고.';
  const sheet={cells:[{slot:'s1',value:'김민수',source:'request',quote:'김민수'},{slot:'s2',value:'영업팀',source:'request',quote:'영업팀'},{slot:'s3',value:'부산',source:'request',quote:'부산'},{slot:'s4',value:'2026. 10. 21. ~ 2026. 10. 22.',source:'request',quote:'2026. 10. 21. ~ 2026. 10. 22.'}],
    rows:[{slot:'s5',rows:[['10. 21.','10:00','거래처 방문'],['10. 22.','09:00','보고']],source:'request',quote:'10. 21. 10:00 거래처 방문, 10. 22. 09:00 보고'}],missing:[],
    sections:[{section:'sec-1',paragraphs:[{text:'거래처 방문',list:false}]},{section:'sec-3',paragraphs:[{text:'계약 협의',list:false},{text:'후속 보고',list:false}]}]};
  const ledger=createLedger(original,map),writer=await createDocxWriter(source);
  const run=await applyFill({map,sheet,read:writer.read,apply:writer.apply,ledger});
  assert.equal(run.done,true,JSON.stringify(run.failed??null));
  assert.deepEqual(run.operations.map(o=>o.operation.type),['fill_cell','fill_cell','fill_cell','fill_cell','fill_cell','fill_cell','fill_cell','fill_cell','fill_cell','fill_cell','replace_text','replace_text','insert_paragraphs']);
  const filled=(await writer.read()).items;
  const checks=formChecks({map,original,filled,sheet,sources:userSources({request}),ledger});
  assert.equal(checks.summary,'칸 4/4, 목차 2/2, 남은 안내 문구 0, 서식 유지, 근거 확인',JSON.stringify(checks.checks.filter(c=>!c.met)));
  const again=await applyFill({map,sheet,read:writer.read,apply:writer.apply,ledger});
  assert.deepEqual([again.done,again.operations.length],[true,0],'the same sheet writes nothing the second time');
  const copy=await writer.bytes(),verdict=await verifyDocxCopy(source,copy);
  assert.equal(verdict.sameEntries,true);assert.ok(verdict.changedParagraphs.length>=12);
  const after=await docxSnapshot(copy);
  assert.equal(after.items.find(item=>item.id==='t2/r3/c3').text,'보고');
  assert.deepEqual(after.items.filter(item=>item.kind==='paragraph'&&['계약 협의','후속 보고'].includes(item.text)).map(item=>item.style),['본문','본문']);
});

test('a paragraph added to a section does not make the paragraphs after it look changed (forms baseline 1차, trip)',async()=>{
  const source=await docxFromBlocks(FORMS.trip),before=await docxSnapshot(source);
  const last=before.items.filter(item=>item.kind==='paragraph'&&item.text==='(출장 결과와 후속 조치를 기재)')[0];
  const {buffer}=await applyDocxOperations(source,[{type:'replace_text',targetId:last.id,text:'이상 없음'},{type:'insert_paragraphs',after:last.id,like:last.id,paragraphs:[{text:'다음 점검은 12월'}]}]);
  const check=await verifyDocxCopy(source,buffer,{targets:[last.id]});
  assert.deepEqual(check.changedParagraphs.map(c=>[c.kind,c.id,c.beforeId??null]),[['changed',last.id,last.id],['inserted','p-'+(Number(last.id.slice(2))+1),null]]);
  assert.deepEqual(check.violations.map(v=>v.kind),['inserted'],'an insertion the targets do not list is still reported');
  const allowed=await verifyDocxCopy(source,buffer,{targets:[last.id,'p-'+(Number(last.id.slice(2))+1)]});assert.deepEqual(allowed.violations,[]);
});
