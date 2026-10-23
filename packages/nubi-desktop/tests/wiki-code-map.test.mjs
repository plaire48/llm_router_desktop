import {removeLater} from './helpers-cleanup.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {analyzeRepository} from '../runtime/wiki-code-map-core.mjs';
import {createWikiCodeContext,formatWikiCodeContext,CODE_MAP_LIMITS} from '../runtime/wiki-code-map.mjs';
import {runCodeAnalysis} from '../runtime/code-quality.mjs';
import {hash} from '../runtime/files.mjs';

const inputs=rows=>Object.entries(rows).map(([path,content])=>({path,content,hash:hash(content)}));
const decode=text=>JSON.parse(text.slice(text.indexOf('\n')+1));
async function fixture(t,rows){
  const root=await mkdtemp(path.join(os.tmpdir(),'nubi-code-map-'));
  removeLater(root);
  for(const [rel,content] of Object.entries(rows)){await mkdir(path.dirname(path.join(root,rel)),{recursive:true});await writeFile(path.join(root,rel),content);}
  return root;
}
const corpus={
  'src/math.ts':'export function total(n: number) { return n + 1; }',
  'src/index.ts':"export {total as calculate} from './math.js';",
  'src/main.ts':"import {calculate as compute} from './index.js';\nexport function run() { return compute(2); }\nexport function local() { const compute = (n: number) => n * 2; return compute(2); }",
  'src/other.ts':'export function total() { return -1; }',
  'tests/main.test.ts':"import {run} from '../src/main.js'; run();",
};

test('page context keeps assigned files and direct static neighbors while omitting unrelated modules',()=>{
 const map=analyzeRepository({files:inputs(corpus)});map.coverage={incomplete:false};map.artifacts=[];
 const page=decode(formatWikiCodeContext(map,{phase:'page',seedPaths:['/src/math.ts']}));
 assert(page.files.some(row=>row.path==='src/math.ts'));
 assert(page.files.some(row=>row.path==='src/index.ts'));
 assert(!page.files.some(row=>row.path==='src/other.ts'));
 assert(page.omittedFiles>0);assert.equal(page.coverage.incomplete,true);
 const planning=decode(formatWikiCodeContext(map,{phase:'planning'}));assert.equal(planning.files.length,map.files.length);
});

test('resolves imports, reexports and aliased calls without confusing same-named or shadowed symbols',()=>{
  const map=analyzeRepository({files:inputs(corpus)});
  assert.equal(map.scope,'static_symbols_and_references');
  assert.equal(map.files.every(file=>file.syntaxErrors===0),true);
  assert.ok(map.edges.some(edge=>edge.kind==='reexport'&&edge.path==='src/index.ts'&&edge.target==='src/math.ts'));
  const calls=map.edges.filter(edge=>edge.kind==='call'&&edge.path==='src/main.ts');
  assert.deepEqual(calls.map(edge=>edge.target),['src/math.ts','src/main.ts']);
  assert.ok(calls.every(edge=>map.symbols.some(symbol=>symbol.id===edge.symbol)));
  assert.equal(map.edges.some(edge=>edge.target==='src/other.ts'),false);
  assert.equal(map.symbols.find(symbol=>symbol.name==='run').start,2);
});

test('does not invent runtime dispatch, package aliases, missing-file or invalid-syntax relations',()=>{
  const map=analyzeRepository({files:inputs({
    'main.ts':"import {run} from '@/not-admitted';\nimport './missing.js';\nexport function invoke(fn: any) { return fn(); }\nrun();",
    'broken.ts':'export function broken( {',
  })});
  assert.equal(map.edges.length,0);
  assert.ok(map.unresolved.some(row=>row.reason==='external_or_alias'));
  assert.ok(map.unresolved.some(row=>row.reason==='outside_admitted_map'));
  assert.ok(map.unresolved.some(row=>row.reason==='dynamic_or_unresolved'));
  assert.ok(map.files.find(row=>row.path==='broken.ts').syntaxErrors>0);
  assert.equal(map.symbols.some(row=>row.path==='broken.ts'),false);
});

test('uses TypeScript extension substitution with a closed host, never executes source/configuration',()=>{
  const map=analyzeRepository({files:inputs({
    'main.ts':"import {run} from './worker.js'; run();",
    'worker.ts':'export function run() { throw new Error("NEVER EXECUTE"); }',
    'worker.js':'export function run() { return 0; }',
  })});
  assert.ok(map.edges.some(edge=>edge.kind==='call'&&edge.target==='worker.ts'));
  assert.equal(map.edges.some(edge=>edge.target==='worker.js'),false);
});

test('indexes top-level policy constants without treating dynamically assigned variables as function targets',()=>{
  const map=analyzeRepository({files:inputs({'policy.ts':'export const LIMIT = 50000;\nconst RATES = {gold: 7};\nconst dynamic = choose();\ndynamic();'})});
  assert.ok(map.symbols.some(symbol=>symbol.name==='LIMIT'&&symbol.kind==='constant'&&symbol.start===1));
  assert.ok(map.symbols.some(symbol=>symbol.name==='RATES'));
  assert.equal(map.edges.some(edge=>edge.kind==='call'),false);
  assert.equal(map.unresolved.length,2);
});

test('repository mode works through the isolated analysis worker and cancellation remains bounded',async()=>{
  const result=await runCodeAnalysis({mode:'repository',files:inputs(corpus)});
  assert.ok(result.edges?.some(edge=>edge.target==='src/math.ts'));
  const controller=new AbortController();controller.abort();
  assert.deepEqual(await runCodeAnalysis({mode:'repository',files:inputs(corpus)},{signal:controller.signal}),{error:'cancelled'});
});

test('collects once per run, excludes private/ignored/generated paths and sees fresh source on the next run',async t=>{
  const root=await fixture(t,{...corpus,'.env':'SECRET', '.openwikiignore':'excluded/\n','excluded/private.ts':'export const privateValue=1;', 'openwiki/page.md':'old wiki', 'package.json':'{}', 'python/main.py':'print(1)'});
  let calls=0;const analyze=async input=>{calls++;return analyzeRepository(input);};
  const context=createWikiCodeContext(root,{analyze});
  const [first,second]=await Promise.all([context({phase:'planning'}),context({phase:'page',seedPaths:['/src/main.ts']})]);
  const map=decode(first);assert.equal(calls,1);
  assert.equal(map.files.some(row=>row.path.includes('private')||row.path.includes('openwiki')),false);
  assert.ok(map.artifacts.some(row=>row.path==='package.json'));
  assert.ok(map.coverage.otherSourceFiles>0);
  assert.equal(decode(second).files[0].path,'src/main.ts');
  const before=map.files.find(row=>row.path==='src/math.ts').hash;
  await writeFile(path.join(root,'src/math.ts'),'export function total(n: number) { return n + 3; }');
  await rm(path.join(root,'src/other.ts'));
  const next=decode(await createWikiCodeContext(root,{analyze})({}));
  assert.notEqual(next.files.find(row=>row.path==='src/math.ts').hash,before);
  assert.equal(next.files.some(row=>row.path==='src/other.ts'),false);
});

test('symlink targets are never admitted to the structure worker',async t=>{
  const outside=await fixture(t,{'secret.ts':'throw Error("OUTSIDE")'}),root=await fixture(t,{'safe.ts':'export const safe=1;'});
  await symlink(path.join(outside,'secret.ts'),path.join(root,'linked.ts'));
  let seen=[];
  await createWikiCodeContext(root,{analyze:async input=>{seen=input.files;return analyzeRepository(input);}})({});
  assert.equal(seen.some(row=>row.path==='linked.ts'||row.content.includes('OUTSIDE')),false);
});

test('coverage discloses skipped large files and syntax failures instead of implying a complete graph',async t=>{
  const root=await fixture(t,{'big.ts':'x'.repeat(CODE_MAP_LIMITS.fileBytes+1),'bad.ts':'function fail( {','good.ts':'export function good() {}'});
  const result=decode(await createWikiCodeContext(root)({}));
  assert.equal(result.coverage.incomplete,true);
  assert.equal(result.coverage.skippedCodeFiles,1);
  assert.equal(result.coverage.syntaxErrorFiles,1);
});

test('optional parser failure falls back to existing source tools but user cancellation propagates',async t=>{
  const root=await fixture(t,{'main.ts':'export function main() {}'});
  const text=await createWikiCodeContext(root,{analyze:async()=>({error:'analysis_timeout'})})({});
  assert.equal(decode(text).available,false);
  assert.equal(decode(text).coverage.incomplete,true);
  const controller=new AbortController();controller.abort();
  await assert.rejects(createWikiCodeContext(root,{signal:controller.signal})({}),{name:'AbortError'});
});

test('large maps remain valid bounded JSON with seed and adjacent caller priority',()=>{
  const files=Array.from({length:400},(_,i)=>({path:`module-${i}.ts`,hash:'a'.repeat(64),syntaxErrors:0}));
  const map={files,symbols:files.flatMap(file=>Array.from({length:30},(_,i)=>({path:file.path,name:'symbol'+i,start:i+1,end:i+1}))),edges:[{kind:'call',path:'module-398.ts',target:'module-399.ts'}],unresolved:[],coverage:{incomplete:false},artifacts:Array.from({length:80},()=>({path:'very-long/'.repeat(200)+'package.json'}))};
  const text=formatWikiCodeContext(map,{phase:'page',seedPaths:['/module-399.ts']});
  assert.ok(text.length<=CODE_MAP_LIMITS.characters);
  const result=decode(text);
  assert.deepEqual(result.files.slice(0,2).map(file=>file.path),['module-399.ts','module-398.ts']);
  assert.ok(result.omittedFiles>0);assert.ok(result.omittedArtifacts>0);assert.ok(result.omittedSymbols>0);
  assert.equal(result.coverage.incomplete,true);
});
