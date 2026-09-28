import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AGENT_ENGINE} from '../../../extensions/aipro-chat/agent-runtime.js';

const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'));

test('Office distribution keeps exact Pi runtime pins independently of the shared engine label',async()=>{
  const manifest=await json('../package.json'),lock=await json('../package-lock.json');
  for(const name of ['pi-agent-core','pi-ai','pi-coding-agent']){
    const key=`@earendil-works/${name}`,installed=await json(`../node_modules/${key}/package.json`);
    assert.equal(manifest.dependencies[key],'0.86.1',`${key}: review the distribution version before changing this contract`);
    assert.equal(lock.packages[''].dependencies[key],manifest.dependencies[key]);
    assert.equal(lock.packages[`node_modules/${key}`].version,manifest.dependencies[key]);
    assert.match(lock.packages[`node_modules/${key}`].integrity,/^sha512-/);
    assert.equal(installed.version,manifest.dependencies[key],`${key}: Office-local install must match the distribution lock`);
  }
  // Current shared source declares the engine family; older reviewed snapshots
  // declared its version as well. Neither label proves the installed binary.
  assert.ok(['pi-agent-core','pi-agent-core@0.86.1'].includes(AGENT_ENGINE));
});
