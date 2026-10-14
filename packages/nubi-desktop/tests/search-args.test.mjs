import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSearchArgs} from '../runtime/search-args.mjs';

test('source_search aliases from other models fold into the validated shape',()=>{
  assert.deepEqual(normalizeSearchArgs({pattern:'TODO',path:'src',type:'files'}),{query:'TODO',within:'src',mode:'path'});
  assert.deepEqual(normalizeSearchArgs({q:' useState ',directory:'./ui/',mode:'grep'}),{query:'useState',within:'./ui/',mode:'content'});
  assert.deepEqual(normalizeSearchArgs({query:['a','b'],within:['','lib']}),{query:'a',within:'lib'});
  assert.deepEqual(normalizeSearchArgs({query:'x',glob:'src/**/*.ts'}),{query:'x',within:'src'});
  assert.deepEqual(normalizeSearchArgs({query:'x',glob:'*.md'}),{query:'x'});
  assert.deepEqual(normalizeSearchArgs({query:42,kind:'code'}),{query:'42',kind:'all'});
  assert.deepEqual(normalizeSearchArgs(null),{});assert.deepEqual(normalizeSearchArgs({mode:'odd'}),{mode:'odd'},'unknown values still reach validation');
});
