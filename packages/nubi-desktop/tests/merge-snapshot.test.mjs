import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeSnapshot} from '../ui/mergeSnapshot.js';

// An unchanged poll keeps the same object, so the workspace does not re-render (2026-10-14).
test('identical snapshots keep the previous object and unchanged fields keep their identity',()=>{
  const previous={projectId:'p',tasks:[{id:'t',state:'running'}],files:['a']};
  assert.equal(mergeSnapshot(previous,{tasks:[{id:'t',state:'running'}],files:['a']}),previous);
  const next=mergeSnapshot(previous,{tasks:[{id:'t',state:'done'}],files:['a']});
  assert.notEqual(next,previous);assert.equal(next.files,previous.files);assert.equal(next.tasks[0].state,'done');assert.equal(next.projectId,'p');
});
