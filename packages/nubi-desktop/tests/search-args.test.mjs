import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSearchArgs} from '../runtime/search-args.mjs';

test('source_search aliases from other models fold into the validated shape',()=>{
  assert.deepEqual(normalizeSearchArgs({pattern:'TODO',path:'src',type:'files'}),{query:'TODO',within:'src',mode:'path'});
  assert.deepEqual(normalizeSearchArgs({q:' useState ',directory:'./ui/',mode:'grep'}),{query:'useState',within:'./ui/',mode:'content'});
  assert.deepEqual(normalizeSearchArgs({query:['a','b'],within:['','lib']}),{query:'a',within:'lib'});
  // source_search has an include glob since 2026-10-23: a glob scope keeps its directory and passes the file pattern on.
  assert.deepEqual(normalizeSearchArgs({query:'x',glob:'src/**/*.ts'}),{query:'x',within:'src',include:'src/**/*.ts'});
  assert.deepEqual(normalizeSearchArgs({query:'x',glob:'*.md'}),{query:'x',include:'*.md'});
  assert.deepEqual(normalizeSearchArgs({query:42,kind:'code'}),{query:'42',kind:'all'});
  assert.deepEqual(normalizeSearchArgs(null),{});assert.deepEqual(normalizeSearchArgs({mode:'odd'}),{mode:'odd'},'unknown values still reach validation');
});

test('regex, case sensitivity and include arrive under the names models use',()=>{
  assert.deepEqual(normalizeSearchArgs({pattern:'fo+',regex:true,case_sensitive:true,include:'*.ts'}),{query:'fo+',regex:true,caseSensitive:true,include:'*.ts'});
  assert.deepEqual(normalizeSearchArgs({query:'a',isRegex:'true',matchCase:'false',filePattern:'**/*.js'}),{query:'a',regex:true,caseSensitive:false,include:'**/*.js'});
});
