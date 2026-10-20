/** Freeze final generated artifacts against the independently checked candidates. */
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
const root=resolve(process.argv[2]);
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const hash=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
const model=await json(join(root,'model-results.json')),content=await json(join(root,'independent-content-checks.json')),qa=await json(join(root,'qa-results.json'));
assert.equal(model.tasks.length,9);assert.equal(content.tasks.length,9);assert.equal(qa.tasks.length,9);
const artifacts=[];let calculatedMetrics=0,rawCells=0;
for(const task of model.tasks){
 const checks=content.tasks.find(t=>t.id===task.id),render=qa.tasks.find(t=>t.id===task.id);
 assert.equal(checks.status,'automated_checks_passed');assert.equal(render.status,'rendered_pending_review');
 const ext={word:'docx',excel:'xlsx',powerpoint:'pptx'}[task.domain],path=join(root,'outputs',task.case+'.'+ext),candidate=task.domain==='excel'?render.recalculated:join(root,task.id,'candidate.'+ext);
 assert.equal(await hash(path),await hash(candidate));
 if(task.domain==='excel'){
  assert.equal(render.calculationPassed,true);assert.equal(render.calculationCases.length,3);
  for(const c of render.calculationCases){assert.equal(c.passed,true);assert.equal(c.rawPreserved,true);assert.equal(c.errors.length,0);assert.ok(c.checks.every(x=>x.passed&&x.calculatedCell));calculatedMetrics+=c.checks.length;rawCells+=c.rawCellsChecked;}
 }
 if(task.domain==='powerpoint'){
  const receipt=await json(join(root,'qa',task.case+'.presentation-validation.json'));
  assert.equal(receipt.finalSha256,await hash(path));assert.equal(receipt.packageIntegrity.status,'pass');assert.equal(receipt.presentationLayout.findingCount,0);assert.equal(receipt.presentationLayout.fontPolicy.passed,true);assert.equal(receipt.firstPartyImport.passed,true);assert.equal(receipt.nativeChartValidation.passed,true);assert.equal(receipt.nativeQuantitativeCharts.report.passed,true);
  const z=await JSZip.loadAsync(await readFile(path));assert.equal(Object.keys(z.files).filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n)).length,render.pages);
 }
 artifacts.push({id:task.id,path:relative(root,path),sha256:await hash(path),bytes:(await readFile(path)).length,pages:render.pages,contentChecksPassed:true,calculationPassed:task.domain==='excel'?true:null});
}
assert.equal(calculatedMetrics,57);assert.equal(rawCells,1707);
const reviews={training:resolve('artifacts/open-composition-1/model-quality-review-training.json'),procurement:join(root,'model-quality-review-procurement.json'),migration:join(root,'model-quality-review-migration.json')};
for(const path of Object.values(reviews)){const r=await json(path);assert.equal(r.visualReviewed,false);assert.ok(r.reviews.every(x=>x.verdicts.length===3&&x.verdicts.every(v=>v.usable)));}
const revisions=await json(join(root,'final-selection-revisions.json'));
for(const id of ['procurement-word','procurement-powerpoint']){
 const change=revisions.find(t=>t.id===id);assert.equal(change.patches.length,1);assert.equal(change.patches[0].op,'replace');assert.equal(change.patches[0].path,id.endsWith('word')?'/blocks/11/text':'/slides/3/notes');
}
const sourceHashes={};for(const p of ['src/composition.ts','src/excel-formula.ts','src/powerpoint-chart-data.ts','src/draft-planning.ts','src/file-operations.ts','eval/open-composition-cases.mjs','eval/business-table-oracle.mjs','eval/numeric-evidence.mjs','scripts/check-open-composition.mjs','scripts/qa-open-composition.py','scripts/review-open-composition.mjs','scripts/patch-open-artifact.mjs','scripts/verify-open-delivery.mjs'])sourceHashes[p]=await hash(resolve(p));
const report={kind:'generated_open_composition_delivery',verifiedAt:new Date().toISOString(),businessCases:3,artifacts,calculationVariants:9,calculatedMetrics,rawCells,sourceHashes,reviewSources:reviews,reviewLimit:'Fresh same-provider text and facts review, plus two narrowly scoped later wording patches; not independent vision or Office review.',initialResults:resolve('artifacts/open-composition-1/model-results.json'),selectionRevisions:'final-selection-revisions.json',limitations:{heldOutReliabilityMeasured:false,codexComparisonRun:false,windowsOfficeVerified:false,nascaVerified:false,workspaceConnected:false,allOfficeFeaturesVerified:false},visualReview:'See visual-review.json for the actual review scope and remaining pagination polish.'};
await writeFile(join(root,'delivery-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({files:artifacts.length,metrics:calculatedMetrics,rawCells,artifactHashesMatch:true}));
