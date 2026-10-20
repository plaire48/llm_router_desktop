import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import assert from 'node:assert/strict';
import {createNodeGenOfficeEngine} from '../scripts/genoffice-node-port.mjs';
const root=resolve(process.argv[2]),sha=b=>createHash('sha256').update(b).digest('hex'),editor=resolve('artifacts/xlsx-editor-engine/editor.cjs'),signal=new AbortController().signal;
const engine=createNodeGenOfficeEngine({wordExcelEnginePath:'/Users/ganadi/Documents/office_x/dist/cli/genoffice-engine.cjs',slideEnginePath:resolve('artifacts/hard-business-1/build/slides.cjs'),xlsxSidecarPath:resolve('artifacts/genoffice-xlsx-sidecar/source/target/release/xlsx-sidecar'),xlsxEditorEnginePath:editor});
const cases=[
 ['euro-default','EUROCONVERT(1.2,"DEM","EUR")',0.61],
 ['euro-triangulated','EUROCONVERT(1,"FRF","DEM",TRUE,3)',0.29728616],
 ['euro-full','EUROCONVERT(1,"FRF","EUR",TRUE,3)',0.152],
 ['euro-rounded','EUROCONVERT(1,"FRF","EUR",FALSE,3)',0.15],
 ['euro-integer','EUROCONVERT(1,"EUR","ITL")',1936],
 ['euro-negative','EUROCONVERT(-1,"EUR","ITL")',-1936],
 ['euro-unknown','EUROCONVERT(1,"USD","EUR")',{error:'#VALUE!'}],
 ['euro-invalid-precision','EUROCONVERT(1,"FRF","DEM",TRUE,2)',{error:'#VALUE!'}],
 ['euro-unchanged','EUROCONVERT(1.234,"DEM","DEM")',1.234],
 ['amordegrc-official','AMORDEGRC(2400,39679,39813,300,1,0.15,1)',776],
 ['amordegrc-current','AMORDEGRC(2400,DATE(2023,1,1),DATE(2023,12,31),300,1,0.15,1)',563],
 ['amordegrc-period-zero','AMORDEGRC(2400,DATE(2023,1,1),DATE(2024,1,1),300,0,0.15,3)',900],
 ['amordegrc-invalid-rate','AMORDEGRC(2400,39679,39813,300,1,0,1)',{error:'#NUM!'}],
 ['amordegrc-invalid-date','AMORDEGRC(2400,39813,39679,300,1,0.15,1)',{error:'#NUM!'}],
 ['formula-prefix-literal','"_xlfn.FIELD"','_xlfn.FIELD'],
 ['xml-prefix-text','FILTERXML("<r><x>_xlfn.FIELD</x></r>","/r/x")','_xlfn.FIELD'],
 ['xml-single','FILTERXML("<r><x>42</x></r>","/r/x")','42'],
 ['xml-numeric-text','FILTERXML("<r><x>001</x></r>","/r/x")','001'],
 ['xml-error-text','FILTERXML("<r><x>#N/A</x></r>","/r/x")','#N/A'],
 ['xml-predicate',`FILTERXML("<r><x id=""a"">one</x><x id=""b"">two</x></r>","/r/x[@id='b']")`,'two'],
 ['xml-attribute','FILTERXML("<r><x id=""b"">two</x></r>","/r/x/@id")','b'],
 ['xml-array','INDEX(FILTERXML("<r><x>one</x><x>two</x></r>","/r/x"),2)','two'],
 ['xml-descendant','FILTERXML("<r><a><x>inner</x></a><x>outer</x></r>","/r/a//x")','inner'],
 ['xml-unicode','FILTERXML("<r><x>한글 &amp; text</x></r>","/r/x")','한글 & text'],
 ['xml-namespace',`FILTERXML("<r xmlns:p=""urn:test""><p:x>namespaced</p:x></r>","//*[local-name()='x']")`,'namespaced'],
 ['xml-prefixed',`FILTERXML("<r xmlns:p=""urn:test""><p:x>namespaced</p:x></r>","/r/p:x")`,'namespaced'],
 ['xml-unbound-prefix',`FILTERXML("<r><p:x>bad</p:x></r>","/r/p:x")`,{error:'#VALUE!'}],
 ['xml-dtd',`FILTERXML("<!DOCTYPE r [<!ENTITY e 'expanded'>]><r>&e;</r>","/r")`,{error:'#VALUE!'}],
 ['xml-invalid','FILTERXML("<r><x></r>","/r/x")',{error:'#VALUE!'}],
 ['xml-missing','FILTERXML("<r/>","/r/x")',{error:'#VALUE!'}],
 ['xml-error-propagation','FILTERXML(1/0,"/r")',{error:'#DIV/0!'}],
 ['ets-linear','FORECAST.ETS(25,A1:A24,B1:B24,0)',58],
 ['ets-linear-horizon','FORECAST.ETS(28,A1:A24,B1:B24,0)',64],
 ['ets-seasonality','FORECAST.ETS.SEASONALITY(C1:C24,B1:B24)',4],
 ['ets-step','FORECAST.ETS.STAT(A1:A24,B1:B24,8,0)',1],
 ['ets-rmse','FORECAST.ETS.STAT(A1:A24,B1:B24,7,0)',0],
 ['ets-confidence-zero','FORECAST.ETS.CONFINT(25,A1:A24,B1:B24,0.95,0)',0],
 ['ets-past-target','FORECAST.ETS(12,A1:A24,B1:B24,0)',{error:'#NUM!'}],
 ['ets-seasonal-forecast','FORECAST.ETS(25,C1:C24,B1:B24,4)',61],
 ['ets-seasonal-last-phase','FORECAST.ETS(28,C1:C24,B1:B24,4)',62],
 ['ets-seasonal-zero-error','FORECAST.ETS.STAT(C1:C24,B1:B24,7,4)',0],
 ['ets-invalid-confidence','FORECAST.ETS.CONFINT(25,C1:C24,B1:B24,1,4)',{error:'#NUM!'}],
 ['ets-invalid-season','FORECAST.ETS(25,A1:A24,B1:B24,-1)',{error:'#NUM!'}],
 ['ets-invalid-stat','FORECAST.ETS.STAT(A1:A24,B1:B24,9)',{error:'#NUM!'}],
 ['info-origin','INFO("origin")','$A:$A$1'],
 ['info-recalc','INFO("recalc")','Automatic'],
 ['info-sheets','INFO("numfile")',2],
 ['info-obsolete','INFO("memavail")',{error:'#N/A'}],
 ['info-invalid','INFO("unknown")',{error:'#VALUE!'}]
];
await mkdir(root,{recursive:true});const report={kind:'saved_missing_function_regression',actualOffice2016:false,nascaVerified:false,engineHash:sha(await readFile(editor)),checks:[],fixtures:[]};
for(let n=1;n<=3;n++){
 const book=new ExcelJS.Workbook();book.calcProperties.fullCalcOnLoad=true;const s=book.addWorksheet('Calc'),inputs=book.addWorksheet('Inputs');
 for(let i=1;i<=24;i++){s.getCell('A'+i).value=n*(10+2*(i-1));s.getCell('B'+i).value=i;s.getCell('C'+i).value=n*(10+2*(i-1)+[3,-2,1,-2][(i-1)%4]);}inputs.getCell('A1').value='Retain this sheet';
 for(let i=0;i<cases.length;i++){s.getCell(i+1,5).value=cases[i][0];s.getCell(i+1,6).value={formula:cases[i][1]};s.getCell(i+1,6).numFmt='0.000000000';}
 const source=await book.xlsx.writeBuffer();await writeFile(join(root,'source-'+n+'.xlsx'),source);const result=await engine.invoke({domain:'excel',action:'apply',bytes:source,ops:[]},signal),after=new ExcelJS.Workbook();await after.xlsx.load(result.bytes);await writeFile(join(root,'result-'+n+'.xlsx'),result.bytes);
 for(const [i,[name,formula,baseWanted]] of cases.entries()){const wanted=['ets-linear','ets-linear-horizon','ets-seasonal-forecast','ets-seasonal-last-phase'].includes(name)?n*baseWanted:baseWanted;const actual=after.getWorksheet('Calc').getCell(i+1,6).result;let passed;try{if(typeof wanted==='number')assert.ok(typeof actual==='number'&&Math.abs(actual-wanted)<=1e-8*Math.max(1,Math.abs(wanted)));else assert.deepEqual(actual,wanted);passed=true;}catch{passed=false;}report.checks.push({repetition:n,name,formula,wanted,actual,passed});}
 for(const sheet of book.worksheets)sheet.eachRow((row,r)=>row.eachCell((cell,c)=>{const actual=after.getWorksheet(sheet.name).getCell(r,c);assert.equal(actual.formula,cell.formula);assert.equal(actual.numFmt,cell.numFmt);if(!cell.formula)assert.deepEqual(actual.value,cell.value);}));
 const beforeZip=await JSZip.loadAsync(source),afterZip=await JSZip.loadAsync(result.bytes);for(const path of Object.keys(beforeZip.files).filter(p=>!beforeZip.files[p].dir&&!/^xl\/worksheets\/sheet\d+\.xml$/.test(p)))assert.deepEqual(await afterZip.file(path).async('uint8array'),await beforeZip.file(path).async('uint8array'),path);
 report.fixtures.push({repetition:n,sourceHash:sha(source),resultHash:sha(result.bytes),formulasStylesAndOtherPartsPreserved:true});
}
report.planned=report.checks.length;report.passed=report.checks.filter(c=>c.passed).length;report.failed=report.planned-report.passed;await writeFile(join(root,'results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({planned:report.planned,passed:report.passed,failed:report.failed}));
