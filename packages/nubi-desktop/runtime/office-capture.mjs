// The registration capture of an Office form (document forms plan Task I, design §3 "양식 등록은 Office를 열어 전체를
// 가져온다", 2026-10-21). One contract for Word, Excel and PowerPoint, filled by the Office host (engine 'office',
// Windows) or, for tests only, by the file readers (engine 'file'). The capture says what the form holds: every text
// run with its font, size and colour, every picture, every sheet with its formulas, every slide shape. Values the
// person later fills never enter it; the source bytes travel beside it so nothing the capture does not list is lost.
import {fail} from './files.mjs';

export const CAPTURE_SCHEMA_VERSION=1;
const APPS=new Set(['word','excel','powerpoint']);
const ENGINES=new Set(['office','file']);
const ASSET_KINDS=new Set(['image','render']);
const text=(value,max)=>typeof value==='string'&&value.length<=max;
const list=value=>Array.isArray(value);

/** Throws form_capture_invalid when the capture does not follow the contract; returns it otherwise. */
export function validateCapture(capture){
  if(!capture||typeof capture!=='object'||capture.schemaVersion!==CAPTURE_SCHEMA_VERSION)fail('form_capture_invalid');
  if(!APPS.has(capture.app)||!ENGINES.has(capture.engine)||!ENGINES.has(capture.fidelity))fail('form_capture_invalid');
  if(capture.engine==='office'&&(!capture.office||!text(capture.office.version,80)))fail('form_capture_invalid');
  if(!capture.source||!text(capture.source.name,260)||!/^sha256:[0-9a-f]{64}$/.test(capture.source.hash??'')||!Number.isSafeInteger(capture.source.bytes))fail('form_capture_invalid');
  if(!capture.document||typeof capture.document!=='object')fail('form_capture_invalid');
  if(!list(capture.assets)||capture.assets.length>2000)fail('form_capture_invalid');
  const ids=new Set();
  for(const asset of capture.assets){
    if(!asset||!text(asset.id,80)||!/^[a-z0-9][a-z0-9-]*$/.test(asset.id)||ids.has(asset.id)||!ASSET_KINDS.has(asset.kind)||!text(asset.name,260)||!text(asset.contentType,80))fail('form_capture_invalid');
    if(asset.bytes!==undefined&&!(asset.bytes instanceof Uint8Array))fail('form_capture_invalid');
    if(asset.path!==undefined&&(!text(asset.path,1024)||path_escapes(asset.path)))fail('form_capture_invalid');
    ids.add(asset.id);
  }
  const document=capture.document;
  if(capture.app==='word'){
    if(!list(document.paragraphs)||!list(document.tables??[])||!list(document.images??[])||!list(document.headers??[])||!list(document.footers??[]))fail('form_capture_invalid');
    for(const paragraph of document.paragraphs)if(!paragraph||!text(paragraph.id,40)||!list(paragraph.runs))fail('form_capture_invalid');
    for(const image of document.images??[])if(!image||!text(image.asset,80)||!ids.has(image.asset))fail('form_capture_invalid');
  }else if(capture.app==='excel'){
    if(!list(document.sheets)||!document.sheets.length)fail('form_capture_invalid');
    for(const sheet of document.sheets)if(!sheet||!text(sheet.name,255)||!list(sheet.cells))fail('form_capture_invalid');
  }else if(!list(document.slides)||!document.slides.length)fail('form_capture_invalid');
  return capture;
}
const path_escapes=value=>/^(?:[a-zA-Z]:|\\\\|\/)/.test(value)||value.split(/[\\/]/).includes('..');

/** "글 48문단(run 61), 표 2, 그림 1, 머리글 1" style summary for the registration card and the activity log. */
export function captureSummary(capture){
  const document=capture.document;
  if(capture.app==='word'){
    const runs=document.paragraphs.reduce((n,p)=>n+p.runs.length,0),fonts=new Set(document.paragraphs.flatMap(p=>p.runs.map(r=>r.font).filter(Boolean)));
    const parts=[`문단 ${document.paragraphs.length}개(run ${runs})`,`표 ${(document.tables??[]).length}개`,`그림 ${(document.images??[]).length}개`];
    if((document.headers??[]).length)parts.push(`머리글 ${document.headers.length}`);if((document.footers??[]).length)parts.push(`바닥글 ${document.footers.length}`);
    if((document.footnotes??[]).length)parts.push(`각주 ${document.footnotes.length}`);if((document.controls??[]).length)parts.push(`컨트롤 ${document.controls.length}`);
    if(fonts.size)parts.push(`글꼴 ${[...fonts].slice(0,3).join(', ')}${fonts.size>3?' 외':''}`);
    return parts.join(', ')+(capture.fidelity==='file'?' (파일만 읽음)':' (Office로 확인함)');
  }
  if(capture.app==='excel'){
    const cells=document.sheets.reduce((n,s)=>n+s.cells.length,0),formulas=document.sheets.reduce((n,s)=>n+s.cells.filter(c=>c.formula).length,0);
    return `시트 ${document.sheets.length}개(${document.sheets.map(s=>s.name).slice(0,4).join(', ')}${document.sheets.length>4?' 외':''}), 셀 ${cells}개, 수식 ${formulas}개, 그림 ${capture.assets.filter(a=>a.kind==='image').length}개`+(capture.fidelity==='file'?' (파일만 읽음)':' (Office로 확인함)');
  }
  const shapes=document.slides.reduce((n,s)=>n+(s.shapes??[]).length,0);
  return `슬라이드 ${document.slides.length}장, 도형 ${shapes}개, 그림 ${capture.assets.filter(a=>a.kind==='image').length}개`+(capture.fidelity==='file'?' (파일만 읽음)':' (Office로 확인함)');
}
/** The capture as written to capture.json: asset bytes replaced by their stored paths. */
export function captureRecord(capture,assetPaths){
  return {...capture,assets:capture.assets.map(({bytes:_,...asset})=>({...asset,path:assetPaths.get(asset.id)??asset.path??null})),summary:captureSummary(capture)};
}
