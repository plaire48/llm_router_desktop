import test from 'node:test';
import assert from 'node:assert/strict';
import {captureOfficeFile,officeAppOf} from '../runtime/office-file-capture.mjs';
import {captureSummary} from '../runtime/office-capture.mjs';
import {xlsxFixture,pptxFixture,PNG} from './helpers-office-fixtures.mjs';

// Document forms plan Task I: the file engine captures every sheet with formulas, formats and pictures, and every slide
// with its shapes, runs, pictures and notes, in the same contract the Office host fills.
test('an Excel form: both sheets (the hidden one too), values, formulas, number formats, fonts, fills, merges, names, validations and the picture',async()=>{
  const capture=await captureOfficeFile(await xlsxFixture(),{name:'견적서.xlsx'});
  assert.deepEqual([capture.app,capture.engine,capture.fidelity],['excel','file','file']);
  assert.deepEqual(capture.document.sheets.map(sheet=>[sheet.name,sheet.state]),[['견적서','visible'],['코드','hidden']]);
  const sheet=capture.document.sheets[0],cell=address=>sheet.cells.find(c=>c.address===address);
  assert.deepEqual(cell('A1'),{address:'A1',value:'견 적 서',type:'string',font:{name:'맑은 고딕',size:16,bold:true,color:'#1F3864'},alignment:{horizontal:'center',vertical:'middle'}});
  assert.deepEqual([cell('D4').formula,cell('D4').numberFormat,cell('D6').formula,cell('D6').font],['B4*C4','#,##0','SUM(D4:D5)',{bold:true,color:'#FF0000'}]);
  assert.deepEqual(cell('A3').fill,{pattern:'solid',color:'#D9E1F2'});assert.deepEqual(cell('A3').border,{bottom:{style:'thin',color:'#000000'}});
  assert.deepEqual(cell('B8').validation,{type:'list',formulae:['"현금,카드"'],allowBlank:true},'a validation-only cell is kept');
  assert.deepEqual(sheet.validations,[{address:'B8',type:'list',formulae:['"현금,카드"'],allowBlank:true}]);
  assert.deepEqual(sheet.merges,['A1:D1']);assert.deepEqual(sheet.columns[0],{column:'A',width:24});assert.deepEqual(sheet.rows.find(r=>r.row===1),{row:1,height:30});
  assert.equal(sheet.tabColor,'#1F3864');
  assert.deepEqual(sheet.images,[{asset:'image-1',from:'F1',to:'H4'}],'the picture spans from F1 to the H4 edge');
  assert.deepEqual(capture.assets.map(a=>[a.id,a.contentType,Buffer.from(a.bytes).equals(PNG)]),[['image-1','image/png',true]]);
  assert.deepEqual(capture.document.definedNames,[{name:'합계금액',ranges:["'견적서'!$D$6"]}]);
  assert.deepEqual(capture.document.sheets[1].cells.map(c=>c.value),['현금','카드']);
  assert.match(captureSummary(capture),/^시트 2개\(견적서, 코드\), 셀 \d+개, 수식 2개, 그림 1개 \(파일만 읽음\)$/);
});

test('a PowerPoint form: slides in order with layout, placeholders, positions, formatted runs, the picture, the table and the notes',async()=>{
  const capture=await captureOfficeFile(await pptxFixture(),{name:'주간보고.pptx'});
  assert.deepEqual([capture.app,capture.engine,capture.document.size],['powerpoint','file',{width:960,height:540}]);
  const [first,second]=capture.document.slides;
  assert.deepEqual([first.index,first.layout,first.background,second.layout],[1,'제목 슬라이드','#F2F2F2','제목 및 내용']);
  const title=first.shapes[0];
  assert.deepEqual([title.name,title.placeholder,title.left,title.top,title.width,title.text],['제목 1',{type:'ctrTitle'},72,72,816,'주간 보고']);
  assert.deepEqual(title.paragraphs[0].runs,[{text:'주간 보고',font:'맑은 고딕',size:40,bold:true,color:'#1F3864'}]);
  assert.deepEqual(first.shapes[1].paragraphs[0].runs,[{text:'작성자: '},{text:'(이름 입력)',color:'#FF0000'}]);
  const picture=second.shapes.find(s=>s.type==='picture');
  assert.deepEqual([picture.name,picture.description,picture.asset,picture.width,picture.height],['로고','회사 로고','image-1',100,50]);
  const table=second.shapes.find(s=>s.type==='table');assert.deepEqual(table.rows.map(row=>row.map(c=>c.text)),[['업무','결과'],['(업무 입력)','']]);
  assert.equal(second.notes,'실적은 표로만 적는다.');
  assert.deepEqual(capture.assets.map(a=>[a.id,a.name,a.contentType]),[['image-1','image1.png','image/png']]);
  assert.deepEqual([capture.document.fonts,capture.document.colors],[['맑은 고딕'],['#1F3864','#FF0000']]);
  assert.equal(captureSummary(capture),'슬라이드 2장, 도형 5개, 그림 1개 (파일만 읽음)');
});

test('the extension picks the app, and an unknown format or a broken file is refused',async()=>{
  assert.deepEqual(['a.docx','b.XLSX','c.pptx','d.hwp'].map(officeAppOf),['word','excel','powerpoint',null]);
  await assert.rejects(captureOfficeFile(Buffer.from('x'),{name:'a.hwp'}),/form_format_unsupported/);
  await assert.rejects(captureOfficeFile(Buffer.from('not a zip'),{name:'a.xlsx'}),/xlsx_invalid/);
  await assert.rejects(captureOfficeFile(Buffer.from('not a zip'),{name:'a.pptx'}),/pptx_invalid/);
});
