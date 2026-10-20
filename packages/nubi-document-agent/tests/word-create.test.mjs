import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as api from '../dist/index.js';

const example={paperSize:'A4',title:'주간 보고',sections:[{heading:'결론',paragraphs:[[{text:'배포를 보류합니다.',bold:true},{text:' 검토 후 다시 결정합니다.',bold:false}]],table:null},{heading:'현황',paragraphs:[],table:{headers:['종류','작성','검토'],rows:[['Word','3','2'],['합계','3','2']]}}]};
async function author(){
  const entry=new URL('../dist/word.js',import.meta.url);
  const available=await readFile(entry).then(()=>true,()=>false);
  assert.equal(available,true,'The GenOffice Word generation adapter is missing');
  return import(entry.href);
}
test('the GenOffice adapter returns a real Word package with editable tables and mixed bold runs',async()=>{
  const {createWordDocument,inspectGeneratedWord}=await author();
  const result=await createWordDocument(example,new AbortController().signal);
  assert.ok(result.bytes instanceof Uint8Array);assert.equal(result.bytes[0],0x50);assert.equal(result.bytes[1],0x4b);
  assert.equal(result.savedToOffice,false);assert.equal(result.engine,'genoffice');
  const observed=await inspectGeneratedWord(result.bytes);
  assert.equal(observed.title,'주간 보고');assert.deepEqual(observed.tables[0].rows,[['종류','작성','검토'],['Word','3','2'],['합계','3','2']]);
  assert.ok(observed.paragraphs.some(p=>p.runs.some(r=>r.text==='배포를 보류합니다.'&&r.bold)));
  assert.equal(observed.page.widthTwips,11906);assert.equal(observed.page.heightTwips,16838);
  assert.equal(observed.hasExternalRelationships,false);assert.equal(observed.hasMacros,false);
});
test('generated table grids fit the actual A4 content area and keep header rows repeatable',async()=>{
  const {createWordDocument,inspectGeneratedWord}=await author();const result=await createWordDocument(example,new AbortController().signal);
  const inspected=await inspectGeneratedWord(result.bytes),table=inspected.tables[0];
  assert.ok(table.columnWidthsTwips.reduce((a,b)=>a+b,0)<=9026);assert.equal(table.repeatingHeader,true);
  assert.ok(table.rowsDontSplit);assert.ok(inspected.paragraphs.filter(p=>['Title','Heading1'].includes(p.styleId)).every(p=>p.runs.every(r=>r.color==='000000')));
});
test('invalid or executable draft fields fail before a Word file can be produced',async()=>{
  const {createWordDocument}=await author();
  for(const draft of [{...example,title:'bad\u0000title'},{...example,rawXml:'<bad/>'},{...example,sections:[{...example.sections[1],table:{headers:['a','b'],rows:[['only one']]}}]}]){
    await assert.rejects(createWordDocument(draft,new AbortController().signal),{code:'word_draft_invalid'});
  }
});
test('XML-looking text is preserved as literal text and cannot create fields or links',async()=>{
  const {createWordDocument,inspectGeneratedWord}=await author();const draft=structuredClone(example);draft.sections[0].paragraphs[0]=[{text:'<w:fldSimple w:instr="DDEAUTO"> & <test>',bold:false}];
  const result=await createWordDocument(draft,new AbortController().signal),observed=await inspectGeneratedWord(result.bytes);
  assert.ok(observed.paragraphs.some(p=>p.runs.some(r=>r.text==='<w:fldSimple w:instr="DDEAUTO"> & <test>')));
  assert.equal(observed.fieldCount,0);assert.equal(observed.hasExternalRelationships,false);
});
test('cancellation stops creation and inspection rejects non-Word and encrypted inputs',async()=>{
  const {createWordDocument,inspectGeneratedWord}=await author();const controller=new AbortController();controller.abort();
  await assert.rejects(createWordDocument(example,controller.signal),{code:'operation_cancelled'});
  await assert.rejects(inspectGeneratedWord(new Uint8Array([0xd0,0xcf,0x11,0xe0])),{code:'generated_word_invalid'});
});
