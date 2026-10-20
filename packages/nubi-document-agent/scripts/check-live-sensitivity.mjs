// Edit actual live-host output through the existing GenOffice file port.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createGeneratedFileSession} from '../dist/file-operations.js';
import {inspectGeneratedExcel} from '../dist/excel.js';
import {createNodeGenOfficeEngine} from './genoffice-node-port.mjs';

const baseline=resolve(process.argv[2]),root=resolve(process.argv[3]);
const hash=b=>createHash('sha256').update(b).digest('hex');
const engine=createNodeGenOfficeEngine({wordExcelEnginePath:'/Users/ganadi/Documents/office_x/dist/cli/genoffice-engine.cjs',slideEnginePath:resolve('artifacts/hard-business-1/build/slides.cjs')});
const rows=[];await mkdir(root,{recursive:true});
for(const provider of ['codex','claude']) {
 const dir=join(baseline,provider+'-excel'),original=await readFile(join(dir,'revise/final.xlsx'));
 const plan=JSON.parse(await readFile(join(dir,'revise/final-plan.json'))),business=JSON.parse(await readFile(join(dir,'business.json')));
 const observed=await inspectGeneratedExcel(original),sheet=observed.sheets.find(s=>s.name==='비용 민감도');
 assert.equal(sheet.rows[4][1].value,.05);assert.equal(sheet.rows[5][1].value,.15);
 for(const [id,discount,reduction]of [['unchanged_rate',0,0],['higher_rate',.1,.25],['clamp_zero',1.2,.15]]) {
  const session=await createGeneratedFileSession({domain:'excel',origin:'new_unencrypted_draft',bytes:original},engine);
  let edited;
  try{const seen=await session.read(new AbortController().signal);await session.apply([{op:'set_cell',sheet:'비용 민감도',address:'B5',value:discount},{op:'set_cell',sheet:'비용 민감도',address:'B6',value:reduction}],seen.revision,new AbortController().signal);edited=session.snapshot().bytes;}finally{session.dispose();}
  const after=await inspectGeneratedExcel(edited);assert.equal(after.sheets.length,observed.sheets.length);
  for(const [si,s]of observed.sheets.entries())for(const [ri,cells]of s.rows.entries())for(const [ci,cell]of cells.entries()) {
   if(s.name==='비용 민감도'&&ci===1&&(ri===4||ri===5))assert.equal(after.sheets[si].rows[ri][ci].value,ri===4?discount:reduction);
   else assert.deepEqual(after.sheets[si].rows[ri][ci],cell,`${provider}/${s.name}/${ri}/${ci}`);
  }
  const sub=join(root,provider+'-'+id);await mkdir(sub,{recursive:true});await writeFile(join(sub,'input.xlsx'),edited);
  rows.push({provider,id,discount,reduction,datasets:business.datasets,outputs:plan.outputs.filter(o=>['discountScenario','reducedBudgetGap'].includes(o.metric)),file:join(sub,'input.xlsx'),originalHash:hash(original),editedHash:hash(edited),nonTargetCellsPreserved:true});
 }
 assert.equal(hash(await readFile(join(dir,'revise/final.xlsx'))),hash(original));
}
await writeFile(join(root,'contract.json'),JSON.stringify({rows,actualOffice2016:false,nascaVerified:false},null,2));
console.log(JSON.stringify({edited:rows.length,nonTargetCellsPreserved:true,originalFilesUnchanged:true}));
