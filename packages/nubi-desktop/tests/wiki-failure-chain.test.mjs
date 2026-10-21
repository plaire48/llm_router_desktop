import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wikiFailureChain} from '../runtime/desktop-features.mjs';

// Design §8 답 26: the state record keeps a diagnostic cause chain made of error names,
// code-shaped messages and schema issue paths, never model text or file paths.
test('wiki failure chain keeps codes, names and zod issue paths through the cause chain',()=>{
  const zod=Object.assign(new Error('[\n  {"code":"invalid_type","path":["checks"]}\n]'),{name:'ZodError',issues:[{path:['checks'],code:'invalid_type',message:'Required'},{path:['issues',0,'reason'],code:'too_small',message:'short'}]});
  const review=new Error('wiki_review_schema_invalid',{cause:zod});
  const failed=new Error('wiki_failed',{cause:review});
  const {at,chain}=wikiFailureChain(failed);
  assert.ok(!Number.isNaN(Date.parse(at)));
  assert.deepEqual(chain.map(entry=>[entry.name,entry.code]),[['Error','wiki_failed'],['Error','wiki_review_schema_invalid'],['ZodError',null]]);
  assert.deepEqual(chain[2].issues,[{path:'checks',code:'invalid_type'},{path:'issues.0.reason',code:'too_small'}]);
  assert.equal(chain[0].issues,undefined);
});

test('wiki failure chain never records free text or paths and stops on cycles and depth',()=>{
  const leaked=new Error('The model wrote /Users/someone/secret.md and said hello');
  leaked.cause=leaked;
  const {chain}=wikiFailureChain(leaked);
  assert.equal(chain.length,1);
  assert.equal(chain[0].code,null);
  assert.equal(JSON.stringify(chain).includes('secret'),false);
  const node=Object.assign(new Error('ENOENT: no such file or directory, open /tmp/x'),{code:'ENOENT'});
  assert.equal(wikiFailureChain(node).chain[0].code,'ENOENT');
  let deep=new Error('wiki_leaf');
  for(let index=0;index<8;index++)deep=new Error('wiki_level_'+index,{cause:deep});
  assert.equal(wikiFailureChain(deep).chain.length,5);
  // One call: two calls can straddle a millisecond (Windows gates 2026-10-21, at 420 vs 421).
  const empty=wikiFailureChain(null);assert.deepEqual(empty,{at:empty.at,chain:[]});assert.ok(!Number.isNaN(Date.parse(empty.at)));
});
