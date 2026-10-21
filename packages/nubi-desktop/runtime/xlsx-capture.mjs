// The file engine of the registration capture for Excel (document forms plan Task I, 2026-10-21): every sheet, hidden
// ones included, with each used cell's value, formula, number format, font, fill, border and alignment, the merges,
// validations, conditional formats, column widths and row heights, the defined names, the pictures (as assets) and the
// charts. Office (engine 'office') is the product path; this read says fidelity 'file'.
import JSZip from 'jszip';
import {createHash} from 'node:crypto';
import {parseXml,findFirst,childrenNamed,firstNamed,isElement} from './docx-snapshot.mjs';
import {CAPTURE_SCHEMA_VERSION,validateCapture} from './office-capture.mjs';
import {fail} from './files.mjs';

const CELL_LIMIT=100000;
const CONTENT_TYPES={png:'image/png',jpeg:'image/jpeg',jpg:'image/jpeg',gif:'image/gif',bmp:'image/bmp',emf:'image/emf',wmf:'image/wmf',svg:'image/svg+xml',tiff:'image/tiff'};
const hash=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const argb=color=>color?.argb?'#'+String(color.argb).slice(-6).toUpperCase():color?.theme!==undefined?`theme:${color.theme}${color.tint?`:${color.tint}`:''}`:null;
const columnName=column=>{let name='';for(let n=column;n;n=Math.floor((n-1)/26))name=String.fromCharCode(65+(n-1)%26)+name;return name;};
const compact=value=>Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined&&v!==null&&!(typeof v==='object'&&!Array.isArray(v)&&!Object.keys(v).length)));

function fontOf(font){if(!font)return undefined;return compact({name:font.name,size:font.size,bold:font.bold||undefined,italic:font.italic||undefined,underline:font.underline||undefined,strike:font.strike||undefined,color:argb(font.color)});}
function fillOf(fill){if(!fill||fill.type!=='pattern'||!fill.pattern||fill.pattern==='none')return fill?.type==='gradient'?{type:'gradient'}:undefined;return compact({pattern:fill.pattern,color:argb(fill.fgColor),background:argb(fill.bgColor)});}
function borderOf(border){if(!border)return undefined;const out={};for(const side of ['top','bottom','left','right'])if(border[side]?.style)out[side]=compact({style:border[side].style,color:argb(border[side].color)});return Object.keys(out).length?out:undefined;}
function valueOf(value){
  if(value===null||value===undefined)return {};
  if(value instanceof Date)return {value:value.toISOString(),type:'date'};
  if(typeof value!=='object')return {value,type:typeof value};
  if(value.formula!==undefined||value.sharedFormula!==undefined)return compact({formula:value.formula??null,sharedFormula:value.sharedFormula,result:value.result instanceof Date?value.result.toISOString():value.result&&typeof value.result==='object'?value.result.error??JSON.stringify(value.result):value.result,type:'formula'});
  if(Array.isArray(value.richText))return {value:value.richText.map(run=>run.text).join(''),type:'richText',runs:value.richText.map(run=>compact({text:run.text,...fontOf(run.font)}))};
  if(value.hyperlink)return {value:value.text??value.hyperlink,type:'hyperlink',hyperlink:value.hyperlink};
  if(value.error)return {value:value.error,type:'error'};
  return {value:JSON.stringify(value),type:'other'};
}
// Charts per sheet: workbook rels name each sheet's part; a sheet's drawing lists its charts.
async function chartsBySheet(zip){
  const read=async name=>{const file=zip.file(name);return file?file.async('string'):null;};
  const rels=async part=>{const dir=part.slice(0,part.lastIndexOf('/')),base=part.slice(part.lastIndexOf('/')+1),xml=await read(`${dir}/_rels/${base}.rels`);const map=new Map();if(!xml)return map;for(const rel of childrenNamed(findFirst(parseXml(xml),'Relationships')??{children:[]},'Relationship'))map.set(rel.attrs.Id,{type:rel.attrs.Type,target:resolve(dir,rel.attrs.Target)});return map;};
  const resolve=(dir,target)=>{if(target.startsWith('/'))return target.slice(1);const parts=dir.split('/');for(const piece of target.split('/')){if(piece==='..')parts.pop();else if(piece&&piece!=='.')parts.push(piece);}return parts.join('/');};
  const workbook=await read('xl/workbook.xml');if(!workbook)return new Map();
  const bookRels=await rels('xl/workbook.xml'),out=new Map();
  for(const sheet of childrenNamed(findFirst(parseXml(workbook),'sheets')??{children:[]},'sheet')){
    const part=bookRels.get(sheet.attrs['r:id'])?.target;if(!part)continue;
    const charts=[];
    for(const rel of (await rels(part)).values()){
      if(!rel.type.endsWith('/drawing'))continue;
      for(const inner of (await rels(rel.target)).values()){
        if(!inner.type.endsWith('/chart'))continue;
        const xml=await read(inner.target);if(!xml)continue;const root=parseXml(xml),plot=findFirst(root,'c:plotArea');
        const type=plot?.children.find(child=>isElement(child)&&/^c:\w+Chart$/.test(child.name))?.name.slice(2)??'chart';
        const title=findFirst(root,'c:title');const text=title?(function collect(node,out=''){for(const child of node.children){if(typeof child==='string')continue;if(child.name==='a:t')out+=child.children.filter(x=>typeof x==='string').join('');else out=collect(child,out);}return out;})(title):'';
        charts.push({part:inner.target,type,title:text});
      }
    }
    out.set(sheet.attrs.name,charts);
  }
  return out;
}

/** The full file capture of an xlsx: contract v1 with engine 'file'. */
export async function xlsxCapture(bytes,{name='양식.xlsx'}={}){
  if(!bytes||!bytes.length)fail('xlsx_invalid');
  const {default:ExcelJS}=await import('exceljs');
  const book=new ExcelJS.Workbook();
  // exceljs cannot read every workbook (charts on their own sheet, some drawings: forms baseline 2026-10-21). Excel forms
  // are stored whole in 1.3.0 and filled in 1.3.1, so such a workbook keeps its source copy and a sheet list (partial).
  try{await book.xlsx.load(bytes);}catch{return partialCapture(bytes,name);}
  const zip=await JSZip.loadAsync(bytes).catch(()=>fail('xlsx_invalid')),charts=await chartsBySheet(zip);
  const assets=[],mediaAsset=new Map();
  const assetFor=imageId=>{
    if(mediaAsset.has(imageId))return mediaAsset.get(imageId);
    const image=book.getImage(imageId);if(!image?.buffer)return null;
    const id='image-'+(assets.length+1),extension=String(image.extension||'png').toLowerCase();
    assets.push({id,kind:'image',name:`${id}.${extension}`,contentType:CONTENT_TYPES[extension]??'application/octet-stream',bytes:new Uint8Array(image.buffer)});
    mediaAsset.set(imageId,id);return id;
  };
  let total=0;const sheets=[];
  for(const sheet of book.worksheets){
    const cells=[];let truncated=false;
    // Styled empty cells (a coloured input cell, a bordered box, a validation list) are part of a form: they are kept.
    sheet.eachRow({includeEmpty:true},row=>{row.eachCell({includeEmpty:true},cell=>{
      if(total>=CELL_LIMIT){truncated=true;return;}
      const style=cell.style??{},entry=compact({address:cell.address,...valueOf(cell.value),numberFormat:cell.numFmt&&cell.numFmt!=='General'?cell.numFmt:undefined,font:fontOf(style.font),fill:fillOf(style.fill),border:borderOf(style.border),
        alignment:style.alignment?compact({horizontal:style.alignment.horizontal,vertical:style.alignment.vertical,wrapText:style.alignment.wrapText||undefined,indent:style.alignment.indent||undefined}):undefined,
        merged:cell.isMerged&&cell.master?.address!==cell.address?cell.master.address:undefined,
        validation:cell.dataValidation?compact({type:cell.dataValidation.type,formulae:cell.dataValidation.formulae,allowBlank:cell.dataValidation.allowBlank}):undefined});
      if(Object.keys(entry).length>1){cells.push(entry);total++;}
    });});
    // A validation on a cell that holds nothing else lives only in the sheet's validation list; the cell is added for it.
    for(const [address,rule] of Object.entries(sheet.dataValidations?.model??{})){
      if(!/^[A-Z]{1,3}\d+$/.test(address)||cells.some(cell=>cell.address===address))continue;
      cells.push({address,validation:compact({type:rule.type,formulae:rule.formulae,allowBlank:rule.allowBlank})});total++;
    }
    const columns=(sheet.columns??[]).map((column,i)=>column?.width?{column:columnName(i+1),width:column.width,...(column.hidden?{hidden:true}:{})}:null).filter(Boolean);
    const rows=[];sheet.eachRow({includeEmpty:true},(row,number)=>{if(row.height||row.hidden)rows.push(compact({row:number,height:row.height,hidden:row.hidden||undefined}));});
    const images=sheet.getImages().map(image=>({asset:assetFor(image.imageId),from:image.range?.tl?`${columnName(Math.floor(image.range.tl.nativeCol??image.range.tl.col)+1)}${Math.floor(image.range.tl.nativeRow??image.range.tl.row)+1}`:null,to:image.range?.br?`${columnName(Math.floor(image.range.br.nativeCol??image.range.br.col)+1)}${Math.floor(image.range.br.nativeRow??image.range.br.row)+1}`:null})).filter(image=>image.asset);
    sheets.push(compact({name:sheet.name,state:sheet.state??'visible',usedRange:sheet.dimensions?.model?`${sheet.dimensions.model.left?columnName(sheet.dimensions.model.left):'A'}${sheet.dimensions.model.top??1}:${columnName(sheet.dimensions.model.right??1)}${sheet.dimensions.model.bottom??1}`:undefined,
      cells,merges:sheet.model?.merges??[],columns,rows,images,charts:charts.get(sheet.name)??[],
      conditionalFormats:(sheet.conditionalFormattings??[]).map(rule=>({ref:rule.ref,rules:(rule.rules??[]).map(r=>compact({type:r.type,operator:r.operator,formulae:r.formulae}))})),
      validations:Object.entries(sheet.dataValidations?.model??{}).map(([address,rule])=>compact({address,type:rule.type,operator:rule.operator,formulae:rule.formulae,allowBlank:rule.allowBlank})),
      protected:!!sheet.sheetProtection?.sheet||undefined,tabColor:argb(sheet.properties?.tabColor)??undefined,truncated:truncated||undefined}));
  }
  const capture={schemaVersion:CAPTURE_SCHEMA_VERSION,app:'excel',engine:'file',fidelity:'file',office:null,source:{name,bytes:bytes.length,hash:hash(bytes)},
    document:{sheets,definedNames:(book.definedNames?.model??[]).map(entry=>({name:entry.name,ranges:entry.ranges})),
      fonts:[...new Set(sheets.flatMap(sheet=>sheet.cells.map(cell=>cell.font?.name)).filter(Boolean))],
      colors:[...new Set(sheets.flatMap(sheet=>sheet.cells.flatMap(cell=>[cell.font?.color,cell.fill?.color])).filter(color=>color&&color.startsWith('#')))]},
    assets};
  return validateCapture(capture);
}

async function partialCapture(bytes,name){
  let zip;try{zip=await JSZip.loadAsync(bytes);}catch{fail('xlsx_invalid');}
  const workbook=await zip.file('xl/workbook.xml')?.async('string');if(!workbook)fail('xlsx_invalid');
  const sheets=childrenNamed(findFirst(parseXml(workbook),'sheets')??{children:[]},'sheet').map(sheet=>({name:sheet.attrs.name,state:sheet.attrs.state??'visible',cells:[],partial:true}));
  if(!sheets.length)fail('xlsx_invalid');
  return validateCapture({schemaVersion:CAPTURE_SCHEMA_VERSION,app:'excel',engine:'file',fidelity:'file',office:null,source:{name,bytes:bytes.length,hash:hash(bytes)},document:{sheets,partial:true,definedNames:[],fonts:[],colors:[]},assets:[]});
}
