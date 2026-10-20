import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gateParts} from '../scripts/run-gate-part.mjs';
import {expandGateCommands} from '../scripts/check-gate-coverage.mjs';

const scripts=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).scripts;

test('unit and ui parts together are exactly the fast chain, in order, plus the pretest builds for ui',()=>{
 const {unit,ui}=gateParts(scripts),fast=expandGateCommands(scripts['test:gates:fast'],scripts);
 assert.deepEqual(unit,['npm test']);
 assert.equal(ui[0],'npm run pretest');
 assert.deepEqual([...unit,...ui.slice(1)].sort(),[...fast].sort());
 assert.deepEqual(ui.slice(1),fast.filter(command=>command!=='npm test'));
});
test('a chain without npm test is rejected instead of silently dropping the unit tests',()=>{
 assert.throws(()=>gateParts({...scripts,'test:gates:fast':'node scripts/check-identity.mjs'}),/gate_unit_missing/);
});
