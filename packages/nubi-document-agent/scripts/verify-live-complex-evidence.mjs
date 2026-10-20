import assert from 'node:assert/strict';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const root=resolve(process.argv[2]),json=async file=>JSON.parse(await readFile(file)),sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v!==null&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const contract=await json(join(root,'contract.json'));
for(const [file,hash]of Object.entries(contract.sourceHashes))assert.equal(sha(await readFile(join(root,'source',file))),hash,file);
const {preservedPlanUnits}=await import(pathToFileURL(join(root,'source/eval/live-complex-cases.mjs')));
const rows=[];
for(const provider of ['codex','claude'])for(const domain of ['word','excel','powerpoint']) {
 const id=provider+'-'+domain;if(contract.selected&&!contract.selected.includes(id))continue;
 const dir=join(root,id),result=await json(join(dir,'result.json')),ext={word:'docx',excel:'xlsx',powerpoint:'pptx'}[domain];
 for(const phase of contract.phases??['create','revise']) {
  const stage=result.stages.find(s=>s.phase===phase),row={id,phase,status:stage?.status??'missing',verified:false,errors:[]};rows.push(row);
  if(stage?.status!=='verified_draft')continue;
  try {
   const out=join(dir,phase),final=await readFile(join(out,'final.'+ext)),plan=await json(join(out,'final-plan.json'));
   const last=stage.rounds.at(-1);assert(last.complete);assert.equal(sha(final),stage.artifactHash);assert.equal(sha(final),last.artifactHash);assert.equal(sha(canonical(plan)),last.planHash);
   const evidence=join(out,'round-'+last.round),receipt=await json(join(evidence,'quality-receipt.json')),rb=await json(join(evidence,'readback.json'));
   assert.equal(receipt.artifactHash,last.artifactHash);assert.equal(rb.artifactHash,last.artifactHash);assert.equal(receipt.planHash,last.planHash);
   assert.equal(sha(await readFile(join(evidence,'candidate.'+ext))),sha(final));
   assert(receipt.checks.every(c=>c.status==='passed'));assert(!receipt.findings.some(f=>f.severity==='major'));
   const pages=receipt.pages.rendered.map(p=>p.page);assert.equal(pages.length,receipt.pages.count);assert.deepEqual(pages,receipt.pages.reviewed);
   if(domain==='powerpoint')assert.equal(pages.length,plan.slides.length);
   for(const p of receipt.pages.rendered)assert.equal(sha(await readFile(join(evidence,'render','page-'+p.page+'.png'))),p.imageHash);
   row.reviewers={};
   for(const reviewer of contract.reviewProviders) {
    const seen=new Set();for(const file of (await readdir(evidence)).filter(f=>new RegExp('^visual-'+reviewer+'-\\d+\\.json$').test(f))) {
     const review=await json(join(evidence,file));assert(review.factsPassed&&review.visualPassed);for(const page of review.reviewedPages)seen.add(page);
    }
    row.reviewers[reviewer]=[...seen].sort((a,b)=>a-b);assert.deepEqual(row.reviewers[reviewer],pages);
   }
   if(domain==='excel') {
    assert(rb.rawPreserved);assert.equal(rb.calculation.errors.length,0);assert.deepEqual(rb.calculation.variants.map(v=>v.id),['base','input_change','zero_activity']);
    for(const v of rb.calculation.variants){assert(v.passed);assert.equal(v.errors.length,0);assert(v.checks.every(c=>c.passed&&c.formula));if(phase==='revise')for(const metric of ['discountScenario','reducedBudgetGap'])assert(v.checks.some(c=>c.metric===metric&&c.passed));}
    row.rawCells=rb.calculation.rawCellsChecked;row.calculationStates=rb.calculation.variants.map(v=>({id:v.id,checks:v.checks.length}));
   }
   if(phase==='revise')assert(preservedPlanUnits(domain,await json(join(dir,'create/final-plan.json')),plan));
   row.pages=pages.length;row.repairs=stage.repairs;row.hostCalls=stage.calls.length;row.firstFailed=stage.rounds[0].checks.filter(c=>c.status!=='passed').map(c=>c.kind);row.remainingMinor=receipt.findings.filter(f=>f.severity==='minor');row.artifactHash=sha(final);row.verified=true;
  }catch(error){row.errors.push(error.message);}
 }
}
const packet={kind:'live_complex_evidence_verification',createdAt:new Date().toISOString(),contractHash:sha(await readFile(join(root,'contract.json'))),planned:rows.length,passed:rows.filter(r=>r.verified).length,failed:rows.filter(r=>!r.verified).length,pages:rows.reduce((n,r)=>n+(r.pages||0),0),rows,actualOffice2016:false,nascaVerified:false,workspaceSaveVerified:false};
await writeFile(join(root,'verified-evidence.json'),JSON.stringify(packet,null,2));
console.log(JSON.stringify({planned:packet.planned,passed:packet.passed,failed:packet.failed,pages:packet.pages}));
