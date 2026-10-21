import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {gateParts} from '../scripts/run-gate-part.mjs';
import {expandGateCommands} from '../scripts/check-gate-coverage.mjs';
const scripts=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).scripts;
test('unit halves cover sorted test files exactly once and retain test flags and pretest',async()=>{
 const files=(await readdir(new URL('.',import.meta.url))).filter(name=>name.endsWith('.test.mjs')).sort();
 const parts=gateParts(scripts,[...files].reverse()),mid=Math.ceil(files.length/2);
 for(const [part,expected] of [['unit-a',files.slice(0,mid)],['unit-b',files.slice(mid)]]){
  assert.equal(parts[part][0],'npm run pretest');
  assert.equal(parts[part][1],'node --test --test-concurrency=1 '+expected.map(name=>'tests/'+name).join(' '));
 }
 const fast=expandGateCommands(scripts['test:gates:fast'],scripts);
 assert.deepEqual(parts.ui,['npm run pretest',...fast.filter(command=>command!=='npm test')]);
});
test('odd file count has no overlap and non-tests are excluded',()=>{
 const parts=gateParts(scripts,['z.test.mjs','fixture.mjs','a.test.mjs','m.test.mjs']);
 assert.equal(parts['unit-a'][1],'node --test --test-concurrency=1 tests/a.test.mjs tests/m.test.mjs');
 assert.equal(parts['unit-b'][1],'node --test --test-concurrency=1 tests/z.test.mjs');
});
test('missing unit command, unsupported test script and empty half fail closed',()=>{
 assert.throws(()=>gateParts({...scripts,'test:gates:fast':'node scripts/check-identity.mjs'},[]),/gate_unit_missing/);
 assert.throws(()=>gateParts({...scripts,test:'custom runner'},['a.test.mjs','b.test.mjs']),/gate_unit_script/);
 assert.throws(()=>gateParts(scripts,['a.test.mjs']),/gate_unit_files/);
});
