// Verify saved evaluation evidence; does not re-score historical model failures.
import assert from 'node:assert/strict';
import {readFile,writeFile,readdir,mkdir,copyFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';

const root=resolve(process.argv[2]),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
// The production fingerprint hashes canonical object-key order, not file formatting.
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value!==null&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const json=async path=>JSON.parse(await readFile(path));
const contract=await json(join(root,'contract.json'));
assert.equal(Array.isArray(contract.planned)?contract.planned.length:contract.planned,4);
for(const [file,hash] of Object.entries(contract.sourceHashes))assert.equal(sha(await readFile(join(root,'source',file))),hash,file);
const rows=[];
for(const task of ['codex-delivery-captured','codex-renewal-captured','codex-delivery-fresh','codex-renewal-fresh']){
 const dir=join(root,task),result=await json(join(dir,'result.json'));
 assert.equal(result.status,'verified_draft',task);
 const rounds=(await readdir(dir)).filter(name=>/^round-\d+$/.test(name)).sort((a,b)=>Number(a.slice(6))-Number(b.slice(6)));
 assert.equal(rounds.length,result.rounds.length);
 const finalDir=join(dir,rounds.at(-1)),receipt=await json(join(finalDir,'receipt.json')),readback=await json(join(finalDir,'readback.json'));
 const artifactHash=sha(await readFile(join(dir,'final.xlsx')));
 assert.equal(artifactHash,result.artifactHash??result.hash);assert.equal(artifactHash,receipt.artifactHash);assert.equal(artifactHash,readback.artifactHash);
 assert.equal(sha(await readFile(join(finalDir,'candidate.xlsx'))),artifactHash);
 assert.equal(sha(canonical(await json(join(dir,'final-plan.json')))),receipt.planHash);
 const allPages=receipt.pages.rendered.map(page=>page.page),reviewed={};
 assert.equal(allPages.length,receipt.pages.count);assert.ok(allPages.length>0);
 for(const page of receipt.pages.rendered)assert.equal(sha(await readFile(join(finalDir,'render','page-'+page.page+'.png'))),page.imageHash);
 for(const provider of contract.reviewers??['claude','codex']){
  const seen=new Set();
  for(const file of (await readdir(finalDir)).filter(name=>new RegExp('^visual-'+provider+'-\\d+\\.json$').test(name))){
   const review=await json(join(finalDir,file));assert.ok(review.factsPassed&&review.visualPassed);
   for(const page of review.reviewedPages)seen.add(page);
  }
  reviewed[provider]=[...seen].sort((a,b)=>a-b);assert.deepEqual(reviewed[provider],allPages);
 }
 for(const kind of ['structure','facts','preservation','render','layout','visual','calculation'])assert.equal(receipt.checks.find(check=>check.kind===kind)?.status,'passed',task+' '+kind);
 assert.ok(!receipt.findings.some(finding=>finding.severity==='major'));
 assert.equal(readback.rawPreserved,true);assert.equal(readback.calculation.errors.length,0);
 assert.deepEqual(readback.calculation.variants.map(variant=>variant.id),['base','input_change','zero_activity']);
 for(const variant of readback.calculation.variants){assert.equal(variant.passed,true);assert.equal(variant.errors.length,0);assert.ok(variant.checks.every(check=>check.passed&&check.formula));}
 const first=await json(join(dir,rounds[0],'receipt.json'));
 rows.push({id:task,mode:result.mode??'baseline_recheck',status:result.status,preflight:result.preflight??[],repairs:result.repairs,rounds:rounds.length,firstFailedChecks:first.checks.filter(check=>check.status!=='passed').map(check=>check.kind),pages:allPages.length,reviewed,artifactHash,planHash:receipt.planHash,rawCellsChecked:readback.calculation.rawCellsChecked,calculationStates:readback.calculation.variants.map(variant=>({id:variant.id,passed:variant.passed,checks:variant.checks.length})),remainingMinor:receipt.findings.filter(finding=>finding.severity==='minor')});
}
const result={kind:'verified_excel_authoring_evidence',contractHash:sha(await readFile(join(root,'contract.json'))),trials:rows,passed:rows.length,planned:Array.isArray(contract.planned)?contract.planned.length:contract.planned,pages:rows.reduce((count,row)=>count+row.pages,0),actualOffice2016:false,nascaVerified:false,workspaceVerified:false};
await writeFile(join(root,'verified-evidence.json'),JSON.stringify(result,null,2)+'\n');
// Freeze the independent reference/edit contract beside its recorded hashes.
if(process.argv[3]){
 const semantics=resolve(process.argv[3]),proof=await json(join(semantics,'contract.json'));
 for(const [file,hash]of Object.entries(proof.sourceHashes)){
  const bytes=await readFile(file);assert.equal(sha(bytes),hash,file);
  const out=join(semantics,'source',file);await mkdir(dirname(out),{recursive:true});await copyFile(file,out);
 }
 const checks=await json(join(semantics,'result.json'));assert.equal(checks.passed,checks.total);assert.equal(checks.nonTargetPreserved,true);
}
console.log(JSON.stringify({passed:result.passed,planned:result.planned,pages:result.pages}));
