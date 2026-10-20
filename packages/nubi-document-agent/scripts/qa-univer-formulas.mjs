// Alternative calculator experiment using the existing companion's installed libraries.
// No new product dependency or fallback is enabled by this evaluation.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import ExcelJS from 'exceljs';
const source=resolve(process.argv[2]),root=resolve(process.argv[3]),require=createRequire(resolve(process.argv[4],'package.json')),sha=b=>createHash('sha256').update(b).digest('hex');
const core=require('@univerjs/core'),formula=require('@univerjs/engine-formula'),sheets=require('@univerjs/sheets'),sheetFormula=require('@univerjs/sheets-formula');
await mkdir(root,{recursive:true});const report={kind:'existing_univer_headless_formula_experiment',newProductDependency:false,actualOffice2016:false,modelMeasured:false,packages:{},sources:{},checks:[]},contract=JSON.parse(await readFile(join(source,'oracle-contracts.json')));
for(const name of ['core','engine-formula','sheets','sheets-formula']){const path=require.resolve('@univerjs/'+name);report.packages[name]={entry:path,sha256:sha(await readFile(path)),version:JSON.parse(await readFile(resolve(path,'../../../package.json'))).version};}
for(const fixture of contract.fixtures){const bytes=await readFile(join(source,fixture.name+'.xlsx'));report.sources[fixture.name]=sha(bytes);const book=new ExcelJS.Workbook();await book.xlsx.load(bytes);const cellData={};book.worksheets[0].eachRow((row,r)=>row.eachCell((cell,c)=>{cellData[r-1]??={};cellData[r-1][c-1]=cell.formula?{f:'='+cell.formula.replace(/_xlfn\./g,'')}:{v:cell.value};}));
 const u=new core.Univer({locale:core.LocaleType.EN_US,locales:{},logLevel:core.LogLevel.ERROR});try{u.registerPlugin(formula.UniverFormulaEnginePlugin);u.registerPlugin(sheets.UniverSheetsPlugin);u.registerPlugin(sheetFormula.UniverSheetsFormulaPlugin);const workbook=u.createUnit(core.UniverInstanceType.UNIVER_SHEET,{id:'wb',name:'Synthetic',sheetOrder:['s'],styles:{},sheets:{s:{id:'s',name:'計算',rowCount:400,columnCount:20,cellData}}}),sheet=workbook.getSheetBySheetId('s');
 const deadline=performance.now()+8000;while(fixture.expected.some((_x,i)=>sheet.getCellRaw(i,5)?.v===undefined)&&performance.now()<deadline)await new Promise(r=>setTimeout(r,50));
 for(const [index,expected]of fixture.expected.entries()){const cell=sheet.getCellRaw(index,5),wanted=expected.value,raw=cell?.v,actual=typeof raw==='boolean'?Number(raw):raw,passed=cell?.t!==core.CellValueType.ERROR&&(typeof wanted==='string'?actual===wanted:typeof actual==='number'&&Math.abs(actual-wanted)<=1e-10*Math.max(1,Math.abs(wanted)));report.checks.push({case:fixture.name,...expected,actual,cell,passed});}
 }finally{u.dispose();}}
report.planned=report.checks.length;report.passed=report.checks.filter(c=>c.passed).length;report.failed=report.planned-report.passed;await writeFile(join(root,'results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({planned:report.planned,passed:report.passed,failed:report.failed}));
