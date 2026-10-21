// Synthetic Excel and PowerPoint forms for the capture tests. Nothing here comes from a company document.
import JSZip from 'jszip';

export const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==','base64');

/** A two-sheet quote form: styles, a formula, a merge, a validation, a defined name, a picture and a hidden sheet. */
export async function xlsxFixture(){
  const {default:ExcelJS}=await import('exceljs');
  const book=new ExcelJS.Workbook(),quote=book.addWorksheet('견적서',{properties:{tabColor:{argb:'FF1F3864'}}});
  quote.getCell('A1').value='견 적 서';quote.getCell('A1').font={name:'맑은 고딕',size:16,bold:true,color:{argb:'FF1F3864'}};quote.mergeCells('A1:D1');
  quote.getCell('A1').alignment={horizontal:'center',vertical:'middle'};
  quote.getCell('A3').value='품목';quote.getCell('B3').value='수량';quote.getCell('C3').value='단가';quote.getCell('D3').value='금액';
  for(const address of ['A3','B3','C3','D3']){quote.getCell(address).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFD9E1F2'}};quote.getCell(address).font={bold:true};quote.getCell(address).border={bottom:{style:'thin',color:{argb:'FF000000'}}};}
  quote.getCell('A4').value='(품목 입력)';quote.getCell('B4').value=0;quote.getCell('C4').value=0;quote.getCell('C4').numFmt='#,##0';
  quote.getCell('D4').value={formula:'B4*C4',result:0};quote.getCell('D4').numFmt='#,##0';
  quote.getCell('A6').value='합계';quote.getCell('D6').value={formula:'SUM(D4:D5)',result:0};quote.getCell('D6').numFmt='#,##0';quote.getCell('D6').font={bold:true,color:{argb:'FFFF0000'}};
  quote.getCell('B8').dataValidation={type:'list',allowBlank:true,formulae:['"현금,카드"']};quote.getCell('A8').value='결제';
  quote.getColumn(1).width=24;quote.getRow(1).height=30;
  book.definedNames.add("'견적서'!$D$6",'합계금액');
  const image=book.addImage({buffer:PNG,extension:'png'});quote.addImage(image,'F1:G3');
  const hidden=book.addWorksheet('코드',{state:'hidden'});hidden.getCell('A1').value='현금';hidden.getCell('A2').value='카드';
  return Buffer.from(await book.xlsx.writeBuffer());
}

const NS='xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const shape=(id,name,{ph,x,y,cx,cy,runs})=>`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr>${ph?`<p:ph type="${ph}"/>`:''}</p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:p>${runs.map(r=>`<a:r><a:rPr lang="ko-KR"${r.size?` sz="${r.size*100}"`:''}${r.bold?' b="1"':''}>${r.color?`<a:solidFill><a:srgbClr val="${r.color}"/></a:solidFill>`:''}${r.font?`<a:ea typeface="${r.font}"/>`:''}</a:rPr><a:t>${r.text}</a:t></a:r>`).join('')}</a:p></p:txBody></p:sp>`;
/** Two slides: a title slide with formatted runs, and a content slide with a picture, a table and notes. */
export async function pptxFixture(){
  const zip=new JSZip();
  zip.file('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>');
  zip.file('_rels/.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  zip.file('ppt/presentation.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>`);
  zip.file('ppt/_rels/presentation.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="${REL}/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="${REL}/slide" Target="slides/slide2.xml"/></Relationships>`);
  zip.file('ppt/slideLayouts/slideLayout1.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ${NS}><p:cSld name="제목 슬라이드"><p:spTree/></p:cSld></p:sldLayout>`);
  zip.file('ppt/slideLayouts/slideLayout2.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ${NS}><p:cSld name="제목 및 내용"><p:spTree/></p:cSld></p:sldLayout>`);
  zip.file('ppt/slides/slide1.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="F2F2F2"/></a:solidFill></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shape(2,'제목 1',{ph:'ctrTitle',x:914400,y:914400,cx:10363200,cy:1470025,runs:[{text:'주간 보고',size:40,bold:true,color:'1F3864',font:'맑은 고딕'}]})}${shape(3,'부제목 2',{ph:'subTitle',x:1828800,y:2743200,cx:8534400,cy:1752600,runs:[{text:'작성자: '},{text:'(이름 입력)',color:'FF0000'}]})}</p:spTree></p:cSld></p:sld>`);
  zip.file('ppt/slides/_rels/slide1.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`);
  zip.file('ppt/slides/slide2.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shape(2,'제목 1',{ph:'title',x:457200,y:274638,cx:8229600,cy:1143000,runs:[{text:'금주 실적'}]})}<p:pic><p:nvPicPr><p:cNvPr id="4" name="로고" descr="회사 로고"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/></p:blipFill><p:spPr><a:xfrm><a:off x="10668000" y="152400"/><a:ext cx="1270000" cy="635000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="5" name="표 1"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="457200" y="1600200"/><a:ext cx="8229600" cy="1480000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tr h="370000"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr b="1"/><a:t>업무</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:rPr b="1"/><a:t>결과</a:t></a:r></a:p></a:txBody></a:tc></a:tr><a:tr h="370000"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>(업무 입력)</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:bodyPr/><a:p/></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`);
  zip.file('ppt/slides/_rels/slide2.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/slideLayout" Target="../slideLayouts/slideLayout2.xml"/><Relationship Id="rId2" Type="${REL}/image" Target="../media/image1.png"/><Relationship Id="rId3" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`);
  zip.file('ppt/notesSlides/notesSlide1.xml',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes ${NS}><p:cSld><p:spTree>${shape(2,'슬라이드 노트',{ph:'body',x:0,y:0,cx:100,cy:100,runs:[{text:'실적은 표로만 적는다.'}]})}</p:spTree></p:cSld></p:notes>`);
  zip.file('ppt/media/image1.png',PNG);
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
