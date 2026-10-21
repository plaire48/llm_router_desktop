// Filling a Word form from the conversation (document forms Task K, 2026-10-21): no register button and no form card.
// The tool reads the named form itself, takes values from the person's own messages, returns what is missing for one
// chat question, then writes a new copy (the original stays) when the answers come. The model is a fixture.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {docxFromBlocks,FORMS} from './helpers-docx-fixture.mjs';
import {fillDocumentForm,documentFormRelevant,openWithDefaultApp} from '../runtime/document-form-tool.mjs';
import {docxSnapshot} from '../runtime/docx-snapshot.mjs';

const PERIOD='2026. 10. 21. ~ 2026. 10. 22.';
function fixtureModel(){
  return {status:()=>({connected:true,model:'fixture'}),dispose(){},async complete(messages){
    const system=messages[0].content,payload=JSON.parse(messages[1].content);
    if(system.startsWith('NUBI_WORD_FORM_CELLS')){
      const answer=payload.sources.find(source=>source.id.startsWith('answer-'));
      const cells=[{slot:'s1',value:'김민수',source:'request',quote:'김민수'},{slot:'s2',value:'영업팀',source:'request',quote:'영업팀'},{slot:'s3',value:'부산',source:'request',quote:'부산 거래처'}];
      if(answer)cells.push({slot:'s4',value:PERIOD,source:answer.id,quote:PERIOD});
      return {content:JSON.stringify({cells,rows:[],missing:answer?[]:[{slot:'s4',question:'출장 기간은 언제인가요?'}]})};
    }
    if(system.startsWith('NUBI_WORD_FORM_SECTION'))return {content:JSON.stringify({paragraphs:[payload.section.id==='sec-1'?'부산 거래처 방문':'없음'],sources:['request']})};
    if(system.startsWith('NUBI_WORD_FORM_REVIEWER'))return {content:JSON.stringify({checks:payload.items.map(item=>({item:item.item,target:item.target,quoteDocument:payload.places.find(place=>place.target===item.target).text.split('\n')[0],quoteUser:payload.sources[0].text,status:'met'}))})};
    throw Error('unexpected_prompt');
  }};
}

test('the chat fills a named form: missing values come back for one question, then a new copy is written',async t=>{
  const f=await fixture(t),s=f.service;s.providers=fixtureModel();
  await mkdir(path.join(f.root,'서식'),{recursive:true});const original=await docxFromBlocks(FORMS.trip);await writeFile(path.join(f.root,'서식','출장.docx'),original);
  const task=await s.createTask({request:'서식/출장.docx 양식으로 김민수 영업팀 부산 거래처 방문 출장 보고서를 써 주세요.'});
  assert.equal(documentFormRelevant(s,task),true);
  assert.equal(documentFormRelevant(s,{id:task.id,request:'app.txt 확인',messages:[]}),false,'the tool is not offered for other work');
  const first=await fillDocumentForm(s,task,{source:'서식/출장.docx'},{open:false});
  assert.equal(first.state,'needs_values',JSON.stringify(first));assert.deepEqual(first.questions.map(q=>q.slot),['s4']);
  const done=await fillDocumentForm(s,task,{answers:{s4:PERIOD}},{open:false});
  assert.equal(done.state,'written',JSON.stringify(done));assert.equal(done.output,'문서/출장 작성.docx');
  const items=(await docxSnapshot(await readFile(path.join(f.root,done.output)))).items;
  assert.equal(items.find(item=>item.id==='t1/r1/c2').text,'김민수');assert.match(items.find(item=>item.id==='t1/r3/c2').text,/2026/);
  assert.deepEqual(await readFile(path.join(f.root,'서식','출장.docx')),original,'the original form is unchanged');
  // A second copy does not overwrite the first.
  const again=await fillDocumentForm(s,{...task,id:task.id},{source:'서식/출장.docx'},{open:false});
  if(again.state==='needs_values'){const second=await fillDocumentForm(s,task,{answers:{s4:PERIOD}},{open:false});assert.equal(second.output,'문서/출장 작성 (2).docx');}
});

test('without a named file or an Office document the tool asks which form; other formats and paths are refused',async t=>{
  const f=await fixture(t),s=f.service;s.providers=fixtureModel();
  const task=await s.createTask({request:'양식으로 보고서 써 줘'});
  assert.equal((await fillDocumentForm(s,task,{},{open:false})).error,'form_source_required');
  await writeFile(path.join(f.root,'표.xlsx'),'x');
  assert.equal((await fillDocumentForm(s,task,{source:'표.xlsx'},{open:false})).error,'form_format_unsupported');
  await assert.rejects(fillDocumentForm(s,task,{source:'../밖.docx'},{open:false}),/path_scope/);
});

test('the copy opens with the system default app on each platform',()=>{
  const calls=[],spawnProcess=(command,args)=>{calls.push([command,...args]);return {on(){},unref(){}};};
  assert.equal(openWithDefaultApp('C:\\Work\\문서\\a.docx',{platform:'win32',spawnProcess}),true);
  assert.equal(openWithDefaultApp('/w/a.docx',{platform:'darwin',spawnProcess}),true);
  assert.deepEqual(calls,[['explorer.exe','C:\\Work\\문서\\a.docx'],['open','/w/a.docx']]);
});
