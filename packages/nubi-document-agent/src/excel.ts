import ExcelJS from 'exceljs';
import {withFutureFunctionMarkers} from '../vendor/genoffice/packages/xlsx-gateway/src/gateway/future-functions';
import {clone,canonical,fail} from './contracts.js';
import {planDraft,record,only,plainText,draftFont} from './draft-planning.js';
import type {DraftOptions} from './draft-planning.js';
import type {AgentTransport,Json} from './types.js';
import {formulaReferences,assertAcyclic} from './excel-formula.js';
export {supportedFormulaFunctions,formulaFunctionCatalog} from './excel-formula.js';
export {bindGeneratedExcelChart} from './generated-excel-chart.js';
export type {GeneratedChartBinding} from './generated-excel-chart.js';
import schema from './excel-draft.schema.json';
import {inspectPackage} from './generated-package.js';
export const excelDraftSchema:Record<string,unknown>=schema;
export interface ExcelCell {value:string|number|boolean|null;formula:string|null;format:'general'|'integer'|'percent'|'date'|'decimal';role:'body'|'title'|'header'|'input'|'total'}
export interface ExcelDraft {title:string;sheets:Array<{name:string;columnWidths:number[];rows:ExcelCell[][]}>}
const validDate=(value:unknown)=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(new Date(value).getTime())&&new Date(value).toISOString().slice(0,10)===value;
export function validateExcelDraft(input:unknown):asserts input is ExcelDraft {
  const invalid=()=>fail('excel_draft_invalid');
  if(!record(input)||!only(input,['title','sheets'])||!plainText(input.title,160)||!Array.isArray(input.sheets)||!input.sheets.length||input.sheets.length>8)invalid();
  const draft=input as unknown as ExcelDraft,names=new Set<string>();let total=0;
  for(const sheet of draft.sheets){
    if(!record(sheet)||!only(sheet,['name','columnWidths','rows'])||!plainText(sheet.name,31)||/[\[\]:*?/\\']/.test(sheet.name)||names.has(sheet.name.toLowerCase())||!Array.isArray(sheet.rows)||!sheet.rows.length||sheet.rows.length>400||!Array.isArray(sheet.columnWidths)||!sheet.columnWidths.length||sheet.columnWidths.length>20||sheet.columnWidths.some(v=>!Number.isFinite(v)||v<10||v>65))invalid();names.add(sheet.name.toLowerCase());
    for(const row of sheet.rows){
      if(!Array.isArray(row)||row.length>sheet.columnWidths.length)invalid();total+=sheet.columnWidths.length;
      for(const cell of row){
        if(!record(cell)||!only(cell,['value','formula','format','role'])||!['body','title','header','input','total'].includes(cell.role)||!['general','integer','percent','date','decimal'].includes(cell.format)||!(cell.value===null||typeof cell.value==='boolean'||typeof cell.value==='number'&&Number.isFinite(cell.value)||cell.value===''||plainText(cell.value,500))||!(cell.formula===null||typeof cell.formula==='string'&&cell.value===null)||cell.format==='date'&&cell.formula===null&&!validDate(cell.value))invalid();
      }
    }
  }
  if(total>12000||canonical(draft).length>2_000_000)invalid();
  const shapes=draft.sheets.map(sheet=>({...sheet,rows:sheet.rows.map(row=>Array.from({length:sheet.columnWidths.length},(_,c)=>row[c]??null))}));
  let dependencyEdges=0;const graph=new Map<string,string[]>();for(const sheet of draft.sheets)sheet.rows.forEach((row,r)=>row.forEach((cell,c)=>{if(cell.formula!==null){const refs=formulaReferences(cell.formula,sheet.name,shapes,{referenceScope:'worksheet'});dependencyEdges+=refs.length;if(dependencyEdges>250_000)fail('excel_formula_invalid');graph.set(`${sheet.name}!${c+1}:${r+1}`,refs);}}));assertAcyclic(graph);
}
/** Adapts Nubi Office worker/document-file.mjs's typed ExcelJS writer, without its file/save ownership. */
export async function createExcelDocument(input:ExcelDraft,signal:AbortSignal,options:DraftOptions={}) {
  if(signal.aborted)fail('operation_cancelled');validateExcelDraft(input);const draft=clone(input),font=draftFont(options.fontFamily);
  for(const sheet of draft.sheets)sheet.rows=sheet.rows.map(row=>Array.from({length:sheet.columnWidths.length},(_,c)=>row[c]??{value:null,formula:null,format:'general',role:'body'}));
  const book=new ExcelJS.Workbook();book.creator='Nubi';book.title=draft.title;book.calcProperties.fullCalcOnLoad=true;
  for(const spec of draft.sheets){
    const sheet=book.addWorksheet(spec.name,{properties:{defaultRowHeight:30},views:[{showGridLines:false,state:'frozen',ySplit:1}],pageSetup:{printTitlesRow:'1:1',paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,printArea:`A1:${String.fromCharCode(64+spec.columnWidths.length)}${spec.rows.length}`,margins:{left:.3,right:.3,top:.4,bottom:.4,header:.15,footer:.15}}});
    spec.columnWidths.forEach((width,i)=>sheet.getColumn(i+1).width=width);
    spec.rows.forEach((row,r)=>row.forEach((data,c)=>{
      const cell=sheet.getCell(r+1,c+1);
      cell.value=data.formula!==null?{formula:withFutureFunctionMarkers(data.formula.replace(/^=/,''))}:data.format==='date'?new Date(data.value as string):data.value;
      cell.numFmt={general:'General',integer:'#,##0',percent:'0.0%',date:'yyyy-mm-dd',decimal:'#,##0.00'}[data.format];
      cell.font={name:font,size:data.role==='title'?18:11,bold:['title','header','total'].includes(data.role),color:{argb:data.role==='input'?'FF1B64DA':'FF191F28'}};
      const numeric=(entry:ExcelCell|undefined)=>!!entry&&(typeof entry.value==='number'||entry.formula!==null&&['integer','decimal','percent'].includes(entry.format));
      const numericColumn=data.role==='header'&&numeric(spec.rows[r+1]?.[c]);
      cell.alignment={vertical:'middle',horizontal:numeric(data)||numericColumn?'right':'left',wrapText:true,indent:1};
      if(data.value!==null||data.formula!==null)cell.border={right:{style:'hair',color:{argb:'FFE5E8EB'}}};
      if(['header','total'].includes(data.role))cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:data.role==='header'?'FFE8F1FE':'FFF1F7FE'}};
      const lines=Math.max(...String(data.value??'').split('\n').map(line=>Math.ceil(line.length/(spec.columnWidths[c]!*.65))));sheet.getRow(r+1).height=Math.max(sheet.getRow(r+1).height??30,lines*17+12,data.role==='title'?40:30);
    }));
  }
  const bytes=new Uint8Array(await book.xlsx.writeBuffer());if(signal.aborted)fail('operation_cancelled');
  return {bytes,engine:'exceljs' as const,savedToOffice:false as const,calculationRequired:true as const};
}
/** Newly generated plaintext artifacts only; never an encrypted Office file reader. */
export async function inspectGeneratedExcel(bytes:Uint8Array) {
  try{
    const pkg=await inspectPackage(bytes,'excel');if(!pkg.zip.file('xl/workbook.xml'))fail('generated_excel_invalid');
    const book=new ExcelJS.Workbook();await book.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    return {sheets:book.worksheets.map(sheet=>({name:sheet.name,rows:Array.from({length:sheet.rowCount},(_,r)=>Array.from({length:sheet.columnCount},(_,c)=>{const cell=sheet.getCell(r+1,c+1);return {value:cell.formula?cell.result??null:cell.value instanceof Date?cell.value.toISOString().slice(0,10):cell.value,formula:cell.formula??null,format:cell.numFmt};}))})),hasExternalRelationships:pkg.hasExternalRelationships,hasMacros:pkg.hasMacros};
  }catch{return fail('generated_excel_invalid');}
}
export async function prepareExcelDocument(input:{request:string;sources:Json},transport:AgentTransport,signal:AbortSignal,options:DraftOptions={}) {
  const draft=await planDraft<ExcelDraft>('excel',input,transport,signal,excelDraftSchema,validateExcelDraft,`Use typed inputs and internal formulas. Use built-in functions available in Office 2016, arithmetic, comparisons and local cells or quoted internal sheet references. Function names are not limited to a small subset; calculation is a required host step. Formula text has no leading equals sign. Keep inputs separate from calculated outputs. No external links or executable expressions.`,options);
  return {...await createExcelDocument(draft,signal,options),draft,finalSaveRequired:true as const};
}
