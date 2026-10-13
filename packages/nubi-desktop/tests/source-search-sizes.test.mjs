// What files exist, and which is largest, is answered from the path listing (2026-10-14): a folder question no longer
// needs a shell command and its approval.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';

test('a path search lists the current size of each file',async t=>{
  const {root,service}=await fixture(t);
  await mkdir(path.join(root,'data'),{recursive:true});await writeFile(path.join(root,'data','big.txt'),'x'.repeat(5000));await writeFile(path.join(root,'data','small.txt'),'y');
  const result=await service.search({query:'.txt',mode:'path'});
  const sizes=Object.fromEntries(result.results.map(item=>[item.path,item.bytes]));
  assert.equal(sizes['data/big.txt'],5000);assert.equal(sizes['data/small.txt'],1);assert.equal(sizes['app.txt'],'first\nsecond\nthird\nfourth\nfifth\nsixth\nlast\n'.length);
  assert.match(result.instruction,/size in bytes/);
});
