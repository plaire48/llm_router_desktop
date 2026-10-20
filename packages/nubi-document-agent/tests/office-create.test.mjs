import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import JSZip from 'jszip';
import {XMLParser} from 'fast-xml-parser';
import {deferred,until} from './host.mjs';
const load=async name=>existsSync(new URL(`../dist/${name}.js`,import.meta.url))?import(`../dist/${name}.js`):{};
const excel=await load('excel'),ppt=await load('powerpoint');
export const cell=(value,role='body',format='general')=>({value,formula:null,role,format});
export const formula=(text,format='integer')=>({...cell(null,'total',format),formula:text});
export const workbook={title:'검토 현황',sheets:[{name:'현황',columnWidths:[25,18,18],rows:[
  [cell('문서','header'),cell('작성','header'),cell('검토','header')],
  [cell('Word'),cell(3,'input'),cell(2,'input')],
  [cell('Excel'),cell(2,'input'),cell(1,'input')],
  [cell('PowerPoint'),cell(1,'input'),cell(0,'input')],
  [cell('합계','total'),formula('SUM(B2:B4)'),formula('SUM(C2:C4)')],
  [cell('검토 완료율'),formula('IF(B5=0,0,C5/B5)','percent'),cell('=SUM(1,2)')]
]}]};
export const deck={title:'문서 작성 시범 운영',slides:[
  {title:'배포 보류',paragraphs:['작성 6건 중 검토 완료 3건. 완료율 50%.','검토 대기 3건 처리 후 10월 19일 16시에 다시 결정합니다.'],table:null,notes:'출처: 합성 평가 입력'},
  {title:'문서별 현황',paragraphs:[],table:{headers:['문서','작성','검토 완료','검토 대기'],rows:[['Word','3','2','1'],['Excel','2','1','1'],['PowerPoint','1','0','1'],['합계','6','3','3']]},notes:'출처: 합성 평가 입력'}
]};
const signal=()=>new AbortController().signal;
test('new Excel serializes editable typed inputs and live formulas without interpreting literal strings',async()=>{
  assert.equal(typeof excel.createExcelDocument,'function','Excel creation is not connected');
  const result=await excel.createExcelDocument(workbook,signal());
  assert.equal(result.savedToOffice,false);assert.equal(result.calculationRequired,true);
  const zip=await JSZip.loadAsync(result.bytes),xml=await zip.file('xl/worksheets/sheet1.xml').async('string');
  const tree=new XMLParser({ignoreAttributes:false}).parse(xml).worksheet;
  const cells=tree.sheetData.row.flatMap(r=>Array.isArray(r.c)?r.c:[r.c]);
  assert.equal(cells.find(c=>c['@_r']==='B5').f,'SUM(B2:B4)');
  assert.equal(cells.find(c=>c['@_r']==='B6').f,'IF(B5=0,0,C5/B5)');
  assert.equal(cells.find(c=>c['@_r']==='C6').f,undefined);
  assert.equal(cells.find(c=>c['@_r']==='C6')['@_t'],'s');
  const inspection=await excel.inspectGeneratedExcel(result.bytes);
  assert.equal(inspection.sheets[0].rows[1][1].value,3);
  assert.equal(inspection.sheets[0].rows[5][2].value,'=SUM(1,2)');
  assert.equal(inspection.hasExternalRelationships,false);
});
test('Excel rejects external formulas, unsupported functions, missing references and circular dependencies',async()=>{
  assert.equal(typeof excel.createExcelDocument,'function','Excel creation is not connected');
  for(const text of ["'[book.xlsx]Sheet1'!A1",'SUM(XFE99:XFE100)','B5+1','SUM(B2:B4))']){
    const draft=structuredClone(workbook);draft.sheets[0].rows[4][1].formula=text;
    await assert.rejects(excel.createExcelDocument(draft,signal()),{code:'excel_formula_invalid'});
  }
  const external=structuredClone(workbook);external.sheets[0].rows[4][1].formula='WEBSERVICE("https://example.com")';
  await assert.rejects(excel.createExcelDocument(external,signal()),{code:'excel_formula_host_capability_required'});
});
test('PowerPoint preserves slide order and editable table cells and escapes source text',async()=>{
  assert.equal(typeof ppt.createPowerPointDocument,'function','PowerPoint creation is not connected');
  const draft=structuredClone(deck);draft.slides[0].paragraphs.push('A < B & 검토');
  const result=await ppt.createPowerPointDocument(draft,signal());
  assert.equal(result.engine,'genoffice');assert.equal(result.savedToOffice,false);
  const zip=await JSZip.loadAsync(result.bytes);
  const first=await zip.file('ppt/slides/slide1.xml').async('string');
  assert.match(first,/A &lt; B &amp; 검토/);
  assert.match(first,/<a:spcPct val="115000"/,'Wrapped text needs 115 percent line spacing');
  const second=await zip.file('ppt/slides/slide2.xml').async('string');
  assert.match(second,/<a:tbl>/);assert.doesNotMatch(second,/<p:pic\b/);
  assert.match(second,/<a:graphicData uri="http:\/\/schemas.openxmlformats.org\/drawingml\/2006\/table"/,'Native tables need the standard DrawingML table URI to render');
  const notes=await zip.file('ppt/notesSlides/notesSlide2.xml').async('string');
  assert.match(notes,/<p:ph type="body"/,'Source citations must be in the editable speaker notes body');
  const inspection=await ppt.inspectGeneratedPowerPoint(result.bytes);
  assert.equal(inspection.slides.length,2);assert.equal(inspection.slides[0].title,'배포 보류');
  assert.deepEqual(inspection.slides[1].tables[0].rows.at(-1),['합계','6','3','3']);
  assert.match(inspection.slides[1].notes,/합성 평가/);
});
test('new draft generators reject unknown executable fields, unbounded layout and cancellation',async()=>{
  assert.equal(typeof excel.createExcelDocument,'function');assert.equal(typeof ppt.createPowerPointDocument,'function');
  await assert.rejects(excel.createExcelDocument({...workbook,script:'x'},signal()),{code:'excel_draft_invalid'});
  const crowded=structuredClone(deck);crowded.slides[0].paragraphs=['가'.repeat(3000)];
  await assert.rejects(ppt.createPowerPointDocument(crowded,signal()),{code:'powerpoint_draft_invalid'});
  const cancelled=new AbortController();cancelled.abort();
  await assert.rejects(excel.createExcelDocument(workbook,cancelled.signal),{code:'operation_cancelled'});
  await assert.rejects(ppt.createPowerPointDocument(deck,cancelled.signal),{code:'operation_cancelled'});
});
test('Excel internal sheet references retain spaces and dates fail with a stable validation error',async()=>{
  const draft=structuredClone(workbook);draft.sheets.push({name:'원본 자료',columnWidths:[20],rows:[[cell(7,'input')]]});
  draft.sheets[0].rows[4][1].formula="'원본 자료'!A1+SUM(B2:B4)";
  const result=await excel.createExcelDocument(draft,signal());
  assert.equal((await excel.inspectGeneratedExcel(result.bytes)).sheets[0].rows[4][1].formula,"'원본 자료'!A1+SUM(B2:B4)");
  draft.sheets[1].rows[0][0]=cell('2026-99-99','input','date');
  await assert.rejects(excel.createExcelDocument(draft,signal()),{code:'excel_draft_invalid'});
});
test('Excel accepts short metadata rows and blank spacer rows without inventing trailing values',async()=>{
  const draft=structuredClone(workbook);draft.sheets[0].rows.push([], [cell('담당자'),cell('김민수')]);
  const result=await excel.createExcelDocument(draft,signal()),inspection=await excel.inspectGeneratedExcel(result.bytes);
  assert.equal(inspection.sheets[0].rows[7][1].value,'김민수');
  assert.equal(inspection.sheets[0].rows[7][2].value,null);
  assert.equal(inspection.sheets[0].rows[6][0].value,null);
});
test('PowerPoint rejects titles that cannot fit the bounded template',async()=>{
  const draft=structuredClone(deck);draft.slides[0].title='가'.repeat(44);
  await assert.rejects(ppt.createPowerPointDocument(draft,signal()),{code:'powerpoint_draft_invalid'});
});
for(const [domain,api,draft] of [['excel',excel,workbook],['powerpoint',ppt,deck]]){
  test(`${domain} uses the host model and source-read tools before proposing bytes`,async()=>{
    const prepare=api[domain==='excel'?'prepareExcelDocument':'preparePowerPointDocument'];assert.equal(typeof prepare,'function');
    const calls=[],events=[];
    const transport={stream(request,cb){calls.push(request);queueMicrotask(()=>{
      const results=request.messages.filter(m=>m.role==='tool').flatMap(m=>m.results);
      if(!results.some(r=>r.name===`read_${domain}_sources`))cb.onToolCall({id:'read',name:`read_${domain}_sources`,input:{}});
      else if(!results.some(r=>r.name===`submit_${domain}_draft`))cb.onToolCall({id:'submit',name:`submit_${domain}_draft`,input:draft});
      else cb.onDelta('초안을 준비했습니다.');cb.onDone();});return {cancel(){}};}};
    const result=await prepare({request:'보고서를 작성하세요.',sources:{created:6,reviewed:3}},transport,signal(),{onTool:name=>events.push(name)});
    assert.equal(result.finalSaveRequired,true);assert.equal(result.savedToOffice,false);
    assert.equal(calls.length,3);assert.deepEqual(events,[`read_${domain}_sources`,`submit_${domain}_draft`]);
  });
  test(`${domain} refuses prose-only completion as proof of a created file`,async()=>{
    const prepare=api[domain==='excel'?'prepareExcelDocument':'preparePowerPointDocument'];assert.equal(typeof prepare,'function');
    const transport={stream(request,cb){queueMicrotask(()=>{cb.onDelta('완료');cb.onDone();});return {cancel(){}};}};
    await assert.rejects(prepare({request:'보고서를 작성하세요.',sources:{}},transport,signal()),{code:`${domain}_draft_missing`});
  });
  test(`${domain} cancels a pending host model and discards late responses`,async()=>{
    const prepare=api[domain==='excel'?'prepareExcelDocument':'preparePowerPointDocument'];
    const gate=deferred(),control=new AbortController();let calls=0;
    const transport={stream(request,cb){calls++;gate.promise.then(()=>{cb.onToolCall({id:'late',name:`submit_${domain}_draft`,input:draft});cb.onDone();});return {cancel(){cb.onDone();}};}};
    const run=prepare({request:'보고서를 작성하세요.',sources:{}},transport,control.signal);
    const rejected=assert.rejects(run,{code:'operation_cancelled'});await until(()=>calls===1);control.abort();gate.resolve();await rejected;assert.equal(calls,1);
  });
}
