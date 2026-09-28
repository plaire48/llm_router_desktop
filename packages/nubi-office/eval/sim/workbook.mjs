// In-memory workbook for the simulated Excel host. It stores cell INPUTS and
// layout only; calculated values come from calc.mjs on every read. This models
// the data contract of native ExcelPort.Read, not Excel 2016 rendering or COM.
import {randomUUID} from 'node:crypto';
import {calculate} from './calc.mjs';
import {FORMAT_FIELDS} from '../../worker/cell-format.mjs';
import {fault as fail} from './fault.mjs';

// Assumed new-workbook defaults of Korean Excel. Not measured on Excel 2016.
const DEFAULTS={bold:false,italic:false,fontName:'맑은 고딕',fontSize:11,fontColor:'#000000',fillColor:null,numberFormat:'General',wrapText:false,horizontalAlignment:'general',verticalAlignment:'center'};
const ROW_HEIGHT=16.5,COLUMN_WIDTH=8.38;
const INPUT_KEYS=new Set(['value','formula','validation','locked','rowHeight','columnWidth','borders',...FORMAT_FIELDS]);
const id=()=>randomUUID().replaceAll('-','');

export function columnName(column){let name='';for(;column;column=Math.floor((column-1)/26))name=String.fromCharCode(65+(column-1)%26)+name;return name;}
export const cellName=(row,column)=>columnName(column)+row;
// Unlike worker/office-range.mjs this has no 1,000-cell limit: merges and used
// ranges may be larger than one observed selection.
export function area(address){
  const m=/^\$?([A-Z]{1,3})\$?([1-9]\d{0,6})(?::\$?([A-Z]{1,3})\$?([1-9]\d{0,6}))?$/i.exec(address||'');if(!m)fail('invalid_range');
  const column=text=>[...text.toUpperCase()].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
  const row=+m[2],col=column(m[1]),endRow=+(m[4]||m[2]),endCol=column(m[3]||m[1]);
  if(endRow<row||endCol<col||endRow>1048576||endCol>16384)fail('invalid_range');
  return{row,column:col,rows:endRow-row+1,columns:endCol-col+1,address:cellName(row,col)+':'+cellName(endRow,endCol)};
}
const holds=(outer,row,column)=>row>=outer.row&&row<outer.row+outer.rows&&column>=outer.column&&column<outer.column+outer.columns;

function checkValidation(rule){
  if(rule===null||rule===undefined)return null;
  if(!rule||typeof rule!=='object'||![1,2,3,4,6].includes(rule.type))fail('sim_validation_unsupported');
  // Formula-driven rules need Excel to evaluate them; never guess their result.
  for(const key of ['formula1','formula2'])if(typeof rule[key]==='string'&&rule[key].trim().startsWith('='))fail('sim_validation_unsupported');
  if(rule.type===3&&(typeof rule.formula1!=='string'||typeof rule.listSeparator!=='string'||rule.listSeparator.length!==1))fail('sim_validation_unsupported');
  if(rule.type!==3&&(![1,2,3,4,5,6,7,8].includes(rule.operator)||!Number.isFinite(Number(rule.formula1))))fail('sim_validation_unsupported');
  return structuredClone(rule);
}
function validationValid(rule,value){
  if(!rule)return null;
  if(value===null||value==='')return rule.ignoreBlank===true;
  if(rule.type===3)return rule.formula1.split(rule.listSeparator).includes(String(value));
  const measured=rule.type===6?String(value).length:value;
  if(typeof measured!=='number'||(rule.type===1&&!Number.isInteger(measured)))return false;
  const low=Number(rule.formula1),high=Number(rule.formula2);
  return [,measured>=low&&measured<=high,measured<low||measured>high,measured===low,measured!==low,measured>low,measured<low,measured>=low,measured<=low][rule.operator];
}

function buildSheet(definition){
  if(typeof definition?.name!=='string'||!definition.name.trim()||definition.name.length>31)fail('sim_sheet_invalid');
  const sheet={id:id(),name:definition.name,protected:definition.protected===true,visibility:'xlSheetVisible',cells:new Map(),merges:(definition.merges||[]).map(area),
    hiddenRows:new Set(definition.hiddenRows||[]),hiddenColumns:new Set(definition.hiddenColumns||[]),tables:structuredClone(definition.tables||[])};
  for(const [address,input] of Object.entries(definition.cells||{})){
    const at=area(address);if(at.rows!==1||at.columns!==1)fail('sim_cell_invalid');
    if(!input||typeof input!=='object'||Object.keys(input).some(key=>!INPUT_KEYS.has(key)))fail('sim_cell_invalid');
    if(input.value!==undefined&&input.formula!==undefined)fail('sim_cell_invalid');
    const merge=sheet.merges.find(m=>holds(m,at.row,at.column));
    if(merge&&(merge.row!==at.row||merge.column!==at.column)&&(input.value!==undefined||input.formula!==undefined))fail('sim_merge_follower_value');
    sheet.cells.set(`${at.row}:${at.column}`,{...structuredClone(input),...(input.validation!==undefined?{validation:checkValidation(input.validation)}:{})});
  }
  return sheet;
}
const copySheet=sheet=>({...sheet,id:id(),cells:new Map([...sheet.cells].map(([key,cell])=>[key,structuredClone(cell)])),merges:structuredClone(sheet.merges),hiddenRows:new Set(sheet.hiddenRows),hiddenColumns:new Set(sheet.hiddenColumns),tables:structuredClone(sheet.tables)});

function assemble({name,date1904,readOnly,sheets,customXml}){
  if(!sheets.length)fail('sim_sheet_invalid');
  const find=sheetId=>sheets.find(sheet=>sheet.id===sheetId)||fail('document_closed');
  const inputs=()=>sheets.map(sheet=>({name:sheet.name,cells:[...sheet.cells].map(([key,cell])=>{const [row,column]=key.split(':').map(Number);return{row,column,value:cell.formula===undefined?cell.value??null:null,formula:cell.formula??null,numberFormat:cell.numberFormat??DEFAULTS.numberFormat};})}));
  const book={documentId:id(),name,date1904,readOnly,customXml,
    get sheets(){return sheets.map(({id,name,protected:guarded,visibility,tables})=>({id,name,protected:guarded,visibility,tables:structuredClone(tables)}));},
    read(sheetId,address){
      const sheet=find(sheetId),target=area(address);if(target.rows*target.columns>1000)fail('range_limit');
      const results=calculate(inputs())[sheets.indexOf(sheet)],cells=[];
      for(let r=0;r<target.rows;r++){const line=[];for(let c=0;c<target.columns;c++){
        const row=target.row+r,column=target.column+c,key=`${row}:${column}`,stored=sheet.cells.get(key)||{},result=results.get(key);
        const merge=sheet.merges.find(m=>holds(m,row,column)),value=result?result.value:null,rule=stored.validation??null;
        line.push({value,formula:stored.formula??null,error:result?.error===true,
          bold:stored.bold??DEFAULTS.bold,italic:stored.italic??DEFAULTS.italic,fontName:stored.fontName??DEFAULTS.fontName,fontSize:stored.fontSize??DEFAULTS.fontSize,fontColor:stored.fontColor??DEFAULTS.fontColor,
          fillColor:stored.fillColor??DEFAULTS.fillColor,numberFormat:stored.numberFormat??DEFAULTS.numberFormat,wrapText:stored.wrapText??DEFAULTS.wrapText,
          horizontalAlignment:stored.horizontalAlignment??DEFAULTS.horizontalAlignment,verticalAlignment:stored.verticalAlignment??DEFAULTS.verticalAlignment,
          displayText:result?.displayText??'',locked:stored.locked??true,mergedAddress:merge?merge.address:null,arrayFormula:false,
          hiddenRow:sheet.hiddenRows.has(row),hiddenColumn:sheet.hiddenColumns.has(column),rowHeight:stored.rowHeight??ROW_HEIGHT,columnWidth:stored.columnWidth??COLUMN_WIDTH,
          borders:structuredClone(stored.borders??{}),validation:structuredClone(rule),validationValid:validationValid(rule,value)});
      }cells.push(line);}
      return{documentId:book.documentId,sheetId:sheet.id,workbook:book.name,worksheet:sheet.name,address:target.address,date1904:book.date1904,readOnly:book.readOnly,protected:sheet.protected,cells};
    },
    write(sheetId,address,patches){
      const sheet=find(sheetId),target=area(address);
      for(const patch of patches){
        const key=`${target.row+patch.row}:${target.column+patch.column}`,stored={...(sheet.cells.get(key)||{})};
        if(patch.field==='value'){delete stored.formula;if(patch.value===null)delete stored.value;else stored.value=structuredClone(patch.value);}
        else if(patch.field==='formula'){delete stored.value;stored.formula=String(patch.value);}
        else if(FORMAT_FIELDS.includes(patch.field))stored[patch.field]=structuredClone(patch.value);
        else fail('unsupported_operation');
        sheet.cells.set(key,stored);
      }
    },
    usedRange(sheetId){
      const sheet=find(sheetId),points=[...[...sheet.cells.keys()].map(key=>key.split(':').map(Number)),...sheet.merges.flatMap(m=>[[m.row,m.column],[m.row+m.rows-1,m.column+m.columns-1]])];
      if(!points.length)return'A1';
      const rows=points.map(p=>p[0]),columns=points.map(p=>p[1]);
      return cellName(Math.min(...rows),Math.min(...columns))+':'+cellName(Math.max(...rows),Math.max(...columns));
    },
    clone({name:copyName=name,readOnly:copyReadOnly=readOnly}={}){return assemble({name:copyName,date1904,readOnly:copyReadOnly,sheets:sheets.map(copySheet),customXml:structuredClone(book.customXml)});}
  };
  return book;
}

export function createWorkbook({name,date1904=false,readOnly=false,sheets=[]}){
  if(typeof name!=='string'||!name.trim())fail('sim_workbook_invalid');
  const built=sheets.map(buildSheet);
  if(new Set(built.map(sheet=>sheet.name.toLowerCase())).size!==built.length)fail('sim_sheet_invalid');
  return assemble({name,date1904:date1904===true,readOnly:readOnly===true,sheets:built,customXml:[]});
}
