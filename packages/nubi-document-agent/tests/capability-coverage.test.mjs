import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const path=new URL('../eval/capability-coverage.mjs',import.meta.url);
const api=existsSync(path)?await import(path):{};
const catalog={domain:'sheets',fingerprint:'fixed',groups:[{name:'content',ops:['set_cell','set_formula']},{name:'editor-only',ops:['refresh_pivot']}],ops:[{op:'set_cell',group:'content'},{op:'set_formula',group:'content'},{op:'refresh_pivot',group:'editor-only',available:false}]};
test('coverage keeps every catalog entry including unsupported and newly discovered operations',()=>{
  assert.equal(typeof api.auditOperationCoverage,'function');
  const report=api.auditOperationCoverage([catalog]);
  assert.equal(report.operations.length,3);
  assert.equal(report.operations.filter(x=>x.availability==='headless_unavailable').length,1);
  assert.ok(report.operations.every(x=>x.connection==='not_connected_as_named_operation'&&x.evaluation==='not_evaluated'&&x.nativeVerified===false));
  const changed=structuredClone(catalog);changed.ops.push({op:'new_function',group:'content'});changed.groups[0].ops.push('new_function');
  assert.equal(api.auditOperationCoverage([changed]).operations.length,4);
  assert.equal(report.generalOfficeQualityMeasured,false);
});
test('coverage refuses ambiguous or incomplete catalog membership instead of silently dropping entries',()=>{
  assert.equal(typeof api.auditOperationCoverage,'function');
  for(const mutate of [c=>c.ops.push(c.ops[0]),c=>c.groups[0].ops.pop(),c=>c.groups[0].ops.push('ghost'),c=>c.ops[0].group='unknown']){
    const broken=structuredClone(catalog);mutate(broken);
    assert.throws(()=>api.auditOperationCoverage([broken]),/catalog_invalid/);
  }
  assert.throws(()=>api.auditOperationCoverage([catalog,catalog]),/catalog_invalid/);
});
test('saved audit matches every pinned source catalog and cannot inherit the small authoring cohort score',async()=>{
  const root=new URL('../eval/capabilities/',import.meta.url),catalogs=[];
  const report=JSON.parse(await readFile(new URL('coverage.json',root)));
  for(const domain of ['docs','sheets','slides']){
    const bytes=await readFile(new URL(domain+'.json',root));catalogs.push(JSON.parse(bytes));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),report.provenance.files[domain+'.json']);
  }
  const audit=api.auditOperationCoverage(catalogs);
  assert.deepEqual(report.operations,audit.operations);assert.deepEqual(report.domains,audit.domains);
  assert.equal(report.generalOfficeQualityMeasured,false);
  assert.equal(report.operations.length,162);
  assert.ok(report.operations.every(x=>x.evaluation==='not_evaluated'&&!x.nativeVerified));
});
