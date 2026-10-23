import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixtures.mjs';
import {searchSource} from '../runtime/source-search.mjs';
import {git} from '../runtime/files.mjs';
// source_search options adopted from opencode's grep tool: regex, case sensitivity and an include glob (2026-10-23).
const noSearch={resolveSearch:async()=>{throw Error('native missing');}};
async function project(t){
 const {service,root}=await fixture(t);await mkdir(path.join(root,'src','deep'),{recursive:true});
 await writeFile(path.join(root,'src','a.ts'),'export function fooo(x) {}\nconst Keyword = 1;\n');
 await writeFile(path.join(root,'src','b.js'),'keyword lower\nfo( literal\n');
 await writeFile(path.join(root,'src','deep','c.test.js'),'test("Keyword", () => {});\n');
 await git(root,['add','-A']);return service;
}
for(const [engine,deps] of [['ripgrep',undefined],['filesystem',noSearch]]){
 test(`${engine}: regex, case sensitivity and include narrow the search`,async t=>{
  const service=await project(t),files=async args=>(await searchSource.call(service,args,deps)).files.map(file=>file.path).sort();
  assert.deepEqual(await files({query:'fo+\\(',regex:true}),['src/a.ts','src/b.js']);
  assert.deepEqual(await files({query:'fo+\\('}),[],'without regex the pattern is literal text');
  assert.deepEqual(await files({query:'Keyword',caseSensitive:true}),['src/a.ts','src/deep/c.test.js']);
  assert.deepEqual(await files({query:'keyword'}),['src/a.ts','src/b.js','src/deep/c.test.js'],'case is ignored by default');
  assert.deepEqual(await files({query:'keyword',include:'*.ts'}),['src/a.ts']);
  assert.deepEqual(await files({query:'keyword',include:'**/*.test.js'}),['src/deep/c.test.js']);
  assert.deepEqual(await files({query:'keyword',include:'src/*.{ts,js}'}),['src/a.ts','src/b.js']);
  await assert.rejects(searchSource.call(service,{query:'(unclosed',regex:true},deps),/search_pattern_invalid/);
 });
}
