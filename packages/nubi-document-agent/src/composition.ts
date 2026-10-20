import JSZip from 'jszip';import ExcelJS from 'exceljs';
import {buildBlankDocx} from '../vendor/genoffice/packages/docx-engine/src/blank';
import {generateParagraphXml,generateTableModelXml} from '../vendor/genoffice/packages/docx-engine/src/generate';
import {formulaReferences,assertAcyclic,formulaErrorDetail} from './excel-formula.js';
import {createExcelDocument,validateExcelDraft} from './excel.js';import type {ExcelDraft,ExcelCell} from './excel.js';
import {createPowerPointDocument,attachGeneratedPowerPointChartWorkbooks} from './powerpoint.js';
import {createGeneratedFileSession} from './file-operations.js';import type {FileEnginePort} from './file-operations.js';
import {planDraft,plainText,draftFont,record,only} from './draft-planning.js';import type {DraftOptions} from './draft-planning.js';
import type {AgentTransport,Json} from './types.js';import {fail,canonical,clone} from './contracts.js';
export type CompositionDomain='word'|'excel'|'powerpoint';
export type CompositionPlan=Record<string,any>;
export type CompositionData=Record<string,Array<Record<string,string|number|boolean|null>>>;
const text=(max=2000)=>({type:'string',minLength:1,maxLength:max}),number={type:'number'},color={type:'string',pattern:'^#[0-9A-Fa-f]{6}$'};
const array=(items:unknown,maxItems=100)=>({type:'array',maxItems,items});
const object=(properties:Record<string,unknown>,required:string[])=>({type:'object',additionalProperties:false,properties,required});
const formulaText={...text(8192),description:'Excel 2016 formula, optional leading equals. A1, whole-column and whole-row references are supported; Microsoft 365 dynamic-array functions and spill syntax are unavailable.'};
const format={type:'string',enum:['general','integer','decimal','percent','date']};
const cellSchema=object({address:text(8),value:{type:['string','number','boolean','null']},formula:formulaText,format,role:{type:'string',enum:['body','title','header','input','total']}},['address']);
const tableSchema=object({row:{type:'integer',minimum:1,maximum:399},col:{type:'integer',minimum:1,maximum:20},dataset:text(80),columns:array(object({header:text(80),field:text(80),formula:formulaText,format},['header']),20)},['row','col','dataset','columns']);
export const compositionSchemas:Record<CompositionDomain,Record<string,unknown>>={
 word:object({title:text(160),header:text(160),footer:text(160),blocks:array(object({kind:{type:'string',enum:['paragraph','table','section','pageBreak']},style:{type:'string',enum:['title','heading1','heading2','body','caption']},text:text(3000),bold:{type:'boolean'},orientation:{type:'string',enum:['portrait','landscape']},fontSize:{type:'number',minimum:9,maximum:36,description:'Points. Tables allow 9..14; paragraphs allow 9..36.'},lineSpacing:{type:'number',minimum:1,maximum:2,description:'Paragraph or table cell paragraph line-spacing multiplier.'},spaceBefore:{type:'number',minimum:0,maximum:36,description:'Points before each paragraph, including table cell paragraphs; not table outer margin.'},spaceAfter:{type:'number',minimum:0,maximum:36,description:'Points after each paragraph, including table cell paragraphs; not table outer margin.'},keepTogether:{type:'boolean',description:'Keep a short table on one page. Large tables should span pages with repeated headers.'},widths:{...array(number,12),description:'Column widths in centimeters, not inches or proportions. Available total width: portrait 17cm, landscape 25.5cm. Size columns for readable text and unbroken numbers.'},headers:array(text(120),12),rows:array(array(text(1000),12),100)},['kind']),160)},['title','blocks']),
 excel:object({title:text(160),sheets:array(object({name:text(31),widths:array({type:'number',minimum:10,maximum:65},20),cells:array(cellSchema,1000),tables:array(tableSchema,8),merges:array(text(24),20),freezeRows:{type:'integer',minimum:0,maximum:40},orientation:{type:'string',enum:['portrait','landscape']},paper:{type:'string',enum:['A4','A3']},printHeaderRows:text(8),fitToHeight:{type:'integer',minimum:0,maximum:20}},['name','widths']),8),outputs:array(object({metric:text(80),sheet:text(31),cell:text(8)},['metric','sheet','cell']),40)},['title','sheets','outputs']),
 powerpoint:object({title:text(160),slides:array(object({background:color,notes:text(2000),elements:array(object({kind:{type:'string',enum:['text','shape','table','chart']},x:number,y:number,w:number,h:number,text:text(1500),fontSize:number,bold:{type:'boolean'},color,fill:color,shape:{type:'string',enum:['rect','roundRect','ellipse','rightArrow','chevron','lineArrow']},headers:array(text(80),8),rows:array(array(text(200),8),10),categories:array(text(40),24),series:array(object({name:text(80),values:array(number,24)},['name','values']),6),chartType:{type:'string',enum:['bar','line']}},['kind','x','y','w','h']),40)},['notes','elements']),12)},['title','slides'])
};
const safe=(value:unknown):void=>{if(Array.isArray(value)){value.forEach(safe);return;}if(record(value))for(const [k,v]of Object.entries(value)){if(/^(?:__proto__|constructor|prototype|path|url|script|html|bytes|image|sourcePath)$/i.test(k))fail('composition_unsupported');safe(v);}else if(typeof value==='number'&&!Number.isFinite(value))fail('composition_invalid');};
const keys=(value:any,allowed:string[])=>{if(!record(value)||!only(value,allowed))fail('composition_unknown_field');};
const words=(value:unknown,max=3000)=>{if(!plainText(value,max))fail('composition_text_invalid');};
const explicitLineCount=(text:string)=>text.split(/\r\n?|\n/).length;
export function validateComposition(domain:CompositionDomain,p:unknown):asserts p is CompositionPlan{
 if(!record(p)||canonical(p).length>400_000)fail('composition_invalid');safe(p);words(p.title,160);
 if(domain==='word'){
  keys(p,['title','header','footer','blocks']);if(p.header!==undefined)words(p.header,160);if(p.footer!==undefined)words(p.footer,160);
  if(!Array.isArray(p.blocks)||!p.blocks.length||p.blocks.length>160)fail('composition_invalid');let orientation='portrait';
  for(const b of p.blocks){
   if(b.kind==='paragraph'){keys(b,['kind','style','text','bold','fontSize','lineSpacing','spaceBefore','spaceAfter']);for(const [key,min,max]of [['fontSize',9,36],['lineSpacing',1,2],['spaceBefore',0,36],['spaceAfter',0,36]] as const)if(b[key]!==undefined&&(!Number.isFinite(b[key])||b[key]<min||b[key]>max))fail('composition_invalid');words(b.text);if(!['title','heading1','heading2','body','caption'].includes(b.style??'body')||b.bold!==undefined&&typeof b.bold!=='boolean')fail('composition_invalid');}
   else if(b.kind==='section'){keys(b,['kind','orientation']);if(!['portrait','landscape'].includes(b.orientation))fail('composition_invalid');orientation=b.orientation;}
   else if(b.kind==='pageBreak')keys(b,['kind']);
   else if(b.kind==='table'){
    keys(b,['kind','widths','headers','rows','fontSize','keepTogether','lineSpacing','spaceBefore','spaceAfter']);for(const [key,min,max]of [['lineSpacing',1,2],['spaceBefore',0,36],['spaceAfter',0,36]] as const)if(b[key]!==undefined&&(!Number.isFinite(b[key])||b[key]<min||b[key]>max))fail('composition_invalid');if(b.fontSize!==undefined&&(!Number.isFinite(b.fontSize)||b.fontSize<9||b.fontSize>14)||b.keepTogether!==undefined&&typeof b.keepTogether!=='boolean')fail('composition_invalid');if(!Array.isArray(b.headers)||b.headers.length<2||b.headers.length>12||!Array.isArray(b.widths)||b.widths.length!==b.headers.length||b.widths.some((x:any)=>!Number.isFinite(x)||x<.6)||b.widths.reduce((a:number,x:number)=>a+x,0)>(orientation==='landscape'?25.5:17)+1e-9)fail('composition_table_width');
    b.headers.forEach((t:any)=>words(t,120));if(!Array.isArray(b.rows)||!b.rows.length||b.rows.length>100)fail('composition_invalid');for(const row of b.rows){if(!Array.isArray(row)||row.length!==b.headers.length)fail('composition_table_shape');row.forEach((t:any)=>words(t,1000));}
   }else fail('composition_invalid');
  }
 }else if(domain==='excel'){
  keys(p,['title','sheets','outputs']);if(!Array.isArray(p.sheets)||!p.sheets.length||p.sheets.length>8||!Array.isArray(p.outputs)||p.outputs.length>40)fail('composition_invalid');
  for(const s of p.sheets){keys(s,['name','widths','cells','tables','merges','freezeRows','orientation','paper','printHeaderRows','fitToHeight']);words(s.name,31);if(!Array.isArray(s.widths)||!s.widths.length||s.widths.length>20||s.widths.some((x:any)=>!Number.isFinite(x)||x<10||x>65)||s.paper!==undefined&&!['A4','A3'].includes(s.paper)||s.printHeaderRows!==undefined&&!/^([1-9]|[1-3]\d|40):([1-9]|[1-3]\d|40)$/.test(s.printHeaderRows))fail('composition_invalid');
   if(s.fitToHeight!==undefined&&(!Number.isInteger(s.fitToHeight)||s.fitToHeight<0||s.fitToHeight>20))fail('composition_invalid');
   if((s.cells?.length??0)>1000||(s.tables?.length??0)>8||(s.merges?.length??0)>20||s.freezeRows!==undefined&&(!Number.isInteger(s.freezeRows)||s.freezeRows<0||s.freezeRows>40)||s.orientation!==undefined&&!['portrait','landscape'].includes(s.orientation))fail('composition_invalid');
   for(const c of s.cells??[]){keys(c,['address','value','formula','format','role']);address(c.address);if(Object.hasOwn(c,'value')===Object.hasOwn(c,'formula'))fail('composition_cell_invalid');if(c.formula!==undefined)words(c.formula,8192);}
   for(const t of s.tables??[]){keys(t,['row','col','dataset','columns']);words(t.dataset,80);if(!Number.isInteger(t.row)||!Number.isInteger(t.col)||t.row<1||t.col<1||t.row>399||!Array.isArray(t.columns)||!t.columns.length||t.col+t.columns.length-1>s.widths.length)fail('composition_table_shape');for(const c of t.columns){keys(c,['header','field','formula','format']);words(c.header,80);if(Object.hasOwn(c,'field')===Object.hasOwn(c,'formula'))fail('composition_cell_invalid');words(c.field??c.formula,c.formula?8192:80);}}
   for(const m of s.merges??[])if(!/^[A-T][1-9]\d{0,2}:[A-T][1-9]\d{0,2}$/.test(m))fail('composition_invalid');
  }
  const names=new Set(p.sheets.map((s:any)=>s.name));const metrics=new Set();for(const o of p.outputs){keys(o,['metric','sheet','cell']);words(o.metric,80);address(o.cell);if(!names.has(o.sheet)||metrics.has(o.metric))fail('composition_output_invalid');metrics.add(o.metric);}
 }else if(domain==='powerpoint'){
  keys(p,['title','slides']);if(!Array.isArray(p.slides)||!p.slides.length||p.slides.length>12)fail('composition_invalid');
  for(const slide of p.slides){keys(slide,['background','notes','elements']);words(slide.notes,2000);if(slide.background!==undefined&&!/^#[0-9a-f]{6}$/i.test(slide.background)||!Array.isArray(slide.elements)||!slide.elements.length||slide.elements.length>40)fail('composition_invalid');
   for(const e of slide.elements){keys(e,['kind','x','y','w','h','text','fontSize','bold','color','fill','shape','headers','rows','categories','series','chartType']);if(![e.x,e.y,e.w,e.h].every(Number.isFinite)||e.x<0||e.y<0||e.w<=0||e.h<=0||e.x+e.w>13.33||e.y+e.h>7.5)fail('composition_geometry');
    for(const c of [e.color,e.fill])if(c!==undefined&&!/^#[0-9a-f]{6}$/i.test(c))fail('composition_invalid');
    if(e.kind==='text'||e.kind==='shape'){
     if(e.kind==='text'||e.text){words(e.text,1500);if(!Number.isFinite(e.fontSize)||e.fontSize<10||e.fontSize>72||e.h<e.fontSize/72*1.15*explicitLineCount(e.text))fail('composition_text_fit');}
     if(e.kind==='shape'&&!['rect','roundRect','ellipse','rightArrow','chevron','lineArrow'].includes(e.shape))fail('composition_invalid');
    }else if(e.kind==='table'){
     if(!Array.isArray(e.headers)||e.headers.length<2||e.headers.length>8||!Array.isArray(e.rows)||!e.rows.length||e.rows.length>10||e.rows.some((r:any)=>!Array.isArray(r)||r.length!==e.headers.length))fail('composition_table_shape');
     if(!Number.isFinite(e.fontSize)||e.fontSize<14||e.fontSize>28||e.h<(e.rows.length+1)*e.fontSize/72*1.6)fail('composition_text_fit');[...e.headers,...e.rows.flat()].forEach(t=>words(t,200));
    }else if(e.kind==='chart'){
     if(!['bar','line'].includes(e.chartType)||!Array.isArray(e.categories)||!e.categories.length||e.categories.length>24||!Array.isArray(e.series)||!e.series.length||e.series.length>6||e.w<3||e.h<2)fail('composition_chart_invalid');e.categories.forEach((c:any)=>words(c,40));for(const s of e.series){keys(s,['name','values']);words(s.name,80);if(!Array.isArray(s.values)||s.values.length!==e.categories.length||!s.values.every(Number.isFinite))fail('composition_chart_invalid');}
    }else fail('composition_invalid');
   }
  }
 }else fail('composition_invalid');
}
const esc=(v:unknown)=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export async function composeWord(plan:CompositionPlan,signal:AbortSignal,options:DraftOptions={}){
 validateComposition('word',plan);if(signal.aborted)fail('operation_cancelled');const font=draftFont(options.fontFamily),zip=await JSZip.loadAsync(await buildBlankDocx({eastAsiaFont:font,paperSize:'A4'}));
 const ctx={headingStyleIds:new Map([[1,'Heading1'],[2,'Heading2']]),allocateHyperlinkRel:()=>fail('composition_unsupported')};
 const section=(orientation:string)=>`<w:sectPr><w:headerReference w:type="default" r:id="rIdNubiHeader"/><w:footerReference w:type="default" r:id="rIdNubiFooter"/><w:type w:val="nextPage"/><w:pgSz w:w="${orientation==='landscape'?16838:11906}" w:h="${orientation==='landscape'?11906:16838}" w:orient="${orientation}"/><w:pgMar w:top="1134" w:bottom="1134" w:left="1134" w:right="1134" w:header="567" w:footer="567"/></w:sectPr>`;
 let body='',orientation='portrait';for(const [blockIndex,b] of plan.blocks.entries()){
  if(b.kind==='section'){
   if(!plan.blocks.slice(blockIndex+1).some((next:any)=>next.kind==='paragraph'||next.kind==='table'))continue;
   if(body)body+=`<w:p><w:pPr>${section(orientation)}</w:pPr></w:p>`;orientation=b.orientation;
  }
  if(b.kind==='pageBreak')body+='<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  if(b.kind==='paragraph'){const style=b.style??'body',size=b.fontSize!==undefined?b.fontSize*2:({title:38,heading1:28,heading2:24,body:22,caption:19}[style as 'title']??22);body+=generateParagraphXml({type:'paragraph',styleId:({title:'Title',heading1:'Heading1',heading2:'Heading2'} as Record<string,string>)[style],format:{spaceBefore:b.spaceBefore!==undefined?b.spaceBefore*20:style.startsWith('heading')?180:0,spaceAfter:b.spaceAfter!==undefined?b.spaceAfter*20:120,lineSpacing:b.lineSpacing??1.25,keepNext:['title','heading1','heading2','caption'].includes(style)},runs:[{text:b.text,bold:b.bold??style!=='body',font,eastAsiaFont:font,fontAscii:font,color:'000000',sizeHalfPoints:size}]},ctx);}
  if(b.kind==='table'){const widths=b.widths.map((cm:number)=>Math.round(cm*1440/2.54)),rows=[b.headers,...b.rows];body+=generateTableModelXml({rows:rows.map((r:string[],i:number)=>r.map(t=>({paras:[t],vAlign:'center' as const,fill:i===0?'E8F1FE':i%2?'FFFFFF':'F6F8FA',richParas:[{runs:[{text:t,font,eastAsiaFont:font,fontAscii:font,sizeHalfPoints:(b.fontSize??10)*2,bold:i===0,color:'000000'}],lineSpacing:b.lineSpacing??1.15,spaceBefore:b.spaceBefore!==undefined?b.spaceBefore*20:0,spaceAfter:b.spaceAfter!==undefined?b.spaceAfter*20:50,...(b.keepTogether?{keepNext:i<rows.length-1}:{})}]}))),colWidthsTwips:widths,fixedLayout:true,autoFit:'fixed',repeatHeaderRows:rows.map((_:unknown,i:number)=>i===0),rowCantSplit:rows.map(()=>true),cellMarTwips:{top:100,bottom:100,left:100,right:100}})+'<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr></w:p>';}
 }
 body+=section(orientation);const original=await zip.file('word/document.xml')!.async('string');zip.file('word/document.xml',original.replace(/<w:body>[\s\S]*?<\/w:body>/,`<w:body>${body}</w:body>`).replace(/w:color="000000"(?=[^>]*\/?>)/g,'w:color="D9D9D9"'));
 const para=(value:string)=>value.split(/(\{PAGE\}|\{NUMPAGES\})/).map(t=>/^\{(PAGE|NUMPAGES)\}$/.test(t)?`<w:fldSimple w:instr="${t.slice(1,-1)}"><w:r><w:t>1</w:t></w:r></w:fldSimple>`:`<w:r><w:rPr><w:rFonts w:ascii="${esc(font)}" w:eastAsia="${esc(font)}"/><w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`).join('');
 for(const kind of ['header','footer']){const tag=kind==='header'?'hdr':'ftr';zip.file(`word/${kind}1.xml`,`<w:${tag} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/></w:pPr>${para(plan[kind]??(kind==='footer'?'{PAGE} / {NUMPAGES}':''))}</w:p></w:${tag}>`);}
 let rels=await zip.file('word/_rels/document.xml.rels')!.async('string');for(const kind of ['Header','Footer'])rels=rels.replace('</Relationships>',`<Relationship Id="rIdNubi${kind}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind.toLowerCase()}" Target="${kind.toLowerCase()}1.xml"/></Relationships>`);zip.file('word/_rels/document.xml.rels',rels);
 let types=await zip.file('[Content_Types].xml')!.async('string');for(const kind of ['header','footer'])types=types.replace('</Types>',`<Override PartName="/word/${kind}1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/></Types>`);zip.file('[Content_Types].xml',types);
 const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});if(signal.aborted)fail('operation_cancelled');return {bytes,savedToOffice:false as const};
}
function address(s:unknown){const m=/^([A-T])([1-9]\d{0,2})$/.exec(String(s));if(!m||Number(m[2])>400)fail('composition_address_invalid');return {row:Number(m![2]),col:m![1]!.charCodeAt(0)-64};}
function expandUnchecked(plan:CompositionPlan,data:CompositionData):ExcelDraft{
 validateComposition('excel',plan);const blank=():ExcelCell=>({value:null,formula:null,format:'general',role:'body'});
 const sheets=plan.sheets.map((s:any)=>{
  const cells=new Map<string,ExcelCell>();let maxRow=1;const put=(row:number,col:number,v:any)=>{if(row>400||col>s.widths.length||cells.has(`${row}:${col}`))fail('composition_cell_overlap');cells.set(`${row}:${col}`,{...blank(),...v});maxRow=Math.max(maxRow,row);};
  for(const c of s.cells??[]){const a=address(c.address);put(a.row,a.col,{value:c.formula!==undefined?null:c.value,formula:c.formula??null,format:c.format??'general',role:c.role??'body'});}
  for(const t of s.tables??[]){if(!Object.hasOwn(data,t.dataset)||!Array.isArray(data[t.dataset]))fail('composition_dataset_missing');const source=data[t.dataset]!;if(!source.length||source.length>399)fail('composition_dataset_invalid');
   t.columns.forEach((c:any,i:number)=>put(t.row,t.col+i,{value:c.header,role:'header'}));source.forEach((r,ri)=>t.columns.forEach((c:any,ci:number)=>{const row=t.row+ri+1;if(c.field!==undefined&&!Object.hasOwn(r,c.field))fail('composition_field_missing');put(row,t.col+ci,{value:c.formula!==undefined?null:r[c.field],formula:c.formula?.replaceAll('{row}',String(row))??null,format:c.format??'general',role:c.formula?'body':'input'});}));
  }
  return {name:s.name,columnWidths:s.widths,rows:Array.from({length:maxRow},(_,r)=>Array.from({length:s.widths.length},(_,c)=>cells.get(`${r+1}:${c+1}`)??blank()))};
 });return {title:plan.title,sheets};
}
export function expandExcelComposition(plan:CompositionPlan,data:CompositionData):ExcelDraft{const draft=expandUnchecked(plan,data);validateExcelDraft(draft);return draft;}
/** Bounded location hints only; source cell values and executable instructions are never echoed. */
function validationHint(domain:CompositionDomain,p:unknown,data:CompositionData|undefined,code:string):string{
 if(!record(p))return '';const locations:string[]=[];
 if(domain==='powerpoint'&&code==='composition_text_fit'&&Array.isArray(p.slides))for(const [si,s]of p.slides.entries())if(record(s)&&Array.isArray(s.elements))for(const [ei,e]of s.elements.entries())if(record(e)&&['text','shape'].includes(String(e.kind))&&typeof e.text==='string'&&typeof e.fontSize==='number'&&typeof e.h==='number'){
  const lines=explicitLineCount(e.text),required=e.fontSize/72*1.15*lines;
  if(e.h<required)locations.push(`/slides/${si}/elements/${ei}: ${lines} explicit lines need at least ${required.toFixed(2)} inches at ${e.fontSize}pt; observed height ${e.h}. Enlarge this box or shorten its text; keep unrelated objects unchanged.`);
 }
 if(domain==='excel'&&Array.isArray(p.sheets)){
  if(code==='excel_draft_invalid'){
   const names=new Set<string>();
   for(const [si,s]of p.sheets.entries())if(record(s)){
    if(typeof s.name!=='string'||s.name.length>31||/[\[\]:*?/\\']/.test(s.name)||names.has(s.name.toLowerCase()))locations.push(`/sheets/${si}/name: use a unique Excel worksheet name, at most 31 characters and no []:*?/\\ or apostrophe`);
    if(typeof s.name==='string')names.add(s.name.toLowerCase());
   }
   if(!locations.length&&data)try{
    const draft=expandUnchecked(p,data);let cells=0;
    for(const [si,s]of draft.sheets.entries()){cells+=s.rows.length*s.columnWidths.length;for(const [ri,row]of s.rows.entries())for(const [ci,cell]of row.entries()){
     const label=`${s.name}!${String.fromCharCode(65+ci)}${ri+1}`;
     if(typeof cell.value==='string'&&cell.value.length>500)locations.push(`${label}: cell text exceeds 500 characters`);
     if(cell.format==='date'&&cell.formula===null&&(typeof cell.value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(cell.value)||!Number.isFinite(Date.parse(cell.value))))locations.push(`${label}: date value must be a valid YYYY-MM-DD string`);
    }if(s.rows.length>400)locations.push(`/sheets/${si}: worksheet write area exceeds 400 rows`);}
    if(cells>12000)locations.push(`/sheets: expanded write grid has ${cells} cells; limit is 12000`);
   }catch{}
  }
  for(const [si,s]of p.sheets.entries())if(record(s)&&Array.isArray(s.widths))for(const [ci,w]of s.widths.entries())if(typeof w!=='number'||w<10||w>65)locations.push(`/sheets/${si}/widths/${ci}: width must be 10..65`);
  if(!locations.length&&data&&code==='excel_formula_invalid'){
   try{const draft=expandUnchecked(p,data),graph=new Map<string,string[]>();for(const sheet of draft.sheets)for(const [r,row]of sheet.rows.entries())for(const [c,cell]of row.entries())if(cell.formula){const label=sheet.name+'!'+String.fromCharCode(65+c)+(r+1);try{const refs=formulaReferences(cell.formula,sheet.name,draft.sheets,{referenceScope:'worksheet'});graph.set(`${sheet.name}!${c+1}:${r+1}`,refs);}catch(error){locations.push(label+': '+(formulaErrorDetail(error)||'invalid formula syntax, function or out-of-range reference'));}}
    if(!locations.length){try{assertAcyclic(graph);}catch{const visited=new Set<string>(),active=new Set<string>();const visit=(n:string):boolean=>{if(active.has(n)){locations.push(n+': circular formula dependency');return true;}if(visited.has(n))return false;active.add(n);visited.add(n);for(const ref of graph.get(n)??[])if(visit(ref))return true;active.delete(n);return false;};for(const n of graph.keys())if(visit(n))break;}}
   }catch{}
  }
 }
 return locations.slice(0,6).join('; ').slice(0,1600);
}
export async function composeExcel(plan:CompositionPlan,data:CompositionData,signal:AbortSignal,options:DraftOptions={}){
 const draft=expandExcelComposition(plan,data),base=await createExcelDocument(draft,signal,options),book=new ExcelJS.Workbook();await book.xlsx.load(base.bytes as unknown as ExcelJS.Buffer);
 for(const s of plan.sheets){const sheet=book.getWorksheet(s.name)!;sheet.views=[{state:'frozen',ySplit:s.freezeRows??1,showGridLines:false}];sheet.pageSetup.orientation=s.orientation??'landscape';sheet.pageSetup.fitToHeight=s.fitToHeight??0;sheet.pageSetup.paperSize=(s.paper==='A3'?8:9) as ExcelJS.PaperSize;if(s.printHeaderRows)sheet.pageSetup.printTitlesRow=s.printHeaderRows;
  for(const merge of s.merges??[]){const [start,end]=merge.split(':').map(address);for(let r=start.row;r<=end.row;r++)for(let c=start.col;c<=end.col;c++)if((r!==start.row||c!==start.col)&&sheet.getCell(r,c).value!==null)fail('composition_merge_data_loss');sheet.mergeCells(merge);if(start.row===end.row){const cell=sheet.getCell(start.row,start.col),width=s.widths.slice(start.col-1,end.col).reduce((a:number,b:number)=>a+b,0),units=Array.from(String(cell.value??'')).reduce((v,ch)=>v+(ch.charCodeAt(0)>255?2:1),0);sheet.getRow(start.row).height=Math.max(30,Math.ceil(units/Math.max(1,width*.9))*(cell.font.size??11)*1.4+12);}}
 }const bytes=new Uint8Array(await book.xlsx.writeBuffer());if(signal.aborted)fail('operation_cancelled');return {bytes,draft,calculationRequired:true as const,savedToOffice:false as const};
}
export interface CompositionPatch {op:'add'|'replace'|'remove';path:string;value?:unknown}
/** Atomic, declarative edits to a private composition. No file paths, eval or Office write. */
function patchedComposition(plan:CompositionPlan,patches:CompositionPatch[]):CompositionPlan{
 if(!Array.isArray(patches)||!patches.length||patches.length>80||canonical(patches).length>80_000)fail('composition_patch_invalid');const next=clone(plan);
 for(const edit of patches){keys(edit,['op','path','value']);if(!['add','replace','remove'].includes(edit.op)||typeof edit.path!=='string'||!edit.path.startsWith('/')||edit.path.length>240)fail('composition_patch_invalid');const tokens=edit.path.slice(1).split('/').map(x=>x.replaceAll('~1','/').replaceAll('~0','~'));if(tokens.some(t=>['__proto__','prototype','constructor'].includes(t)||!t.length))fail('composition_patch_invalid');let owner:any=next;
  for(const token of tokens.slice(0,-1)){if(!owner||typeof owner!=='object'||!Object.hasOwn(owner,token))fail('composition_patch_invalid');owner=owner[token];}
  const key=tokens.at(-1)!;if(!owner||typeof owner!=='object')fail('composition_patch_invalid');if(Array.isArray(owner)){if(!/^(0|[1-9]\d*)$/.test(key))fail('composition_patch_invalid');const at=Number(key);if(at>owner.length||edit.op!=='add'&&at===owner.length)fail('composition_patch_invalid');if(edit.op==='add')owner.splice(at,0,clone(edit.value));else if(edit.op==='remove')owner.splice(at,1);else owner[at]=clone(edit.value);}else{if(edit.op!=='add'&&!Object.hasOwn(owner,key))fail('composition_patch_invalid');if(edit.op==='remove')delete owner[key];else owner[key]=clone(edit.value);}
 }
 return next;
}
export function applyCompositionPatch(domain:CompositionDomain,plan:CompositionPlan,patches:CompositionPatch[],datasets?:CompositionData):CompositionPlan{
 const next=patchedComposition(plan,patches);validateComposition(domain,next);if(domain==='excel'&&datasets)expandExcelComposition(next,datasets);return next;
}
/** Host-owned immutable paths. Values are compared canonically, not by key order. */
export function assertPreservedComposition(before:CompositionPlan,after:CompositionPlan,paths?:string[]):void {
 if(paths===undefined)return;
 if(!Array.isArray(paths)||paths.length>200||paths.some(path=>typeof path!=='string'||!path.startsWith('/')||path.length>240||/~(?:[^01]|$)/.test(path)))fail('composition_preservation_invalid');
 const at=(plan:CompositionPlan,path:string,baseline:boolean):unknown=>{
  const tokens=path.slice(1).split('/').map(t=>t.replaceAll('~1','/').replaceAll('~0','~'));
  if(tokens.some(t=>!t||['__proto__','prototype','constructor'].includes(t)))fail('composition_preservation_invalid');
  let value:any=plan;for(const token of tokens){if(!value||typeof value!=='object'||!Object.hasOwn(value,token))fail(baseline?'composition_preservation_invalid':'composition_preservation_changed');value=value[token];}return value;
 };
 for(const path of paths)if(canonical(at(before,path,true))!==canonical(at(after,path,false)))fail('composition_preservation_changed');
}
export async function reviseComposition(domain:CompositionDomain,input:{request:string;plan:CompositionPlan;sources:Json;datasets?:CompositionData},transport:AgentTransport,signal:AbortSignal,options:DraftOptions&{allowedPaths?:string[];preservePaths?:string[]}={}){
 const baseline=clone(input.plan),datasets=input.datasets?clone(input.datasets):undefined,sources=clone(input.sources);
 const allowedPaths=options.allowedPaths===undefined?undefined:clone(options.allowedPaths),preservePaths=options.preservePaths===undefined?undefined:clone(options.preservePaths);
 if(allowedPaths!==undefined&&(!Array.isArray(allowedPaths)||!allowedPaths.length||allowedPaths.length>48||allowedPaths.some(p=>typeof p!=='string'||!p.startsWith('/')||p.length>240)))fail('quality_repair_scope');
 assertPreservedComposition(baseline,baseline,preservePaths);
 const scopeCheck=(patches:CompositionPatch[])=>{if(!allowedPaths)return;const allowed=(path:string)=>allowedPaths.some(root=>path===root||path.startsWith(root+'/'));for(const p of patches){if(!allowed(p.path)||p.op!=='replace'&&/\/\d+$/.test(p.path)&&!allowed(p.path.slice(0,p.path.lastIndexOf('/'))))fail('quality_repair_scope');}};
 const patches=await planDraft<{patches:CompositionPatch[]}>(domain,{request:input.request,sources:{plan:baseline,evidence:sources,compositionSchema:compositionSchemas[domain] as Json,...(allowedPaths?{allowedRepairPaths:allowedPaths}:{}),...(preservePaths?{preservePaths}:{} )}},transport,signal,object({patches:array(object({op:{type:'string',enum:['add','replace','remove']},path:text(240),value:{}},['op','path']),80)},['patches']),x=>{
  if(!record(x))fail('composition_patch_invalid');const patches=x.patches as CompositionPatch[],next=applyCompositionPatch(domain,baseline,patches,datasets);scopeCheck(patches);assertPreservedComposition(baseline,next,preservePaths);
 },'Propose only the smallest JSON Pointer composition patches that fix the supplied actual verification failures. Do not redesign unrelated structure or change data, formulas or facts without a concrete reason. Paths address the private declarative plan, never filesystem paths. Respect all supplied observed repair scopes. Every preservePaths value must remain unchanged at its original index; append after the last existing array item rather than shifting protected siblings. New or replaced objects must conform to the supplied compositionSchema. Excel formulas must use Office 2016 functions and A1 references; Microsoft 365 dynamic-array functions and spill syntax are unavailable. Word widths are centimeters and paragraph spacing is points. PPT geometry is inches on a 13.33 by 7.5 canvas. Numeric array paths; use add at an array index to insert, not a dash. No code or executable content.',{...options,validationDetails:true,validationFeedback:(_draft,reason)=>reason==='quality_repair_scope'?`Only these observed paths and their descendants may change: ${allowedPaths?.join(', ')}. Array insertion/removal requires the parent array scope, because indices of unobserved siblings would shift. Resubmit a smaller patch; no patch was applied.`:reason==='composition_preservation_changed'?`A protected value or array index changed. Keep these observed paths unchanged: ${preservePaths?.slice(0,16).join(', ')}${(preservePaths?.length??0)>16?' (the complete preservePaths list is in the input)':''}. Append at the array length shown in the observed plan, after the last existing item. No patch was applied.`:reason==='composition_patch_invalid'?`JSON Pointer paths address the plan root: /${{word:'blocks',excel:'sheets',powerpoint:'slides'}[domain]}/0, not /plan or /sources. Use numeric array indices; add inserts, replace/remove require an existing location. No patch was applied.`:(()=>{try{return record(_draft)?validationHint(domain,patchedComposition(baseline,_draft.patches as CompositionPatch[]),datasets,reason):'';}catch{return '';}})()});
 const plan=applyCompositionPatch(domain,baseline,patches.patches,datasets);assertPreservedComposition(baseline,plan,preservePaths);return {plan,patches:patches.patches};
}
export async function composePowerPoint(plan:CompositionPlan,engine:FileEnginePort,signal:AbortSignal,options:DraftOptions={}){
 validateComposition('powerpoint',plan);const font=draftFont(options.fontFamily),seed=await createPowerPointDocument({title:plan.title,slides:plan.slides.map((s:any)=>({title:' ',paragraphs:[' '],table:null,notes:s.notes}))},signal,options),session=await createGeneratedFileSession({domain:'powerpoint',origin:'new_unencrypted_draft',bytes:seed.bytes},engine),emu=(n:number)=>Math.round(n*914400),rect=(e:any)=>({x:emu(e.x),y:emu(e.y),cx:emu(e.w),cy:emu(e.h)});
 const apply=async(ops:any[])=>{for(let i=0;i<ops.length;i+=75)await session.apply(ops.slice(i,i+75),session.snapshot().revision,signal);};
 try{const initial=(await session.read(signal)).observation as any;let ops:any[]=[];
  for(const [i,s]of plan.slides.entries()){
   for(const el of initial.pages[i].elements)ops.push({op:'deleteElement',target:{slide:i,el:el.id}});ops.push({op:'setBackground',target:{slide:i},kind:'solid',color:s.background??'#FFFFFF'});
   for(const e of s.elements){const target={slide:i};
    if(e.kind==='text'||e.kind==='shape')ops.push({op:'addElement',target,kind:e.kind==='text'?'textbox':e.shape,offset:rect(e),...(e.fill?{fill:e.fill}:{}),...(e.text?{paragraphs:[{runs:[{text:e.text,fontFamily:font,fontSize:e.fontSize,bold:e.bold??false,color:e.color??'#191F28'}]}]}:{}),bodyPr:{wrap:'square',anchor:'t',insetsEmu:{l:0,t:0,r:0,b:0}}});
    if(e.kind==='chart')ops.push({op:'addChart',target,kind:e.chartType,offset:rect(e),categories:e.categories,series:e.series,dataSource:'sample',...(e.text?{title:e.text}:{}),colorScheme:['#3182F6','#72B8B5','#E9B65D']});
   }
  }await apply(ops);
  // Tables need durable IDs returned by the actual engine. Never infer an element ID.
  for(const [i,s]of plan.slides.entries())for(const e of s.elements.filter((x:any)=>x.kind==='table')){
   const before=(await session.read(signal)).observation as any;const ids=new Set(before.pages[i].elements.map((x:any)=>x.id));
   // Add tables via the host-owned full engine; the same copy/readback transaction remains in force.
   await apply([{op:'addTable',target:{slide:i},rows:e.rows.length+1,cols:e.headers.length,offset:rect(e)}]);
   const after=(await session.read(signal)).observation as any,table=after.pages[i].elements.find((x:any)=>x.type==='table'&&!ids.has(x.id));if(!table)fail('composition_table_readback_missing');
   const target={slide:i,el:table.id};ops=[{op:'setTableStyle',target,styleName:'zebraBlue'},{op:'setFont',target,font:{fontFamily:font,fontSizePt:e.fontSize}}];[e.headers,...e.rows].forEach((row:string[],r:number)=>row.forEach((value,c)=>ops.push({op:'setTableCell',target,row:r,col:c,paragraphs:[{runs:[{text:value,fontSize:e.fontSize,fontFamily:font}]}]})));await apply(ops);
  }
  const raw=session.snapshot().bytes,bytes=await attachGeneratedPowerPointChartWorkbooks(raw,signal,options);return {bytes,savedToOffice:false as const};
 }finally{session.dispose();}
}
export async function prepareComposition(domain:CompositionDomain,input:{request:string;sources:Json},transport:AgentTransport,signal:AbortSignal,options:DraftOptions&{datasets?:CompositionData}={}){
 const datasets=options.datasets?clone(options.datasets):undefined;
 return planDraft<CompositionPlan>(domain,input,transport,signal,compositionSchemas[domain],x=>{validateComposition(domain,x);if(domain==='excel'&&datasets)expandExcelComposition(x as CompositionPlan,datasets);},'Design the composition yourself. There are no business templates, preselected sections, sheet names, cell addresses, slide counts, or layout presets. Select structure from the requirements. Use only declarative native objects. No executable code or external links. Excel formulas must use Office 2016 functions and A1 references; optional leading equals is accepted. Preserve whole-column/row references when needed. Microsoft 365 dynamic-array functions and spill syntax are unavailable; use Office 2016 equivalents. Excel table formula templates replace {row} with the actual data row; source field bindings copy raw authorized records, not formulas or business logic. Word widths are centimeters, not inches or relative weights: available portrait 17cm or landscape 25.5cm; allocate readable column widths. Word fontSize/spaceBefore/spaceAfter use points, lineSpacing is a multiplier; keepTogether is for short tables only. PPT x/y/w/h are inches on a 13.33 by 7.5 canvas. Use body text 18pt or larger; a readable box must fit its full text. Preserve all requested facts and uncertainties. You must call the submit draft tool with the full structured plan; prose alone cannot create an artifact.',{...options,validationDetails:true,validationFeedback:(draft,reason)=>validationHint(domain,draft,datasets,reason)});
}
