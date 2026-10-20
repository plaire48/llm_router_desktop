import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {createHash} from 'node:crypto';import {scanSensitivePatterns} from '../scripts/check-safety-regression.mjs';
const shared=await import('../../nubi-office/eval/synthetic-values.mjs').catch(()=>({}));
const originals=[
  {
    "path": "packages/nubi-desktop/eval/computer/apps/admin-console.json",
    "canonicalSha256": "ad35baec30c58d4c62915e315096643dd825a5b9f8743201a9b809544a945cb2"
  },
  {
    "path": "packages/nubi-desktop/eval/easy-80/cases.json",
    "canonicalSha256": "bf4e1944ea3d177d6e48334a629003a45ff482a24560815a3bc557f394fa3756"
  },
  {
    "path": "packages/nubi-desktop/eval/easy-80/cases-v2.json",
    "canonicalSha256": "9d08a8b979ec4a32b0127c1f713b05773baca8a1a2ed1e55532c577e0891b417"
  },
  {
    "path": "packages/nubi-desktop/eval/medium-40/cases.json",
    "canonicalSha256": "e2b7564b4d18fbec2d38fd959cbd9e43005113b188a30da8d7bbe6cb5522facd"
  },
  {
    "path": "packages/nubi-office/eval/cases.json",
    "canonicalSha256": "31264e089f72facef006224284f223383eb34b04054e7a084f1cb83a1841b81c"
  }
];
const sha=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
test('five source fixtures contain no positive privacy patterns after marker encoding',async()=>{for(const row of originals){const bytes=await readFile(new URL('../../../'+row.path,import.meta.url));assert.deepEqual(scanSensitivePatterns(row.path,bytes),[],row.path);}});
test('synthetic marker decoding is immutable and rejects unknown markers',()=>{assert.equal(typeof shared.hydrateSyntheticFixture,'function');const value={text:'unchanged',rows:[null,7]};assert.deepEqual(shared.hydrateSyntheticFixture(value),value);assert.throws(()=>shared.hydrateSyntheticFixture('{{synthetic:unknown}}'),/synthetic_fixture_marker_unknown/);});
test('resolved complete corpora match the original independent SHA values',async()=>{assert.equal(typeof shared.readSyntheticFixture,'function');for(const row of originals){const value=await shared.readSyntheticFixture(new URL('../../../'+row.path,import.meta.url));assert.equal(sha(value),row.canonicalSha256,row.path);}});
test('actual Desktop loaders restore the original full computer and easy/medium cases',async()=>{const [{loadEasyCases},{loadMediumCases},{loadComputerCases}]=await Promise.all([import('../eval/easy-80/run.mjs'),import('../eval/medium-40/run.mjs'),import('../eval/computer.mjs')]);for(const [i,value] of [[1,await loadEasyCases(1)],[2,await loadEasyCases(2)],[3,await loadMediumCases()]])assert.equal(sha(value),originals[i].canonicalSha256,originals[i].path);const {apps}=await loadComputerCases();const app=apps instanceof Map?apps.get('admin-console'):apps['admin-console'];assert.equal(sha(app.definition),originals[0].canonicalSha256);});
