import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('Excel and PPT comparison plans keep all unmeasured trials without starting product CLIs',async()=>{
  const root=await mkdtemp(join(tmpdir(),'nubi-office-plan-'));
  try{
    for(const domain of ['excel','powerpoint']){
      const output=join(root,domain),result=spawnSync(process.execPath,[new URL('../scripts/benchmark-office.mjs',import.meta.url).pathname,domain,output,'--plan-only'],{encoding:'utf8'});
      assert.equal(result.status,0,result.stderr);
      const report=JSON.parse(await readFile(join(output,'results.json')));
      assert.equal(report.attemptedTrials,0);assert.equal(report.measuredDrafts,0);
      assert.equal(report.trials.length,6);assert.ok(report.trials.every(t=>t.status==='not_run'));
      assert.equal(report.fullProductWorkflowMeasured,false);
    }
  }finally{await rm(root,{recursive:true,force:true});}
});
