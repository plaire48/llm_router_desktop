import assert from 'node:assert/strict';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import {XMLParser} from 'fast-xml-parser';
const parser=new XMLParser({ignoreAttributes:false,parseTagValue:false}),array=x=>x===undefined?[]:Array.isArray(x)?x:[x];
const find=(x,key)=>!x||typeof x!=='object'?[]:Object.entries(x).flatMap(([k,v])=>k===key?array(v):array(v).flatMap(n=>find(n,key)));
const val=(x,key)=>x?.['@_'+key];
async function parts(bytes){const z=await JSZip.loadAsync(bytes);return {z,async xml(p){return parser.parse(await z.file(p).async('string'));}};}
const target={blockIndexes:[2]},table={blockIndexes:[4]};
const cf={op:'add_conditional_format',sheet:'데이터',range:'B2:B4',rule:{kind:'number',operator:'greaterThan',value:20,format:{fillColor:'#C6EFCE',bold:true}}};
const addShapes=n=>[0,1,2].map((i)=>({op:'addElement',target:{slide:0},kind:'roundRect',offset:{x:731520+i*(2600000+n*10000),y:5100000+i*10000,cx:1800000,cy:700000},fill:'#E8F1FE',paragraphs:[{runs:[{text:`단계 ${i+1}`,fontSize:16,fontFamily:'Apple SD Gothic Neo'}]}]}));
const caseOf=(domain,op,ops,check,prepare)=>({domain,op,ops,check,prepare});
const wordCheck=(inspect)=>async bytes=>{const p=await parts(bytes),xml=await p.xml('word/document.xml');await inspect(xml,p);};
const cells=x=>find(x,'w:tc'),rows=x=>find(x,'w:tr');
export const cases=[
  caseOf('word','setFont',()=>[{op:'setFont',target,italic:true,color:'#3182F6'}],wordCheck(x=>assert.ok(find(x,'w:i').length&&find(x,'w:color').some(c=>val(c,'w:val')==='3182F6')))),
  caseOf('word','setParagraphFormat',()=>[{op:'setParagraphFormat',target,align:'right'}],wordCheck(x=>assert.ok(find(x,'w:jc').some(c=>val(c,'w:val')==='right')))),
  caseOf('word','define_style',()=>[{op:'define_style',styleId:'ReviewCallout',basedOn:'Normal',run:{italic:true,color:'#3182F6'}}],wordCheck(async(_x,p)=>assert.ok(find(await p.xml('word/styles.xml'),'w:style').some(s=>val(s,'w:styleId')==='ReviewCallout')))),
  caseOf('word','applyStyle',()=>[{op:'define_style',styleId:'ReviewCallout',basedOn:'Normal',run:{italic:true}},{op:'applyStyle',target,styleId:'ReviewCallout'}],wordCheck(x=>assert.ok(find(x,'w:pStyle').some(c=>val(c,'w:val')==='ReviewCallout')))),
  caseOf('word','setList',()=>[{op:'setList',target,kind:'number'}],wordCheck(x=>assert.equal(find(x,'w:numPr').length,1))),
  caseOf('word','clearList',()=>[{op:'setList',target,kind:'number'},{op:'clearList',target}],wordCheck(x=>assert.equal(find(x,'w:numPr').length,0))),
  caseOf('word','insertTableRow',()=>[{op:'insertTableRow',target:table,row:2}],wordCheck(x=>assert.equal(rows(x).length,4))),
  caseOf('word','deleteTableRow',()=>[{op:'deleteTableRow',target:table,row:1}],wordCheck(x=>assert.equal(rows(x).length,2))),
  caseOf('word','insertTableColumn',()=>[{op:'insertTableColumn',target:table,col:1,position:'before'}],wordCheck(x=>assert.equal(cells(rows(x)[0]).length,3))),
  caseOf('word','deleteTableColumn',()=>[{op:'deleteTableColumn',target:table,col:1}],wordCheck(x=>assert.equal(cells(rows(x)[0]).length,1))),
  caseOf('word','mergeTableCells',()=>[{op:'mergeTableCells',target:table,range:{row:2,col:0,colEnd:1}}],wordCheck(x=>assert.ok(find(x,'w:gridSpan').some(c=>val(c,'w:val')==='2')))),
  caseOf('word','splitTableCell',()=>[{op:'mergeTableCells',target:table,range:{row:2,col:0,colEnd:1}},{op:'splitTableCell',target:table,cell:{row:2,col:0}}],wordCheck(x=>assert.ok(!find(x,'w:gridSpan').some(c=>Number(val(c,'w:val'))>1)))),
  caseOf('word','setTableCellFormat',()=>[{op:'setTableCellFormat',target:table,range:{row:0,col:0,colEnd:1},fill:'#3182F6'}],wordCheck(x=>assert.ok(find(x,'w:shd').some(c=>val(c,'w:fill')==='3182F6')))),
  caseOf('word','set_page_setup',()=>[{op:'set_page_setup',orientation:'landscape',paper:'A4'}],wordCheck(x=>assert.ok(find(x,'w:pgSz').some(c=>val(c,'w:orient')==='landscape')))),
  caseOf('word','set_header_footer',n=>[{op:'set_header_footer',kind:n===2?'footer':'header',text:`검사 ${n} {PAGE}`}],wordCheck(async(_x,p)=>{const hf=Object.keys(p.z.files).filter(k=>/^word\/(header|footer)\d+\.xml$/.test(k));assert.ok(hf.length);assert.ok((await Promise.all(hf.map(k=>p.z.file(k).async('string')))).some(s=>s.includes('PAGE')&&s.includes('검사')));})),
  ...[
    ['format_range',()=>[{op:'format_range',sheet:'데이터',range:'B2:B4',format:{bold:true,fillColor:'#C6EFCE'}}],async b=>assert.equal(b.getWorksheet('데이터').getCell('B2').font.bold,true)],
    ['merge_cells',()=>[{op:'merge_cells',sheet:'데이터',range:'A6:B6'}],async b=>assert.equal(b.getWorksheet('데이터').getCell('B6').master.address,'A6')],
    ['unmerge_cells',()=>[{op:'merge_cells',sheet:'데이터',range:'A6:B6'},{op:'unmerge_cells',sheet:'데이터',range:'A6:B6'}],async b=>assert.equal(b.getWorksheet('데이터').getCell('B6').isMerged,false)],
    ['add_defined_name',()=>[{op:'add_defined_name',name:'Amounts',ref:"'데이터'!$B$2:$B$4"}],async b=>assert.ok(b.definedNames.model.some(n=>n.name==='Amounts'))],
    ['delete_defined_name',()=>[{op:'add_defined_name',name:'Amounts',ref:"'데이터'!$B$2:$B$4"},{op:'delete_defined_name',name:'Amounts'}],async b=>assert.ok(!b.definedNames.model.some(n=>n.name==='Amounts'))],
    ['set_data_validation',()=>[{op:'set_data_validation',sheet:'데이터',range:'A2:A4',validation:{kind:'list',values:['완료','진행','보류']}}],async b=>assert.equal(b.getWorksheet('데이터').getCell('A2').dataValidation.type,'list')],
    ['add_conditional_format',()=>[cf],async b=>assert.ok(b.getWorksheet('데이터').conditionalFormattings.some(c=>c.ref==='B2:B4'))],
    ['clear_conditional_formats',()=>[cf,{op:'clear_conditional_formats',sheet:'데이터',range:'B2:B4'}],async b=>assert.equal(b.getWorksheet('데이터').conditionalFormattings.length,0)],
    ['add_table',()=>[{op:'add_table',sheet:'데이터',range:'A1:C4',name:'ReviewData',style:'TableStyleMedium9'}],async b=>assert.ok(b.getWorksheet('데이터').getTable('ReviewData'))],
    ['set_freeze',()=>[{op:'set_freeze',sheet:'데이터',rows:2,columns:1}],async b=>assert.ok(b.getWorksheet('데이터').views.some(v=>v.ySplit===2&&v.xSplit===1))],
    ['set_page_setup',()=>[{op:'set_page_setup',sheet:'데이터',orientation:'portrait',printArea:'A1:C6'}],async b=>assert.equal(b.getWorksheet('데이터').pageSetup.orientation,'portrait')],
    ['add_chart',()=>[{op:'add_chart',sheet:'데이터',chartType:'column',dataRange:'A1:B4',title:'상태별 금액',anchorCell:'E2'}],async(_b,p)=>assert.ok(Object.keys(p.z.files).some(k=>/^xl\/charts\/chart\d+\.xml$/.test(k)))]
  ].map(([op,ops,inspect])=>caseOf('excel',op,ops,async bytes=>{const book=new ExcelJS.Workbook();await book.xlsx.load(bytes);await inspect(book,await parts(bytes));})),
  ...[
    ['addElement',n=>[addShapes(n)[0]],async x=>assert.ok(find(x,'a:prstGeom').some(s=>val(s,'prst')==='roundRect'))],
    ['setText',n=>[{op:'setText',target:{slide:0,el:'e_2'},paragraphs:[{runs:[{text:`변경 제목 ${n}`,fontFamily:'Apple SD Gothic Neo',fontSize:28}]}]}],async x=>assert.ok(JSON.stringify(x).includes('변경 제목'))],
    ['setFont',()=>[{op:'setFont',target:{slide:0,el:'e_2'},font:{italic:true,color:'#3182F6'}}],async x=>assert.ok(find(x,'a:rPr').some(r=>val(r,'i')==='1'))],
    ['setTransform',()=>[{op:'setTransform',target:{slide:0,el:'e_3'},box:{x:914400,y:1508760,cx:9000000,cy:868680}}],async x=>assert.ok(find(x,'a:off').some(o=>val(o,'x')==='914400'))],
    ['setFill',()=>[{op:'setFill',target:{slide:0,el:'e_2'},fill:'#E8F1FE'}],async x=>assert.ok(find(x,'a:srgbClr').some(c=>val(c,'val')==='E8F1FE'))],
    ['setStroke',()=>[{op:'setStroke',target:{slide:0,el:'e_2'},stroke:{color:'#3182F6',widthEmu:12700}}],async x=>assert.ok(find(x,'a:ln').some(c=>val(c,'w')==='12700'))],
    ['setTableCell',n=>[{op:'setTableCell',target:{slide:0,el:'e_4'},row:1,col:1,paragraphs:[{runs:[{text:String(25*n)}]}]}],async(x,_p,n)=>assert.ok(find(x,'a:tc').some(c=>JSON.stringify(c).includes(`\"${25*n}\"`)))],
    ['tableMerge',()=>[{op:'tableMerge',target:{slide:0,el:'e_4'},kind:'merge-right',row:0,col:0}],async x=>assert.ok(find(x,'a:tc').some(c=>val(c,'gridSpan')==='2'))],
    ['setNotes',n=>[{op:'setNotes',target:{slide:0},text:`보존 노트\n변경 ${n}`}],async(_x,p,n)=>assert.ok((await p.z.file('ppt/notesSlides/notesSlide1.xml').async('string')).includes(`변경 ${n}`))],
    ['duplicateSlide',()=>[{op:'duplicateSlide',target:{slide:0}}],async(_x,p)=>assert.equal(find(await p.xml('ppt/presentation.xml'),'p:sldId').length,4)],
    ['moveSlide',()=>[{op:'moveSlide',target:{slide:2},to:0}],async(_x,p)=>{const ids=find(await p.xml('ppt/presentation.xml'),'p:sldId');assert.equal(ids.length,3);assert.equal(val(ids[0],'r:id'),'rId4');}],
    ['deleteSlide',()=>[{op:'deleteSlide',target:{slide:2}}],async(_x,p)=>assert.equal(find(await p.xml('ppt/presentation.xml'),'p:sldId').length,2)]
  ].map(([op,ops,inspect])=>caseOf('powerpoint',op,ops,async(bytes,n)=>{const p=await parts(bytes);await inspect(await p.xml('ppt/slides/slide1.xml'),p,n);})),
  ...['alignElements','distributeElements','groupElements','ungroupElement'].map(op=>caseOf('powerpoint',op,(_n,obs)=>{
    const els=obs.pages[0].elements.slice(-3).map(e=>e.id);
    if(op==='alignElements')return [{op,target:{slide:0},els,mode:'top',to:'selection'}];
    if(op==='distributeElements')return [{op,target:{slide:0},els,axis:'horizontal',to:'selection'}];
    if(op==='groupElements')return [{op,target:{slide:0},els}];
    return [{op:'groupElements',target:{slide:0},els}];
  },async(bytes,_n,obs)=>{
    const p=await parts(bytes),x=await p.xml('ppt/slides/slide1.xml');
    if(op==='groupElements')assert.ok(find(x,'p:grpSp').length);
    else if(op==='ungroupElement')assert.equal(find(x,'p:grpSp').length,0);
    else {const es=obs.pages[0].elements.slice(-3),positions=es.map(e=>e.box);if(op==='alignElements')assert.equal(new Set(positions.map(e=>e.y)).size,1);else assert.equal(positions[1].x-positions[0].x-positions[0].cx,positions[2].x-positions[1].x-positions[1].cx);}
  },async(session,n,signal)=>{let r=await session.read(signal);await session.apply(addShapes(n),r.revision,signal);})),
];
export async function inspectPreservation(domain,before,after,n,op){
  const a=await parts(before),b=await parts(after);
  if(domain==='word'){
    const x=await b.z.file('word/document.xml').async('string');assert.ok(x.includes(`보존 문구 ${n}`));
    const originalParagraph=find(await a.xml('word/document.xml'),'w:p').find(p=>JSON.stringify(p).includes(`보존 문구 ${n}`)),afterParagraph=find(await b.xml('word/document.xml'),'w:p').find(p=>JSON.stringify(p).includes(`보존 문구 ${n}`));assert.deepEqual(afterParagraph,originalParagraph);
  }else if(domain==='excel'){
    const load=async bytes=>{const w=new ExcelJS.Workbook();await w.xlsx.load(bytes);return w;};const first=await load(before),last=await load(after);
    for(const addr of ['A2','B2','A3','B3','A4','B4'])assert.deepEqual(last.getWorksheet('데이터').getCell(addr).value,first.getWorksheet('데이터').getCell(addr).value);
    assert.equal(last.getWorksheet('보존').getCell('A1').value,`보존 문구 ${n}`);
  }else {
    assert.equal(await b.z.file('ppt/slides/slide2.xml').async('string'),await a.z.file('ppt/slides/slide2.xml').async('string'));
    if(op!=='setNotes')assert.equal(await b.z.file('ppt/notesSlides/notesSlide1.xml').async('string'),await a.z.file('ppt/notesSlides/notesSlide1.xml').async('string'));
  }
}
export {parts,find};
