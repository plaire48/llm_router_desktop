import assert from 'node:assert/strict';import {readFile,writeFile}from'node:fs/promises';import{join,resolve}from'node:path';import{createHash}from'node:crypto';import{expandExcelComposition}from'../dist/composition.js';import{cases}from'../eval/quality-business-cases.mjs';
const beforeRoot=resolve(process.argv[2]),afterRoot=resolve(process.argv[3]),rows=[],sha=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const c of cases)for(const mode of ['captured','fresh']){
 const id='codex-'+c.id+'-'+mode,originalBytes=await readFile(join(beforeRoot,id,'final-plan.json')),finalBytes=await readFile(join(afterRoot,id,'final-plan.json')),original=JSON.parse(originalBytes),plan=JSON.parse(finalBytes),before=expandExcelComposition(original,c.datasets),after=expandExcelComposition(plan,c.datasets);let formulas=0,scalars=0;
 assert.deepEqual(plan.outputs,original.outputs);assert.equal(after.sheets.length,before.sheets.length);
 for(const [si,sheet]of before.sheets.entries()){
  assert.equal(after.sheets[si].name,sheet.name);assert.deepEqual(plan.sheets[si].tables,original.sheets[si].tables);
  for(const [ri,row]of sheet.rows.entries())for(const [ci,cell]of row.entries()){
   const actual=after.sheets[si].rows[ri]?.[ci];if(cell.formula!==null){assert.equal(actual?.formula,cell.formula);formulas++;}if(['number','boolean'].includes(typeof cell.value)){assert.equal(actual?.value,cell.value);scalars++;}
  }
 }
 rows.push({id,originalPlanFileHash:sha(originalBytes),finalPlanFileHash:sha(finalBytes),formulasPreserved:formulas,numericAndBooleanCellsPreserved:scalars,sourceTablesAndPositionsPreserved:true,outputAddressesPreserved:true});
}
await writeFile(join(afterRoot,'preservation.json'),JSON.stringify({passed:rows.length,planned:4,baseline:beforeRoot,rows},null,2)+'\n');console.log(JSON.stringify({passed:rows.length,planned:4,formulas:rows.reduce((n,row)=>n+row.formulasPreserved,0)}));
