import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile,readdir,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {registerForm,loadForm,listForms,formQuestionPlan,formNameFromFile} from '../runtime/document-forms.mjs';
import {docxFromBlocks,FORMS} from './helpers-docx-fixture.mjs';

// Document forms plan Task B: a registered form keeps its map, source hash and preview; the question plan asks for the
// required values only, one question per table or section.
async function workspace(t){const dir=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-forms-')));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}

test('registering a form writes its three files, lists it, and notices when the source changes',async t=>{
  const root=await workspace(t),source=path.join(root,'서식','기안문.docx');
  await writeFile(source,await docxFromBlocks(FORMS.gianmun)).catch(async()=>{const {mkdir}=await import('node:fs/promises');await mkdir(path.dirname(source),{recursive:true});await writeFile(source,await docxFromBlocks(FORMS.gianmun));});
  const registered=await registerForm({workspace:root,source});
  assert.equal(registered.name,'기안문');assert.match(registered.hash,/^sha256:/);assert.equal(registered.preview.summary,'칸 6개, 목차 3개, 작성 요령 1개');
  assert.deepEqual((await readdir(path.join(root,'.nubi','forms','기안문'))).sort(),['assets','capture.json','form-map.json','items.json','preview.json','source.docx','source.sha256']);
  const stored=JSON.parse(await readFile(path.join(root,'.nubi','forms','기안문','form-map.json'),'utf8'));
  assert.equal(stored.kind,'template_map');assert.equal(stored.slots.length,6);
  assert.match(await readFile(path.join(root,'.nubi','forms','기안문','source.sha256'),'utf8'),/^sha256:[0-9a-f]{64} 서식\/기안문\.docx\n$/);
  const loaded=await loadForm(root,'기안문');
  assert.deepEqual([loaded.copy,loaded.capture.engine,loaded.capture.fidelity,loaded.capture.app,loaded.preview.fidelity,loaded.capture.document.paragraphs.length>0],['.nubi/forms/기안문/source.docx','file','file','word','file',true]);
  assert.match(loaded.preview.capture,/파일만 읽음/);
  assert.equal((await readFile(path.join(root,'.nubi','forms','기안문','source.docx'))).length,(await readFile(source)).length,'the original bytes are kept');
  assert.equal(loaded.changed,false);assert.equal(loaded.hash,registered.hash);assert.equal(loaded.source,'서식/기안문.docx');assert.equal(loaded.preview.slots[1].valueType,'date');
  assert.deepEqual((await listForms(root)).map(form=>[form.name,form.summary]),[['기안문','칸 6개, 목차 3개, 작성 요령 1개']]);
  await writeFile(source,await docxFromBlocks(FORMS.trip));
  assert.equal((await loadForm(root,'기안문')).changed,true,'a different source file is reported, the kept map is untouched');
  await rm(source);assert.equal((await loadForm(root,'기안문')).changed,null,'a missing source is unknown, not changed');
  await assert.rejects(loadForm(root,'없음'),/form_missing/);
  await assert.rejects(registerForm({workspace:root,source:path.join(root,'없는.docx')}),/form_source_missing/);
  await assert.rejects(registerForm({workspace:root,source,name:'../x'}),/form_name_invalid/);
  assert.equal(formNameFromFile('/tmp/서식/2026 견적서(최종).docx'),'2026 견적서 최종');
});

test('the question plan asks for required empty slots first, one question per table or section, and reports what is filled',async t=>{
  const root=await workspace(t),source=path.join(root,'출장.docx');
  await writeFile(source,await docxFromBlocks(FORMS.trip));
  const {map}=await registerForm({workspace:root,source,name:'출장 보고'});
  const plan=formQuestionPlan(map);
  assert.deepEqual(plan.questions.map(q=>[q.id,q.group,q.required,q.fields.map(f=>f.slot)]),[['q1','t1',true,['s1','s2','s3','s4']],['q2','sec-1',true,['sec-1']],['q3','sec-3',true,['sec-3']],['q4','t2',false,['s5']]]);
  assert.equal(plan.questions[0].label,'출장자, 소속, 출장지, 출장 기간');
  assert.deepEqual(plan.questions[0].fields[3],{slot:'s4',label:'출장 기간',kind:'period',required:true,example:'20XX. XX. XX. ~ 20XX. XX. XX.'});
  assert.deepEqual(plan.questions[3].fields[0],{slot:'s5',label:'2. 주요 일정',kind:'rows',header:['일자','시간','내용'],emptyRows:3,required:false});
  assert.equal(plan.questions[1].fields[0].example,'(출장 목적을 기재)');
  const later=formQuestionPlan(map,{s1:'김민수',s2:'영업팀',s3:'부산',s4:'2026. 10. 21. ~ 2026. 10. 22.','sec-1':'거래처 방문','sec-3':'없음'});
  assert.deepEqual(later.questions.map(q=>q.id),['q1']);assert.equal(later.questions[0].fields[0].kind,'rows');
  assert.deepEqual(later.filled.map(f=>f.id),['s1','s2','s3','s4','sec-1','sec-3']);
  assert.equal(later.summary,'칸 4개, 표 행 1개, 목차 2개');
});

test('Excel and PowerPoint forms are stored whole: capture, assets and source copy, listed but not yet fillable',async t=>{
  const root=await workspace(t);const {xlsxFixture,pptxFixture}=await import('./helpers-office-fixtures.mjs');
  await writeFile(path.join(root,'견적서.xlsx'),await xlsxFixture());await writeFile(path.join(root,'주간보고.pptx'),await pptxFixture());
  const excel=await registerForm({workspace:root,source:path.join(root,'견적서.xlsx')});
  assert.deepEqual([excel.name,excel.map,excel.preview.fillable,excel.preview.app,excel.capture.app,excel.capture.assets],['견적서',null,false,'excel','excel',1]);
  assert.match(excel.preview.summary,/^시트 2개\(견적서, 코드\)/);
  assert.deepEqual((await readdir(path.join(root,'.nubi','forms','견적서'))).sort(),['assets','capture.json','preview.json','source.sha256','source.xlsx']);
  const slides=await registerForm({workspace:root,source:path.join(root,'주간보고.pptx')});
  assert.deepEqual([slides.preview.app,slides.preview.summary],['powerpoint','슬라이드 2장, 도형 5개, 그림 1개 (파일만 읽음)']);
  const loaded=await loadForm(root,'주간보고');assert.deepEqual([loaded.app,loaded.map,loaded.capture.document.slides.length,loaded.copy],['powerpoint',null,2,'.nubi/forms/주간보고/source.pptx']);
  assert.deepEqual((await listForms(root)).map(f=>[f.name,f.app,f.fillable]),[['견적서','excel',false],['주간보고','powerpoint',false]]);
  await writeFile(path.join(root,'메모.hwp'),'x');await assert.rejects(registerForm({workspace:root,source:path.join(root,'메모.hwp')}),/form_format_unsupported/);
});
