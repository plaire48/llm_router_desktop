import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const path=new URL('../eval/host-authoring.mjs',import.meta.url),api=existsSync(path)?await import(path):{};
test('host evaluation preserves a failed first draft beside its corrected artifact and fixed denominator',async()=>{
  assert.equal(typeof api.runHostAuthoringEvaluation,'function','Host authoring evaluation is missing');
  const draft=JSON.parse(await readFile(new URL('../eval/WD-CREATE-01.reference-draft.json',import.meta.url)));
  const root=await mkdtemp(join(tmpdir(),'nubi-host-eval-'));
  const host={id:'test-model',async complete(messages){
    const feedback=messages.some(m=>typeof m.content==='string'&&m.content.includes('검사 피드백'));
    const results=messages.filter(m=>m.role==='tool');
    if(!results.length)return {content:'',calls:[{id:'source',function:{name:'read_word_sources',arguments:'{}'}}]};
    if(results.length===1){const proposal=structuredClone(draft);if(!feedback)proposal.sections[1].table.rows[3][1]='99';return {content:'',calls:[{id:'draft',function:{name:'submit_word_draft',arguments:JSON.stringify(proposal)}}]};}
    return {content:'초안 준비',calls:[]};
  }};
  try{
    const report=await api.runHostAuthoringEvaluation({host,output:root,domains:['word'],trials:1,qualityRepairs:1,evidence:'fixture'});
    assert.equal(report.plannedTrials,1);assert.equal(report.initialPassed,0);assert.equal(report.finalPassed,1);
    assert.equal(report.trials[0].attempts.length,2);assert.equal(report.trials[0].attempts[0].evaluation.passed,false);
    assert.equal(report.trials[0].attempts[1].evaluation.passed,true);assert.equal(report.modelMeasured,false);
    for(const row of report.trials[0].attempts)assert.ok((await readFile(join(root,row.artifact))).length>1000);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('missing host authentication stops model dispatch and leaves remaining planned trials unmeasured',async()=>{
  assert.equal(typeof api.runHostAuthoringEvaluation,'function');
  const root=await mkdtemp(join(tmpdir(),'nubi-host-blocked-'));let calls=0;
  try{
    const report=await api.runHostAuthoringEvaluation({host:{id:'m',async complete(){calls++;throw Error('claude_login_required');}},output:root,domains:['word','excel','powerpoint'],trials:3,evidence:'fixture'});
    assert.equal(report.plannedTrials,9);assert.equal(calls,1);assert.equal(report.finalPassed,0);
    assert.equal(report.trials.filter(t=>t.status==='not_run').length,8);
    assert.equal(report.trials[0].attempts[0].error,'claude_login_required');
  }finally{await rm(root,{recursive:true,force:true});}
});
