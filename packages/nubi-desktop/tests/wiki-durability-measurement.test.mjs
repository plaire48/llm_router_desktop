import {removeLater} from './helpers-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const measurement=await import('../scripts/measure-wiki-durability.mjs').catch(error=>{
 if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};
});

test('Q1 seeded interruption schedule covers eight faults and keeps twenty reproducible randomized runs',()=>{
 assert.equal(typeof measurement.durabilitySchedule,'function');
 const schedule=measurement.durabilitySchedule(481);
 assert.equal(schedule.length,20);assert.equal(new Set(schedule).size,8);
 assert.deepEqual(schedule,measurement.durabilitySchedule(481));
 assert.notDeepEqual(schedule,measurement.durabilitySchedule(482));
 assert.throws(()=>measurement.durabilitySchedule(NaN),/invalid_seed/);
});

test('Q1 completion rate excludes partial-only, unverified, manual and failed outcomes from the fixed denominator',()=>{
 assert.equal(typeof measurement.summarizeDurability,'function');
 const done=()=>({state:'completed',verified:true,manualRetries:0,resumes:1,partialPublications:0});
 const rows=Array.from({length:20},done);rows[0]={...done(),state:'partial',partialPublications:1,resumes:0};rows[1]={...done(),verified:false};
 const result=measurement.summarizeDurability(rows);
 assert.equal(result.runs,20);assert.equal(result.completedWithoutHuman,18);assert.equal(result.completionRate,.9);assert.equal(result.passed,true);
 assert.equal(result.partialPublications,1);assert.equal(result.meanResumes,.95);
 rows[2]={...done(),manualRetries:1};assert.equal(measurement.summarizeDurability(rows).passed,false);
 assert.throws(()=>measurement.summarizeDurability(rows.slice(1)),/twenty_runs_required/);
});

test('Q1 measurement retains a failed attempt and still executes the remaining randomized runs',async()=>{
 assert.equal(typeof measurement.measureWikiDurability,'function');let calls=0;const seen=[];
 const result=await measurement.measureWikiDurability({seed:481,run:async({injection})=>{
   calls++;seen.push(injection);if(calls===2)throw Error('synthetic_interruption_not_recovered');
   return {state:'completed',verified:true,manualRetries:0,resumes:1,partialPublications:0};
 }});
 assert.equal(calls,20);assert.equal(seen.length,20);assert.equal(result.rows.length,20);
 assert.equal(result.rows[1].state,'failed');assert.equal(result.rows[1].error,'synthetic_interruption_not_recovered');
 assert.equal(result.rows[1].resumes,null);assert.equal(result.meanResumes,null);assert.equal(result.resumeSamples,19);
 assert.equal(result.passed,false,'missing counters invalidate the measurement even when 19/20 completions are observed');
 assert.equal(result.completedWithoutHuman,19);assert.equal(result.completionRate,.95);
});

test('Q1 preserves an existing measurement instead of overwriting it on rerun',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'q1-output-'));removeLater(directory);
 const file=path.join(directory,'first.json');await writeFile(file,'original measurement');
 assert.equal(typeof measurement.reserveDurabilityOutput,'function');
 await assert.rejects(measurement.reserveDurabilityOutput(file,{status:'running'}),{code:'EEXIST'});
 assert.equal(await readFile(file,'utf8'),'original measurement');
 const fresh=path.join(directory,'new.json'),write=await measurement.reserveDurabilityOutput(fresh,{status:'running'});
 await write({status:'passed'});assert.equal(JSON.parse(await readFile(fresh,'utf8')).status,'passed');
});

for(const injection of ['network','rate_limit','server_error','timeout','output_limit','app_restart','sleep_resume','model_reconnect'])test(`Q1 native ${injection} completes verified pages without replaying the completed page`,{timeout:60000},async()=>{
 const fixture=await import('./helpers/wiki-durability-fixture.mjs').catch(error=>{if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;return {};});
 assert.equal(typeof fixture.runDurabilityScenario,'function');
 const result=await fixture.runDurabilityScenario({injection,index:0,seed:481});
 assert.equal(result.state,'completed',JSON.stringify(result));assert.equal(result.verified,true,JSON.stringify(result));
 assert.equal(result.sources,11);assert.equal(result.verifiedPages,2);assert.ok(result.pages>=2);assert.equal(result.manualRetries,0);
 assert.equal(result.pageWrites['/openwiki/quickstart.md'],1,'the completed page is not replayed after interruption');
 assert.equal(result.pageWrites[result.retainedPage],1);
 assert.ok(result.injected>0);
});

test('Q1 rejects a completed state when an ungrounded addition changes the other published page',{timeout:60000},async()=>{
 const {runDurabilityScenario}=await import('./helpers/wiki-durability-fixture.mjs');
 const result=await runDurabilityScenario({injection:'network',corruptPage:true});
 assert.equal(result.state,'completed');assert.equal(result.verified,false);assert.equal(result.error,'write_unconfirmed');
});
