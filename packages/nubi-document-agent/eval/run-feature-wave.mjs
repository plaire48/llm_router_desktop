import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createGeneratedFileSession} from '../dist/file-operations.js';
import {createWordDocument} from '../dist/word.js';
import {createExcelDocument} from '../dist/excel.js';
import {createPowerPointDocument} from '../dist/powerpoint.js';
import {createNodeGenOfficeEngine} from '../scripts/genoffice-node-port.mjs';
import {cases,inspectPreservation} from './feature-wave-cases.mjs';
const output=resolve(process.argv[2]??'artifacts/feature-wave-1'),source=resolve(process.argv[3]??'/Users/ganadi/Documents/office_x');
const engine=createNodeGenOfficeEngine({wordExcelEnginePath:join(source,'dist/cli/genoffice-engine.cjs'),slideEnginePath:join(output,'engine/slides.cjs'),...(process.argv[4]?{xlsxEditorEnginePath:resolve(process.argv[4]),xlsxSidecarPath:resolve('artifacts/genoffice-xlsx-sidecar/source/target/release/xlsx-sidecar')}:{})}),signal=new AbortController().signal;
const hash=b=>createHash('sha256').update(b).digest('hex'),cell=value=>({value,formula:null,format:'general',role:'body'}),font={fontFamily:'Apple SD Gothic Neo'};
async function seed(domain,n){
  if(domain==='word')return (await createWordDocument({title:'문서 기능 검토',paperSize:'A4',sections:[{heading:'검토 항목',paragraphs:[[{text:`변경 대상 ${n}`,bold:false}],[{text:`보존 문구 ${n}`,bold:true}]],table:{headers:['항목','값'],rows:[['A',String(10*n)],['B',String(20*n)]]}}]},signal,font)).bytes;
  if(domain==='excel')return (await createExcelDocument({title:'기능 검토',sheets:[{name:'데이터',columnWidths:[24,20,24],rows:[['상태','금액','구분'],['완료',10*n,'A'],['진행',20*n,'B'],['완료',30*n,'A'],[null,null,null],['병합 대상',null,null]].map(row=>row.map(cell))},{name:'보존',columnWidths:[30],rows:[[cell(`보존 문구 ${n}`)]]}]},signal,font)).bytes;
  return (await createPowerPointDocument({title:'슬라이드 기능 검토',slides:[{title:'검토 항목',paragraphs:[`검토 대상 ${n}`],table:{headers:['항목','값'],rows:[['A',String(10*n)],['B',String(20*n)]]},notes:'보존 노트'},...['보존 슬라이드','후속 슬라이드'].map(title=>({title,paragraphs:[`보존 문구 ${n}`],table:null,notes:`별도 노트 ${n}`}))]},signal,font)).bytes;
}
await mkdir(output,{recursive:true});
const report={schemaVersion:1,startedAt:new Date().toISOString(),kind:'real_file_feature_execution',modelMeasured:false,actualOffice2016:false,nascaVerified:false,plannedCases:cases.length*3,trials:[]};
report.sourceHashes={};for(const file of ['src/file-operations.ts','src/file-operation-validation.ts','src/operation-catalogs.json','src/host-operation-catalogs.json','src/excel.ts','src/excel-formula.ts','scripts/genoffice-sheet-copy.mjs','scripts/genoffice-node-port.mjs','scripts/xlsx-editor-runtime.mjs','scripts/univer-missing-functions.mjs','scripts/univer-ets-functions.mjs','scripts/libreoffice-ets.mjs','scripts/libreoffice-depreciation.mjs','scripts/excel-formula-prefix.mjs','package-lock.json','vendor/calculation-reference/libreoffice-source.json','scripts/univer-formula-results.mjs','scripts/univer-function-extensions.mjs','scripts/univer-pivot-function.mjs','scripts/build-xlsx-editor-engine.mjs','eval/feature-wave-cases.mjs','eval/run-feature-wave.mjs'])report.sourceHashes[file]=hash(await readFile(new URL('../'+file,import.meta.url)));
report.engineHashes={wordExcel:hash(await readFile(join(source,'dist/cli/genoffice-engine.cjs'))),slides:hash(await readFile(join(output,'engine/slides.cjs')))};
if(process.argv[4]){report.engineHashes.editor=hash(await readFile(resolve(process.argv[4])));report.engineHashes.xlsxSidecar=hash(await readFile(resolve('artifacts/genoffice-xlsx-sidecar/source/target/release/xlsx-sidecar')));}
for(let n=1;n<=3;n++)for(const c of cases)report.trials.push({domain:c.domain,operation:c.op,index:n,status:'not_run'});
await writeFile(join(output,'results.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
for(const row of report.trials){
  const c=cases.find(c=>c.domain===row.domain&&c.op===row.operation),directory=join(output,`${row.domain}-${row.operation}-${row.index}`),ext={word:'docx',excel:'xlsx',powerpoint:'pptx'}[row.domain];
  await mkdir(directory,{recursive:true});const before=await seed(row.domain,row.index);await writeFile(join(directory,'source.'+ext),before);row.sourceSha256=hash(before);
  let session;
  try{
    session=await createGeneratedFileSession({domain:row.domain,origin:'new_unencrypted_draft',bytes:before},engine);
    await c.prepare?.(session,row.index,signal);let observed=await session.read(signal);
    const ops=c.ops(row.index,observed.observation);row.operations=ops.map(o=>o.op);await writeFile(join(directory,'operations.json'),JSON.stringify(ops,null,2)+'\n');
    let result=await session.apply(ops,observed.revision,signal);
    if(row.operation==='ungroupElement'){const group=result.observation.pages[0].elements.find(e=>e.type==='group');result=await session.apply([{op:'ungroupElement',target:{slide:0,el:group.id}}],result.revision,signal);row.operations.push('ungroupElement');}
    const after=session.snapshot().bytes;row.candidateSha256=hash(after);await writeFile(join(directory,'candidate.'+ext),after);
    await c.check(after,row.index,result.observation);await inspectPreservation(row.domain,before,after,row.index,row.operation);
    if(hash(before)!==row.sourceSha256)throw Error('source_mutated');
    row.status='passed';row.verified=['independent_feature_readback','non_target_preservation','source_bytes_unchanged','reopen_readback'];
    await writeFile(join(directory,'readback.json'),JSON.stringify(result.observation,null,2)+'\n');
  }catch(error){row.status='failed';row.error=error.code??error.message;await writeFile(join(directory,'error.json'),JSON.stringify({error:row.error,detail:error.detail??null},null,2)+'\n');}
  finally{session?.dispose();}
  await writeFile(join(output,'results.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({domain:row.domain,operation:row.operation,index:row.index,status:row.status,error:row.error}));
}
report.finishedAt=new Date().toISOString();report.passed=report.trials.filter(t=>t.status==='passed').length;report.failed=report.trials.filter(t=>t.status==='failed').length;await writeFile(join(output,'results.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({planned:report.plannedCases,passed:report.passed,failed:report.failed}));
