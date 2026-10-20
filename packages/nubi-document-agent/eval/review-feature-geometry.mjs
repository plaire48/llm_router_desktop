import{readFile,writeFile}from'node:fs/promises';import{resolve,join}from'node:path';import{createHash}from'node:crypto';
import{parts}from'./feature-wave-cases.mjs';import{shapeBoxes,inspectFlowGeometry}from'./pptx-geometry-oracle.mjs';
const wave=resolve(process.argv[2]??'artifacts/feature-wave-2'),model=resolve(process.argv[3]??'artifacts/feature-model-1'),hash=b=>createHash('sha256').update(b).digest('hex'),rows=[];
for(let index=1;index<=3;index++)for(const operation of ['alignElements','distributeElements']){
 const path=join(wave,`powerpoint-${operation}-${index}/candidate.pptx`),bytes=await readFile(path),p=await parts(bytes),boxes=shapeBoxes(await p.xml('ppt/slides/slide1.xml'),['단계 1','단계 2','단계 3']);
 const passed=boxes.length===3&&(operation==='alignElements'?new Set(boxes.map(b=>b.y)).size===1:Math.abs((boxes[1].x-boxes[0].x-boxes[0].cx)-(boxes[2].x-boxes[1].x-boxes[1].cx))<=1);
 rows.push({operation,index,sha256:hash(bytes),passed,boxes});
}
await writeFile(join(wave,'independent-geometry-results.json'),JSON.stringify({kind:'independent_xml_geometry',planned:6,passed:rows.filter(r=>r.passed).length,checks:rows},null,2)+'\n',{flag:'wx'});
if(process.argv[4]==='--geometry-only'){console.log(JSON.stringify({independentCases:rows.filter(r=>r.passed).length}));process.exit(0);}
const path=join(model,'powerpoint/candidate.pptx'),bytes=await readFile(path),p=await parts(bytes),checks=inspectFlowGeometry(await p.xml('ppt/slides/slide1.xml'),['요청 접수','검토','완료']),original=JSON.parse(await readFile(join(model,'results.json'))),old=original.tasks.find(t=>t.domain==='powerpoint'),other=Object.entries(old.checks).filter(([k])=>!['threeShapes','alignment','spacing'].includes(k));
const review={kind:'corrected_independent_geometry_review',originalResultPreserved:true,originalStatus:old.status,reason:'The old oracle selected a:ext creation metadata rather than p:spPr/a:xfrm/a:ext.',artifactSha256:hash(bytes),oracleSha256:hash(await readFile(new URL('./pptx-geometry-oracle.mjs',import.meta.url))),checks:{...Object.fromEntries(other),...checks},modelCalledAgain:false,actualOffice2016:false};review.passed=Object.values(review.checks).every(Boolean);
await writeFile(join(model,'corrected-geometry-review.json'),JSON.stringify(review,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({independentCases:rows.filter(r=>r.passed).length,modelReview:review}));
