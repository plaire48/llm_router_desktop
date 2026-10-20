import {readFile,writeFile,mkdir} from 'node:fs/promises';import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';import ExcelJS from 'exceljs';
import {createNodeGenOfficeEngine} from '../scripts/genoffice-node-port.mjs';
const root=resolve(process.argv[2]),referencePath=resolve('artifacts/microsoft-ets-reference/Forecast_ets_example.xlsx'),referenceBytes=await readFile(referencePath),sha=b=>createHash('sha256').update(b).digest('hex'),editor=resolve('artifacts/xlsx-editor-engine/editor.cjs'),signal=new AbortController().signal;
const original=new ExcelJS.Workbook();await original.xlsx.load(referenceBytes);const ref=original.worksheets[0],serial=v=>v instanceof Date?v.valueOf()/86400000+25569:v;
const engine=createNodeGenOfficeEngine({wordExcelEnginePath:'/Users/ganadi/Documents/office_x/dist/cli/genoffice-engine.cjs',slideEnginePath:resolve('artifacts/hard-business-1/build/slides.cjs'),xlsxSidecarPath:resolve('artifacts/genoffice-xlsx-sidecar/source/target/release/xlsx-sidecar'),xlsxEditorEnginePath:editor});
await mkdir(root,{recursive:true});const report={kind:'microsoft_published_ets_cached_value_comparison',referenceUrl:'https://download.microsoft.com/download/7/8/E/78E7FB59-A554-4586-B3F4-AEAEBC4036AF/Forecast_ets_example.xlsx',referenceHash:sha(referenceBytes),referenceKind:'Published cached Excel results; not a live Office 2016 run',actualOffice2016:false,nascaVerified:false,engineHash:sha(await readFile(editor)),checks:[],fixtures:[]};
for(let n=1;n<=3;n++){
 const book=new ExcelJS.Workbook();book.calcProperties.fullCalcOnLoad=true;const s=book.addWorksheet('Calc'),cases=[];
 for(let r=4;r<=60;r++){s.getCell(r,1).value=serial(ref.getCell(r,1).value);s.getCell(r,2).value=ref.getCell(r,2).value;}
 for(let r=61;r<=84;r++){
  s.getCell(r,1).value=serial(ref.getCell(r,1).value);
  const formulas=[['C','FORECAST.ETS',`FORECAST.ETS(A${r},$B$4:$B$60,$A$4:$A$60,1,1)`,ref.getCell('C'+r).result],['D','FORECAST.ETS.CONFINT',`FORECAST.ETS.CONFINT(A${r},$B$4:$B$60,$A$4:$A$60,0.95,1,1)`,ref.getCell('E'+r).result-ref.getCell('C'+r).result]];
  for(const [col,name,formula,wanted]of formulas){s.getCell(col+r).value={formula};cases.push({address:col+r,name,formula,wanted});}
 }
 for(const [address,name]of [['I75','FORECAST.ETS.SEASONALITY'],['I76','FORECAST.ETS.STAT']]){s.getCell(address).value={formula:ref.getCell(address).formula.replaceAll('_xlfn.','')};cases.push({address,name,formula:s.getCell(address).formula,wanted:ref.getCell(address).result});}
 const bytes=await book.xlsx.writeBuffer();await writeFile(join(root,'source-'+n+'.xlsx'),bytes);const result=await engine.invoke({domain:'excel',action:'apply',bytes,ops:[]},signal);await writeFile(join(root,'result-'+n+'.xlsx'),result.bytes);const after=new ExcelJS.Workbook();await after.xlsx.load(result.bytes);
 for(const c of cases){const actual=after.worksheets[0].getCell(c.address).result,error=typeof actual==='number'?Math.abs(actual-c.wanted):null,relativeError=error===null?null:error/Math.abs(c.wanted);report.checks.push({...c,repetition:n,actual,absoluteError:error,relativeError,passed:error!==null&&error<=1e-8*Math.max(1,Math.abs(c.wanted))});}
 for(const c of cases)assert.equal(after.worksheets[0].getCell(c.address).formula,c.formula);
 report.fixtures.push({repetition:n,sourceHash:sha(bytes),candidateHash:sha(result.bytes),formulasPreserved:true});
}
assert.equal(sha(await readFile(referencePath)),report.referenceHash);report.planned=report.checks.length;report.passed=report.checks.filter(x=>x.passed).length;report.failed=report.planned-report.passed;report.functions=[...new Set(report.checks.map(x=>x.name))].map(name=>{const checks=report.checks.filter(x=>x.name===name);return{name,planned:checks.length,passed:checks.filter(x=>x.passed).length,maxRelativeError:Math.max(...checks.map(x=>x.relativeError??Infinity)),status:checks.every(x=>x.passed)?'cached_reference_matched':'numerical_parity_gap'};});await writeFile(join(root,'results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({planned:report.planned,passed:report.passed,failed:report.failed,functions:report.functions}));
