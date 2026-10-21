import test from 'node:test';
import assert from 'node:assert/strict';
import {docxCapture} from '../runtime/docx-capture.mjs';
import {validateCapture,captureSummary,captureRecord} from '../runtime/office-capture.mjs';
import {docxFromBlocks,FORMS} from './helpers-docx-fixture.mjs';

// Document forms plan Task I: the file engine reads everything a docx holds that the Office capture contract lists,
// and says it is a file read (fidelity 'file'), never an Office confirmation.
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==','base64');

test('runs keep font, size, colour and emphasis; pictures become assets with their anchor; headers and page setup are read',async()=>{
  const blocks=[{p:{runs:[{text:'기 안 문',font:'맑은 고딕',size:20,bold:true,color:'1F3864'}],style:'Title'}},
    {image:{name:'logo.png',bytes:PNG,cx:914400,cy:457200}},
    {p:{runs:[{text:'담당: '},{text:'(이름 기재)',bold:true,italic:true,color:'FF0000'}],style:'본문'}},
    {table:{rows:[[{text:'항목',bold:true},{text:'',width:3000}],['금액','0,000원']]}}];
  const bytes=await docxFromBlocks(blocks,{header:'사내 문서 양식',footer:'1 / 1'});
  const capture=await docxCapture(bytes,{name:'기안문.docx'});
  assert.deepEqual([capture.schemaVersion,capture.app,capture.engine,capture.fidelity,capture.office],[1,'word','file','file',null]);
  assert.deepEqual([capture.source.name,capture.source.bytes>0,capture.source.hash.startsWith('sha256:')],['기안문.docx',true,true]);
  const title=capture.document.paragraphs[0];
  assert.deepEqual(title.runs,[{text:'기 안 문',font:'맑은 고딕',size:20,color:'#1F3864',bold:true}]);assert.equal(title.style,'Title');
  const guide=capture.document.paragraphs.find(p=>p.text.startsWith('담당'));
  assert.deepEqual(guide.runs,[{text:'담당: '},{text:'(이름 기재)',color:'#FF0000',bold:true,italic:true}]);
  assert.equal(capture.document.images.length,1);
  const image=capture.document.images[0];assert.deepEqual([image.asset,image.anchor,image.inline,image.widthCm,image.heightCm,image.name],['image-1','p-2',true,2.54,1.27,'logo.png']);
  assert.deepEqual(capture.assets.map(a=>[a.id,a.kind,a.name,a.contentType,a.bytes.length]),[['image-1','image','logo.png','image/png',PNG.length]]);
  assert.deepEqual(capture.document.headers.map(h=>h.text),['사내 문서 양식']);assert.deepEqual(capture.document.footers.map(f=>f.text),['1 / 1']);
  assert.deepEqual(capture.document.section,{page:{widthMm:210,heightMm:297,orientation:'portrait'},margins:{top:72,bottom:72,left:72,right:72}});
  const table=capture.document.tables[0];assert.equal(table.rows.length,2);assert.deepEqual([table.rows[0][1].width,table.rows[1][1].text],[3000,'0,000원']);
  assert.deepEqual([capture.document.fonts,capture.document.colors],[['맑은 고딕'],['#1F3864','#FF0000']]);
  assert.equal(captureSummary(capture),'문단 4개(run 3), 표 1개, 그림 1개, 머리글 1, 바닥글 1, 글꼴 맑은 고딕 (파일만 읽음)');
  const record=captureRecord(capture,new Map([['image-1','assets/image-1.png']]));
  assert.equal(record.assets[0].path,'assets/image-1.png');assert.equal(record.assets[0].bytes,undefined);assert.equal(record.summary,captureSummary(capture));
});

test('the contract refuses an incomplete or wrong capture and accepts the file engine output of every synthetic form',async()=>{
  for(const form of Object.values(FORMS))validateCapture(await docxCapture(await docxFromBlocks(form)));
  const good=await docxCapture(await docxFromBlocks(FORMS.gianmun));
  assert.throws(()=>validateCapture({...good,schemaVersion:2}),/form_capture_invalid/);
  assert.throws(()=>validateCapture({...good,engine:'office',office:null}),/form_capture_invalid/,'an Office capture names the Office version');
  assert.throws(()=>validateCapture({...good,document:{...good.document,images:[{asset:'missing'}]}}),/form_capture_invalid/,'a picture must point at an asset');
  assert.throws(()=>validateCapture({...good,assets:[{id:'bad id',kind:'image',name:'x',contentType:'image/png'}]}),/form_capture_invalid/);
  assert.throws(()=>validateCapture({...good,assets:[{id:'a',kind:'image',name:'x',contentType:'image/png',path:'../x.png'}]}),/form_capture_invalid/);
  assert.equal(validateCapture({...good,engine:'office',office:{version:'16.0'}}).engine,'office');
  assert.throws(()=>validateCapture({...good,app:'excel',document:{sheets:[]}}),/form_capture_invalid/);
  assert.equal(validateCapture({...good,app:'excel',document:{sheets:[{name:'Sheet1',cells:[]}]}}).app,'excel');
});
