// Captured scalar cells only. No workbook/file reader, Office calls or network.
import {parentPort,workerData} from 'node:worker_threads';
import * as core from '@univerjs/core';
import {UniverFormulaEnginePlugin,IFormulaRuntimeService,ALL_IMPLEMENTED_FUNCTIONS,BaseFunction,ErrorValueObject,ErrorType,NumberValueObject,StringValueObject,ArrayValueObject} from '@univerjs/engine-formula';
import {UniverSheetsPlugin} from '@univerjs/sheets';
import {UniverSheetsFormulaPlugin} from '@univerjs/sheets-formula';
import {formulaReferences,assertAcyclic,formulaErrorDetail} from '../../nubi-document-agent/src/excel-formula';
import {existingFunctionAliases,currencyStringFunction} from '../../nubi-document-agent/scripts/univer-function-extensions.mjs';
import {missingFunctions} from '../../nubi-document-agent/scripts/univer-missing-functions.mjs';
import {etsFunctions} from '../../nubi-document-agent/scripts/univer-ets-functions.mjs';
import {trackFormulaErrors} from '../../nubi-document-agent/scripts/univer-formula-results.mjs';
const col=(letters:string)=>[...letters].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
const label=(n:number):string=>n?label(Math.floor((n-1)/26))+String.fromCharCode(65+(n-1)%26):'';
const fail=(code:string,detail:string):never=>{throw Object.assign(new Error(code),{detail});};
async function calculate(){
 const input=workerData as {sheets:{id:string|number;name:string;cells:{address:string;row:number;col:number;value?:unknown;formula?:string}[]}[]};
 const sheets=input.sheets,shapes=sheets.map(s=>({name:s.name,rows:[]})),graph=new Map<string,string[]>(),known=new Map(sheets.map(s=>[s.name.toLowerCase(),new Map(s.cells.map(c=>[`${c.col}:${c.row}`,c]))]));
 let references=0;
 for(const s of sheets)for(const c of s.cells)if(c.formula){
  const dependencies=new Set<string>();
  try{
   if(/\b(?:NOW|TODAY|RAND|RANDBETWEEN|FORECAST\.ETS(?:\.CONFINT|\.STAT)?)\s*\(/i.test(c.formula.replace(/"(?:[^"]|"")*"/g,'')))fail('native_excel_calculation_requires_office','시간/난수 또는 정밀 호환이 미확인된 함수는 Office 계산 검증이 필요합니다.');
   formulaReferences(c.formula,s.name,shapes,{referenceScope:'worksheet',onReference:a=>{
    const count=(a.endRow-a.row+1)*(a.endCol-a.col+1);references+=count;if(references>250000)fail('native_excel_reference_limit','계산 참조 범위가 너무 큽니다. 필요한 범위만 읽어 주세요.');
    const source=known.get(a.name.toLowerCase())!;
    for(let row=a.row;row<=a.endRow;row++)for(let column=a.col;column<=a.endCol;column++){if(!source.has(`${column}:${row}`))fail('native_excel_reference_missing',`${a.name}!${label(column)}${row} 셀을 먼저 읽어 주세요.`);dependencies.add(`${a.name}!${column}:${row}`);}
   }});graph.set(`${s.name}!${c.col}:${c.row}`,[...dependencies]);
  }catch(e:any){e.detail=`${s.name}!${c.address}: ${e.detail||formulaErrorDetail(e)||'수식 형식 또는 Office 2016 지원 여부를 확인해 주세요.'}`;throw e;}
 }
 assertAcyclic(graph);
 const u=new core.Univer({locale:core.LocaleType.EN_US,locales:{},logLevel:core.LogLevel.ERROR});let typed:any;
 try{
  const api={ALL_IMPLEMENTED_FUNCTIONS,BaseFunction,ErrorValueObject,ErrorType,NumberValueObject,StringValueObject,ArrayValueObject};
  u.registerPlugin(UniverFormulaEnginePlugin,{function:[...existingFunctionAliases(ALL_IMPLEMENTED_FUNCTIONS),...missingFunctions(api,{}),...etsFunctions(api).filter(([,name])=>name==='FORECAST.ETS.SEASONALITY'),[currencyStringFunction(api),'DOLLAR']]});u.registerPlugin(UniverSheetsPlugin);u.registerPlugin(UniverSheetsFormulaPlugin);
  typed=trackFormulaErrors(u.__getInjector().get(IFormulaRuntimeService));
  const data:any={},order:string[]=[];sheets.forEach((s,i)=>{const id='s'+i,cellData:any={};order.push(id);for(const c of s.cells){cellData[c.row-1]??={};cellData[c.row-1][c.col-1]=c.formula?{f:c.formula}:{v:c.value??null,...(typeof c.value==='boolean'?{t:core.CellValueType.BOOLEAN}:{})};}data[id]={id,name:s.name,rowCount:Math.max(100,...s.cells.map(c=>c.row)),columnCount:Math.max(20,...s.cells.map(c=>c.col)),cellData};});
  const book=u.createUnit(core.UniverInstanceType.UNIVER_SHEET,{id:'native-draft',name:'Observed draft',sheetOrder:order,sheets:data,styles:{}}),formulas=sheets.flatMap((s,i)=>s.cells.filter(c=>c.formula).map(c=>({s,i,c})));
  const deadline=performance.now()+8000;while(formulas.some(({i,c})=>book.getSheetBySheetId(order[i])!.getCellRaw(c.row-1,c.col-1)?.v===undefined)){if(performance.now()>deadline)fail('native_excel_calculation_timeout','계산 시간이 초과됐습니다.');await new Promise(r=>setTimeout(r,20));}
  const values=formulas.map(({s,i,c})=>{const raw=book.getSheetBySheetId(order[i])!.getCellRaw(c.row-1,c.col-1),error=typed.errors.get(`${order[i]}:${c.row-1}:${c.col-1}`);if(error)fail('native_excel_calculation_error',`${s.name}!${c.address}: ${error}`);const value=raw?.t===core.CellValueType.BOOLEAN?Boolean(raw.v):raw?.v??null;if(value!==null&&!['number','boolean','string'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))fail('native_excel_calculation_error',`${s.name}!${c.address}: 결과를 확인할 수 없습니다.`);return {sheetId:s.id,address:c.address,value};});
  return {state:'verified',engine:'Univer 0.25.1',scope:'observed_cells_only',formulaCount:formulas.length,values,officeVerified:false};
 }finally{typed?.dispose();u.dispose();}
}
calculate().then(result=>parentPort!.postMessage({result})).catch((e:any)=>parentPort!.postMessage({error:e.code||e.message||'native_excel_calculation_failed',detail:e.detail||'수식을 확인해 주세요. 순환 참조가 있으면 제거해 주세요.'}));
