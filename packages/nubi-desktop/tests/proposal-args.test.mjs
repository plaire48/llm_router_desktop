import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeProposalArgs} from '../runtime/proposal-args.mjs';

// File proposals in the model's own field names reach validation in the tool's names (user report 2026-10-14).
const task={changePlan:{targets:[{path:'src/new.js',reason:'요구사항 R1의 새 모듈',action:'create'}]}};

test('a new file proposal with other field names, line lists and no reason is mapped',()=>{
  assert.deepEqual(normalizeProposalArgs('propose_new_file',{file_path:'src/new.js',contents:['a','b'],taskId:'x',language:'js'},task),
    {path:'src/new.js',content:'a\nb',reason:'요구사항 R1의 새 모듈'});
});

test('patch edits accept old and new, and a path outside the plan gets no invented reason',()=>{
  assert.deepEqual(normalizeProposalArgs('propose_patch',{path:'other.js',hash:'h1',changes:[{old:'x',new:'y'}]},task),
    {path:'other.js',expectedHash:'h1',edits:[{oldText:'x',newText:'y'}]});
});

test('other tools and well-formed input are left alone',()=>{
  const input={path:'src/new.js',content:'a',reason:'r'};
  assert.deepEqual(normalizeProposalArgs('propose_new_file',input,task),input);
  assert.equal(normalizeProposalArgs('read_source',input,task),input);
});
