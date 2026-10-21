// Synthetic Word forms for tests (document forms plan Task A): the same block grammar the Office simulated host uses,
// assembled into a real docx with jszip. Nothing here comes from a company document.
import JSZip from 'jszip';

const escape=text=>String(text??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const BUILT_IN={Normal:{name:'Normal'},Title:{name:'Title'},Heading1:{name:'heading 1',outline:0},Heading2:{name:'heading 2',outline:1},Heading3:{name:'heading 3',outline:2}};
const styleId=name=>BUILT_IN[name]?name:'Custom'+Buffer.from(name).toString('hex');

function run(span){
  const props=[span.font?`<w:rFonts w:ascii="${escape(span.font)}" w:eastAsia="${escape(span.font)}"/>`:'',span.bold?'<w:b/>':'',span.italic?'<w:i/>':'',span.color?`<w:color w:val="${span.color}"/>`:'',span.size?`<w:sz w:val="${span.size*2}"/>`:''].join('');
  if(span.image){const {rId,cx,cy,name}=span.image;return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="${escape(name)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="${escape(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;}
  return `<w:r>${props?`<w:rPr>${props}</w:rPr>`:''}<w:t xml:space="preserve">${escape(span.text)}</w:t></w:r>`;
}
function paragraph(p,lists){
  const spans=Array.isArray(p.runs)?p.runs:[{text:p.text??'',bold:!!p.bold}];
  let props=p.style?`<w:pStyle w:val="${styleId(p.style)}"/>`:'';
  if(p.list){const numId=lists.numId(p.list);props+=`<w:numPr><w:ilvl w:val="${(p.list.level??1)-1}"/><w:numId w:val="${numId}"/></w:numPr>`;}
  return `<w:p>${props?`<w:pPr>${props}</w:pPr>`:''}${spans.filter(s=>s.text||s.image).map(run).join('')}</w:p>`;
}
function table(rows,lists){
  const columns=Math.max(...rows.map(row=>row.reduce((n,cell)=>n+(typeof cell==='object'&&cell.span?cell.span:1),0)));
  const grid=Array.from({length:columns},()=>'<w:gridCol w:w="2000"/>').join('');
  const body=rows.map(row=>'<w:tr>'+row.map(cell=>{
    const value=typeof cell==='string'?{text:cell}:cell,span=value.span??1,width=value.width??2000*span;
    const props=`<w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${span>1?`<w:gridSpan w:val="${span}"/>`:''}</w:tcPr>`;
    return `<w:tc>${props}${paragraph({text:value.text,runs:value.runs,bold:value.bold,style:value.style},lists)}</w:tc>`;
  }).join('')+'</w:tr>').join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${body}</w:tbl>`;
}
function contentControl(control,lists){
  const props=[control.tag?`<w:tag w:val="${escape(control.tag)}"/>`:'',control.title?`<w:alias w:val="${escape(control.title)}"/>`:'',control.type==='date'?'<w:date/>':control.type==='dropdown'?'<w:dropDownList/>':control.type==='text'?'<w:text/>':'',control.placeholder?'<w:showingPlcHdr/>':''].join('');
  return `<w:sdt><w:sdtPr>${props}</w:sdtPr><w:sdtContent>${paragraph({text:control.text??''},lists)}</w:sdtContent></w:sdt>`;
}
function stylesXml(names){
  const custom=names.filter(name=>!BUILT_IN[name]);
  const built=Object.entries(BUILT_IN).map(([id,def])=>`<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${def.name}"/>${def.outline!==undefined?`<w:pPr><w:outlineLvl w:val="${def.outline}"/></w:pPr>`:''}${id==='Title'?'<w:rPr><w:sz w:val="52"/></w:rPr>':''}</w:style>`).join('');
  const extra=custom.map(name=>`<w:style w:type="paragraph" w:styleId="${styleId(name)}"><w:name w:val="${escape(name)}"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${built}${extra}</w:styles>`;
}
function numberingXml(lists){
  const formats={decimal:['decimal','%1.'],paren:['decimal','%1)'],hangul:['ganada','%1.'],bullet:['bullet','-']};
  const abstracts=[...lists.kinds].map((kind,i)=>{const [format,text]=formats[kind]??formats.decimal;return `<w:abstractNum w:abstractNumId="${i}"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/></w:lvl></w:abstractNum>`;}).join('');
  const nums=[...lists.ids.entries()].map(([,entry])=>`<w:num w:numId="${entry.numId}"><w:abstractNumId w:val="${[...lists.kinds].indexOf(entry.kind)}"/></w:num>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${abstracts}${nums}</w:numbering>`;
}

/** blocks: [{p:{text|runs,style,bold,list:{kind,id,level}}} | {table:{rows:[[cell]]}} | {control:{tag,title,type,placeholder,text}} | {image:{name,bytes,cx,cy}}]; options.header/footer add a part. */
export async function docxFromBlocks(blocks,{trailingParagraph=true,header=null,footer=null}={}){
  const media=[];
  const lists={kinds:new Set(),ids:new Map(),numId(list){const key=list.id??list.kind;this.kinds.add(list.kind);if(!this.ids.has(key))this.ids.set(key,{numId:this.ids.size+1,kind:list.kind});return this.ids.get(key).numId;}};
  const parts=[];const names=new Set();
  for(const block of blocks){
    if(block.p){if(block.p.style)names.add(block.p.style);parts.push(paragraph(block.p,lists));}
    else if(block.table){for(const row of block.table.rows)for(const cell of row)if(typeof cell==='object'&&cell.style)names.add(cell.style);parts.push(table(block.table.rows,lists));}
    else if(block.control)parts.push(contentControl(block.control,lists));
    else if(block.image){const rId='rIdImg'+(media.length+1);media.push({rId,...block.image});parts.push(paragraph({runs:[{text:'',image:{rId,cx:block.image.cx??914400,cy:block.image.cy??914400,name:block.image.name}}]},lists));}
  }
  if(trailingParagraph)parts.push('<w:p/>');
  const NS='xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
  const refs=(header?'<w:headerReference w:type="default" r:id="rIdHeader"/>':'')+(footer?'<w:footerReference w:type="default" r:id="rIdFooter"/>':'');
  const document=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${parts.join('')}<w:sectPr>${refs}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  const zip=new JSZip();
  zip.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>');
  zip.file('_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const mediaRels=media.map(m=>`<Relationship Id="${m.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`).join('');
  const partRels=(header?'<Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>':'')+(footer?'<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>':'');
  zip.file('word/_rels/document.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${mediaRels}${partRels}</Relationships>`);
  for(const m of media)zip.file('word/media/'+m.name,m.bytes);
  if(header)zip.file('word/header1.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}>${paragraph({text:header},lists)}</w:hdr>`);
  if(footer)zip.file('word/footer1.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}>${paragraph({text:footer},lists)}</w:ftr>`);
  zip.file('word/document.xml',document);
  zip.file('word/styles.xml',stylesXml([...names]));
  zip.file('word/numbering.xml',numberingXml(lists));
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}

// The synthetic forms the Office form map tests use, so a docx and the simulated host must map alike.
const label=text=>({text,bold:true});
export const GIANMUN_HEADER={table:{rows:[
  [label('문서번호'),{text:'○○팀-2026-000'},label('기안일자'),{text:'20XX. XX. XX.'}],
  [label('기안자'),'',label('결재'),''],
  [label('수신'),{text:'',span:3}],
  [label('제목'),{text:'[제목을 입력하세요]',span:3}]]}};
export const NOTE={p:{text:'※ 작성 요령: 각 항목은 개조식으로 작성합니다.',style:'본문'}};
export const FORMS={
  gianmun:[{p:{text:'기 안 문',style:'Title'}},GIANMUN_HEADER,
    {p:{text:'1. 개요',style:'Heading1'}},{p:{text:'(추진 배경과 목적을 기재)',style:'본문'}},
    {p:{text:'2. 추진 내용',style:'Heading1'}},{p:{text:'(세부 내용을 기재)',style:'본문'}},
    {p:{text:'3. 행정 사항',style:'Heading1'}},{p:{text:'(협조 요청 사항을 기재)',style:'본문'}},NOTE],
  gianmunList:[{p:{text:'기 안 문',style:'Title'}},GIANMUN_HEADER,
    {p:{text:'1. 개요',style:'Heading1'}},{p:{text:'(추진 배경을 기재)',style:'개조식 1',list:{kind:'hangul',id:'s1'}}},
    {p:{text:'2. 추진 내용',style:'Heading1'}},{p:{text:'(추진 내용을 기재)',style:'개조식 1',list:{kind:'hangul',id:'s2'}}},
    {p:{text:'3. 행정 사항',style:'Heading1'}},{p:{text:'(협조 사항을 기재)',style:'개조식 1',list:{kind:'hangul',id:'s3'}}},NOTE],
  trip:[{p:{text:'출장 결과 보고서',style:'Title'}},
    {table:{rows:[[label('출장자'),'',label('소속'),''],[label('출장지'),{text:'',span:3}],[label('출장 기간'),{text:'20XX. XX. XX. ~ 20XX. XX. XX.',span:3}]]}},
    {p:{text:'1. 출장 목적',style:'Heading1'}},{p:{text:'(출장 목적을 기재)',style:'본문'}},
    {p:{text:'2. 주요 일정',style:'Heading1'}},
    {table:{rows:[[label('일자'),label('시간'),label('내용')],['','',''],['','',''],['','','']]}},
    {p:{text:'3. 결과 및 향후 계획',style:'Heading1'}},{p:{text:'(출장 결과와 후속 조치를 기재)',style:'본문'}}],
  pumui:[{p:{text:'품 의 서',style:'Title'}},
    {table:{rows:[[label('품의 번호'),{text:'○○-2026-000'},label('품의 일자'),{text:'20XX. XX. XX.'}],[label('품의 부서'),'',label('품의자'),''],
      [label('건명'),{text:'[건명을 입력하세요]',span:3}],[label('금액'),{text:'금 ○○○원정 (₩0,000,000)',span:3}],[label('내용'),{text:'(품의 내용을 기재)',span:3}]]}},
    {p:{text:'위와 같이 품의하오니 재가하여 주시기 바랍니다.',style:'본문'}}],
  weekly:[{p:{text:'주간 업무 보고',style:'Title'}},
    {table:{rows:[[label('보고자'),'',label('보고 기간'),{text:'20XX. XX. XX. ~ XX. XX.'}]]}},
    {p:{text:'1. 금주 실적',style:'Heading1'}},{table:{rows:[[label('업무'),label('진행 결과')],['',''],['','']]}},
    {p:{text:'2. 차주 계획',style:'Heading1'}},{table:{rows:[[label('업무'),label('목표')],['',''],['','']]}},
    {p:{text:'3. 특이 사항',style:'Heading1'}},{p:{text:'(특이 사항이 없으면 "없음"으로 기재)',style:'본문'}}],
  report:[{p:{text:'업 무 보 고 서',style:'Title'}},
    {table:{rows:[[label('보고 번호'),{text:'○○팀-2026-000'},label('작성일'),{text:'20XX년 XX월 XX일'}],[label('작성자'),'',label('부서'),''],
      [label('결재'),{text:'담당: ○○○ (인)'},label('보존 기간'),'3년'],[label('제목'),{text:'[제목을 입력하세요]'},label('분류'),'일반']]}},
    {p:{text:'1. 보고 개요',style:'Heading1'}},{p:{text:'다음과 같이 보고합니다.',style:'본문'}},{p:{runs:[{text:'○ '},{text:'(보고 목적을 기재)',bold:true}],style:'본문'}},
    {p:{text:'2. 향후 계획',style:'Heading1'}},{p:{text:'(향후 계획을 기재)',style:'본문'}},{p:{text:'시행 예정일: 20XX. XX. XX.',style:'본문'}},
    {p:{text:'붙임  세부 실적 1부.  끝.',style:'본문'}}],
};
