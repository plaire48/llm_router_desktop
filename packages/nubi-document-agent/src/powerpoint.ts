import JSZip from 'jszip';
import {XMLParser} from 'fast-xml-parser';
import {createBlankPptx,BLANK_SLIDE_XML} from '../vendor/genoffice/packages/pptx-engine/src/blank';
import {generateParagraphXml} from '../vendor/genoffice/packages/pptx-engine/src/generate';
import {escapeXmlAttr} from '../vendor/genoffice/packages/pptx-engine/src/xml-utils';
import {canonical,clone,fail} from './contracts.js';
import {planDraft,record,only,plainText,draftFont} from './draft-planning.js';
import type {DraftOptions} from './draft-planning.js';
import type {AgentTransport,Json} from './types.js';
import {inspectPackage} from './generated-package.js';
import schema from './powerpoint-draft.schema.json';
export {attachGeneratedPowerPointChartWorkbooks} from './powerpoint-chart-data.js';
export const powerPointDraftSchema:Record<string,unknown>=schema;
export interface PowerPointDraft {title:string;slides:Array<{title:string;paragraphs:string[];table:{headers:string[];rows:string[][]}|null;notes:string}>}
const titleWidth=(text:string)=>Array.from(text).reduce((width,c)=>width+(c.charCodeAt(0)>255?1:.6),0);
const tableHeights=(table:NonNullable<PowerPointDraft['slides'][number]['table']>)=>[table.headers,...table.rows].map(row=>Math.max(.55,...row.map(text=>Math.ceil(text.length/Math.floor((12.1/table.headers.length*72-20)/18))*.29+.19)));
export function validatePowerPointDraft(input:unknown):asserts input is PowerPointDraft {
  const bad=()=>fail('powerpoint_draft_invalid');
  if(!record(input)||!only(input,['title','slides'])||!plainText(input.title,160)||!Array.isArray(input.slides)||!input.slides.length||input.slides.length>12)bad();
  const draft=input as unknown as PowerPointDraft;
  for(const slide of draft.slides){
    if(!record(slide)||!only(slide,['title','paragraphs','table','notes'])||!plainText(slide.title,44)||titleWidth(slide.title)>28||/[\r\n]/.test(slide.title)||!Array.isArray(slide.paragraphs)||slide.paragraphs.length>3||slide.paragraphs.some(p=>!plainText(p,90)||/[\r\n]/.test(p))||typeof slide.notes!=='string'||slide.notes.length>2000||slide.notes&&!plainText(slide.notes,2000))bad();
    if(slide.table!==null){
      const table=slide.table;
      if(!record(table)||!only(table,['headers','rows'])||!Array.isArray(table.headers)||table.headers.length<2||table.headers.length>6||table.headers.some(h=>!plainText(h,40))||!Array.isArray(table.rows)||!table.rows.length||table.rows.length>6||table.rows.some(row=>!Array.isArray(row)||row.length!==table.headers.length||row.some(c=>!plainText(c,100)))||slide.paragraphs.length>2)bad();
      if(tableHeights(table).reduce((a,b)=>a+b,0)+slide.paragraphs.length*1.05>5.1)bad();
    }else if(!slide.paragraphs.length)bad();
  }
  if(canonical(draft).length>100_000)bad();
}
const emu=(inch:number)=>Math.round(inch*914400);
const relations='http://schemas.openxmlformats.org/package/2006/relationships';
const office='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const pns='http://schemas.openxmlformats.org/presentationml/2006/main',ans='http://schemas.openxmlformats.org/drawingml/2006/main';
/** New editable plaintext deck only. Existing protected files must go through the host's Office adapter. */
export async function createPowerPointDocument(input:PowerPointDraft,signal:AbortSignal,options:DraftOptions={}) {
  if(signal.aborted)fail('operation_cancelled');validatePowerPointDraft(input);const draft=clone(input),font=draftFont(options.fontFamily),zip=await JSZip.loadAsync(await createBlankPptx());
  const para=(text:string,size:number,bold=false,color='#191F28')=>generateParagraphXml({runs:[{text,fontFamily:font,latinFamily:font,fontSize:size,bold,color}],bullet:{type:'none'},lineHeight:115,spaceAfter:0});
  const box=(id:number,name:string,text:string,x:number,y:number,w:number,h:number,size:number,bold=false,color?:string)=>`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${escapeXmlAttr(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0"/><a:lstStyle/>${para(text,size,bold,color)}</p:txBody></p:sp>`;
  let types=await zip.file('[Content_Types].xml')!.async('string');let overrides='',slideIds='',slideRels='';
  for(const [index,slide] of draft.slides.entries()){
    if(signal.aborted)fail('operation_cancelled');const n=index+1;let id=2;
    let xml=box(id++,'Title',slide.title,.6,.5,12.1,.85,30,true,'#1B64DA');
    slide.paragraphs.forEach((text,i)=>{xml+=box(id++,'Body',text,.6,1.65+i*(slide.table?1.05:1.5),12.1,slide.table?.95:1.35,slide.table?20:24);});
    if(slide.table){
      const table=slide.table,rows=[table.headers,...table.rows],heights=tableHeights(table),cols=table.headers.length,cw=emu(12.1/cols),height=heights.reduce((a,b)=>a+b,0);
      const body=rows.map((row,r)=>`<a:tr h="${emu(heights[r]!)}">${row.map(text=>`<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>${para(text,18,r===0)}</a:txBody><a:tcPr marL="91440" marR="91440" marT="73152" marB="73152" anchor="ctr"><a:solidFill><a:srgbClr val="${r===0?'E8F1FE':r%2?'FFFFFF':'F1F7FE'}"/></a:solidFill></a:tcPr></a:tc>`).join('')}</a:tr>`).join('');
      xml+=`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id++}" name="Data table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${emu(.6)}" y="${emu(1.65+slide.paragraphs.length*1.05)}"/><a:ext cx="${cw*cols}" cy="${emu(height)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="0"/><a:tblGrid>${rowCols(cols,cw)}</a:tblGrid>${body}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    }
    zip.file(`ppt/slides/slide${n}.xml`,BLANK_SLIDE_XML.replace('</p:spTree>',`${xml}</p:spTree>`));
    zip.file(`ppt/slides/_rels/slide${n}.xml.rels`,`<Relationships xmlns="${relations}"><Relationship Id="rId1" Type="${office}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${office}/notesSlide" Target="../notesSlides/notesSlide${n}.xml"/></Relationships>`);
    const notes=box(2,'Notes',slide.notes||' ',0,0,6,8,12).replace('<p:nvPr/>','<p:nvPr><p:ph type="body" idx="1"/></p:nvPr>');
    const tree=BLANK_SLIDE_XML.match(/<p:spTree>[\s\S]*?<\/p:spTree>/)![0].replace('</p:spTree>',`${notes}</p:spTree>`);
    zip.file(`ppt/notesSlides/notesSlide${n}.xml`,`<p:notes xmlns:p="${pns}" xmlns:a="${ans}" xmlns:r="${office}"><p:cSld>${tree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`);
    zip.file(`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`,`<Relationships xmlns="${relations}"><Relationship Id="rId1" Type="${office}/slide" Target="../slides/slide${n}.xml"/></Relationships>`);
    if(n>1)overrides+=`<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`;
    overrides+=`<Override PartName="/ppt/notesSlides/notesSlide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`;
    slideIds+=`<p:sldId id="${256+index}" r:id="rId${n+1}"/>`;slideRels+=`<Relationship Id="rId${n+1}" Type="${office}/slide" Target="slides/slide${n}.xml"/>`;
  }
  zip.file('[Content_Types].xml',types.replace('</Types>',`${overrides}</Types>`));
  const presentation=await zip.file('ppt/presentation.xml')!.async('string');zip.file('ppt/presentation.xml',presentation.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,`<p:sldIdLst>${slideIds}</p:sldIdLst>`));
  zip.file('ppt/_rels/presentation.xml.rels',`<Relationships xmlns="${relations}"><Relationship Id="rId1" Type="${office}/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slideRels}</Relationships>`);
  const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});if(signal.aborted)fail('operation_cancelled');
  return {bytes,engine:'genoffice' as const,savedToOffice:false as const};
}
const rowCols=(count:number,width:number)=>Array.from({length:count},()=>`<a:gridCol w="${width}"/>`).join('');
type X=Record<string,any>;
const array=(x:any):X[]=>x===undefined?[]:Array.isArray(x)?x:[x];
const all=(node:any,key:string):any[]=>!node||typeof node!=='object'?[]:Object.entries(node).flatMap(([k,v])=>k===key?array(v):Array.isArray(v)?v.flatMap(n=>all(n,key)):all(v,key));
const texts=(node:any):string[]=>all(node,'a:t').map(x=>typeof x==='object'?String(x['#text']??''):String(x));
/** Structural readback of new plaintext output only, never the Office/NASCA observation boundary. */
export async function inspectGeneratedPowerPoint(bytes:Uint8Array) {
  try{
    const pkg=await inspectPackage(bytes,'powerpoint'),parser=new XMLParser({ignoreAttributes:false,parseTagValue:false});
    const part=async(path:string)=>{const file=pkg.zip.file(path);if(!file)fail('generated_powerpoint_invalid');return parser.parse(await file.async('string'));};
    const presentation=(await part('ppt/presentation.xml'))['p:presentation'],rels=array((await part('ppt/_rels/presentation.xml.rels')).Relationships.Relationship),slides=[];
    for(const item of array(presentation['p:sldIdLst']['p:sldId'])){
      const rel=rels.find(r=>r['@_Id']===item['@_r:id']),target=String(rel?.['@_Target']);if(!/^slides\/slide\d+\.xml$/.test(target))fail('generated_powerpoint_invalid');
      const slide=await part('ppt/'+target),number=target.match(/slide(\d+)/)![1],notes=await part(`ppt/notesSlides/notesSlide${number}.xml`);
      const shapes=all(slide,'p:sp');slides.push({title:texts(shapes[0]).join(''),texts:shapes.flatMap(texts),tables:all(slide,'a:tbl').map(tbl=>({rows:array(tbl['a:tr']).map(row=>array(row['a:tc']).map(cell=>texts(cell).join('')))})),notes:texts(notes).join('')});
    }
    return {slides,hasExternalRelationships:pkg.hasExternalRelationships,hasMacros:pkg.hasMacros};
  }catch{return fail('generated_powerpoint_invalid');}
}
export async function preparePowerPointDocument(input:{request:string;sources:Json},transport:AgentTransport,signal:AbortSignal,options:DraftOptions={}) {
  const draft=await planDraft<PowerPointDraft>('powerpoint',input,transport,signal,powerPointDraftSchema,validatePowerPointDraft,'Submit concise slide titles, up to 3 short paragraphs, optional editable tables and source notes. Split crowded content across slides. Preserve source uncertainty and use no images, scripts, raw XML or external links.',options);
  return {...await createPowerPointDocument(draft,signal,options),draft,finalSaveRequired:true as const};
}
