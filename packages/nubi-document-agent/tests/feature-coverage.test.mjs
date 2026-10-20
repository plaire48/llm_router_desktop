import test from 'node:test';import assert from 'node:assert/strict';import{existsSync}from'node:fs';
const path=new URL('../eval/feature-coverage.mjs',import.meta.url),api=existsSync(path)?await import(path):{};
const catalog={domain:'docs',fingerprint:'fixed',groups:[{name:'block',ops:['setFont','setList']}],ops:[{op:'setFont',group:'block'},{op:'setList',group:'block'}]};
const report={kind:'real_file_feature_execution',finishedAt:'2026-10-16',engineHashes:{wordExcel:'a'.repeat(64),slides:'b'.repeat(64)},plannedCases:3,trials:[1,2,3].map(index=>({domain:'word',operation:'setFont',index,status:'passed',operations:['setFont'],verified:['independent_feature_readback','non_target_preservation','source_bytes_unchanged','reopen_readback']}))};
test('feature coverage keeps unsupported rows and requires all three actual file runs',()=>{
 assert.equal(typeof api.buildFeatureCoverage,'function');const r=api.buildFeatureCoverage([catalog],{word:['setFont']},report);
 assert.equal(r.operations.length,2);assert.equal(r.operations[0].evaluation,'real_file_passed_3_of_3');assert.equal(r.operations[0].nativeVerified,false);assert.equal(r.operations[1].connection,'not_connected_as_named_operation');
 const failed=structuredClone(report);failed.trials[1].status='failed';assert.equal(api.buildFeatureCoverage([catalog],{word:['setFont']},failed).operations[0].evaluation,'real_file_failed_or_incomplete');
});
test('a fixture score or a success without independent readback cannot qualify a feature',()=>{
 assert.equal(typeof api.buildFeatureCoverage,'function');
 for(const mutate of [r=>r.kind='fixture',r=>r.trials[0].verified=[],r=>r.trials[0].operations=[]]){const r=structuredClone(report);mutate(r);assert.notEqual(api.buildFeatureCoverage([catalog],{word:['setFont']},r).operations[0].evaluation,'real_file_passed_3_of_3');}
});
