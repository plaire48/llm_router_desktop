// Existing real host models choose and execute edits through the existing file loop.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {createEvaluationHosts} from '../eval/dual-cli-host.mjs';
import {createHostModelTransport} from '../dist/host-model.js';
import {prepareFileDocument} from '../dist/file-operations.js';
import {inspectGeneratedExcel} from '../dist/excel.js';
import {createNodeGenOfficeEngine} from './genoffice-node-port.mjs';

const baseline=resolve(process.argv[2]),root=resolve(process.argv[3]),sha=b=>createHash('sha256').update(b).digest('hex');
await mkdir(root,{recursive:true});const sources={};
for(const file of ['src/file-operations.ts','src/excel-formula.ts','dist/file-operations.js','scripts/genoffice-node-port.mjs','scripts/evaluate-live-cell-edit.mjs','scripts/check-live-sensitivity.py']){const bytes=await readFile(file);sources[file]=sha(bytes);const out=join(root,'source',file);await mkdir(dirname(out),{recursive:true});await copyFile(file,out);}
const hosts=await createEvaluationHosts({requireToolCalls:true}),engine=createNodeGenOfficeEngine({wordExcelEnginePath:'/Users/ganadi/Documents/office_x/dist/cli/genoffice-engine.cjs',slideEnginePath:resolve('artifacts/hard-business-1/build/slides.cjs')});
const rows=await Promise.all(['codex','claude'].map(async provider=>{
 const dir=join(baseline,provider+'-excel'),original=await readFile(join(dir,'revise/final.xlsx')),plan=JSON.parse(await readFile(join(dir,'revise/final-plan.json'))),business=JSON.parse(await readFile(join(dir,'business.json'))),out=join(root,provider);await mkdir(out,{recursive:true});
 let turn=0;const calls=[],host=hosts.host(provider),transport=createHostModelTransport({...host,async complete(messages,tools,context){const n=turn++;await writeFile(join(out,'host-'+n+'-input.json'),JSON.stringify({messages,tools},null,2));const reply=await host.complete(messages,tools,context);await writeFile(join(out,'host-'+n+'-output.json'),JSON.stringify(reply,null,2));return reply;}});
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),600000);let result;
 try{result=await prepareFileDocument({domain:'excel',origin:'new_unencrypted_draft',bytes:original,request:'비용 민감도 시트의 입력 항목을 읽고 추가 할인율을 10%, 예산 축소율을 25%로 바꾸세요. 이번 수정에서는 해당 입력 두 셀만 set_cell로 수정하고 나머지 값, 수식, 서식, 시트는 모두 유지하세요. 실제 읽기와 작업 목록으로 위치와 인자를 확인하고, 수정 후 readback을 확인한 뒤 finish_file_draft로 마무리하세요. 계산 검증과 최종 저장은 호스트가 담당합니다.'},engine,transport,controller.signal,{onTool:name=>calls.push(name)});}finally{clearTimeout(timer);}
 const before=await inspectGeneratedExcel(original),after=await inspectGeneratedExcel(result.bytes);assert.equal(after.sheets.length,before.sheets.length);
 for(const [si,s]of before.sheets.entries())for(const [ri,cells]of s.rows.entries())for(const [ci,c]of cells.entries()) {
  if(s.name==='비용 민감도'&&ci===1&&(ri===4||ri===5))assert.equal(after.sheets[si].rows[ri][ci].value,ri===4?.1:.25);
  else assert.deepEqual(after.sheets[si].rows[ri][ci],c,`${provider}/${s.name}/${ri}/${ci}`);
 }
 assert.equal(sha(await readFile(join(dir,'revise/final.xlsx'))),sha(original));assert.equal(result.savedToOffice,false);await writeFile(join(out,'input.xlsx'),result.bytes);
 console.log(JSON.stringify({provider,modelCalls:turn,tools:calls,appliedBatches:result.appliedBatches,nonTargetCellsPreserved:true,savedToOffice:false}));
 return{provider,id:'actual_host_edit',discount:.1,reduction:.25,datasets:business.datasets,outputs:plan.outputs.filter(o=>['discountScenario','reducedBudgetGap'].includes(o.metric)),file:join(out,'input.xlsx'),originalHash:sha(original),editedHash:sha(result.bytes),nonTargetCellsPreserved:true,calls,modelCalls:turn,appliedBatches:result.appliedBatches,savedToOffice:false};
}));
await writeFile(join(root,'contract.json'),JSON.stringify({rows,models:hosts.metadata,sourceHashes:sources,actualOffice2016:false,nascaVerified:false},null,2));
