// Audits a composite release candidate without rewriting any earlier failed trial.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';

const main=resolve(process.argv[2]),ppt=resolve(process.argv[3]),out=resolve(process.argv[4]);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=async path=>JSON.parse(await readFile(path));
const productFiles=['src/native-model.ts','src/native-write.ts','src/index.ts','src/host-model.ts','src/contracts.ts','dist/index.js','dist/host-model.js'];
const runs=[];
for(const root of [main,ppt]){
 const report=await json(join(root,'results.json'));
 assert.ok(report.finishedAt);assert.equal(report.environment,'fixture');assert.equal(report.actualOffice2016,false);
 for(const [file,hash]of Object.entries(report.sourceHashes))assert.equal(sha(await readFile(join(root,'source',file))),hash,file);
 for(const file of productFiles)assert.equal(sha(await readFile(file)),report.sourceHashes[file],'current product drift '+file);
 runs.push({root,report,resultHash:sha(await readFile(join(root,'results.json')))});
}
for(const file of productFiles)assert.equal(runs[0].report.sourceHashes[file],runs[1].report.sourceHashes[file]);
const selected=[];
for(const [index,{root,report,resultHash}]of runs.entries()){
 for(const row of report.trials.filter(row=>index===0?row.app!=='powerpoint':row.app==='powerpoint')){
  assert.equal(row.status,'passed',row.id);assert.equal(row.result.environment,'fixture');assert.equal(row.result.savedToOffice,false);assert.equal(row.result.office2016Verified,false);assert.equal(row.result.nascaVerified,false);
  const dir=join(root,row.id),calls=await json(join(dir,'native-calls.json')),writes=calls.filter(call=>call.name==='execute_office_operations');assert.equal(writes.length,1,row.id);
  assert.ok(row.turns>=3);const transcriptFiles=(await readdir(dir)).filter(file=>/^model-\d+-(?:input|output)\.json$/.test(file));assert.equal(transcriptFiles.length,row.turns*2);
  if(row.failure){assert.equal(row.failureMatched,true);assert.equal(row.result.finished,false);assert.equal(row.result.status,{rejected:'rejected',disconnect:'uncertain',calculation_pending:'needs_review'}[row.failure]);}
  else{
   assert.equal(row.result.status,'verified_unsaved');assert.equal(row.result.finished,true);assert.equal(row.result.receipt.status,'verified_unsaved');assert.equal(row.result.writeResultUncertain,false);assert.equal(row.oracle.stateMatches,true);assert.equal(row.oracle.nonTargetStatePreserved,true);
   assert.equal(calls.at(-1).name,'inspect_office');if(row.app==='excel'){assert.equal(calls.filter(call=>call.name==='calculate_office').length,1);assert.ok(calls.at(-1).input.steps.some(step=>step.member==='Value2'));}
   const state=await json(join(dir,'final-state.json'));
   if(row.app==='word')assert.equal(state.body,`회의일은 10월 ${22+row.variant}일입니다.\r다른 문단과 승인 기록은 그대로 둡니다.\r`);
   if(row.app==='excel')assert.deepEqual(state.cells,{A1:7+row.variant,B1:3,C1:{formula:'=A1*B1'},A3:'보존 메모'});
   if(row.app==='powerpoint')assert.deepEqual(state.slides,[{shapes:[{text:'변경하지 않는 제목'},{text:'검토 확정 '+row.variant}],notes:'발표자 기록 보존'}]);
  }
  const evidenceHashes={};for(const file of ['result.json','native-calls.json','final-state.json',...transcriptFiles])evidenceHashes[file]=sha(await readFile(join(dir,file)));
  selected.push({id:row.id,provider:row.provider,app:row.app,variant:row.variant,failure:row.failure,resultStatus:row.result.status,run:root,runResultHash:resultHash,fixtureHash:report.sourceHashes['eval/native-model-fixture.mjs'],evidenceHashes});
 }
}
assert.equal(selected.length,24);assert.equal(selected.filter(row=>!row.failure).length,18);assert.equal(selected.filter(row=>row.failure).length,6);
for(const provider of ['codex','claude'])for(const app of ['word','excel','powerpoint'])assert.deepEqual(selected.filter(row=>row.provider===provider&&row.app===app&&!row.failure).map(row=>row.variant).sort(),[1,2,3]);
await mkdir(out,{recursive:true});
const result={kind:'composite_live_host_native_dto_evidence',productSourceHashes:Object.fromEntries(productFiles.map(file=>[file,runs[0].report.sourceHashes[file]])),normalPassed:18,normalPlanned:18,failureStopPassed:6,failureStopPlanned:6,claim:'Same product source, two explicitly identified fixture versions. Not one 24/24 run and not Office/COM evidence.',runs:runs.map(({root,report,resultHash})=>({root,resultHash,planned:report.planned,passed:report.passed,failed:report.failed,fixtureHash:report.sourceHashes['eval/native-model-fixture.mjs']})),trials:selected,actualOffice2016:false,nascaVerified:false,workspaceVerified:false,saveVerified:false};
await writeFile(join(out,'verified-evidence.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({normal:18,failureStops:6,fixtureVersions:2,actualOffice2016:false}));
