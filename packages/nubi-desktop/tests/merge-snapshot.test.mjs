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

test('a streaming update preserves unchanged messages, sources and other tasks',()=>{
 const previous={projectId:'p',tasks:[{id:'a',messages:[{id:'m',content:'Answer',sources:[{path:'a.js',line:4}]}],streaming:'first'},{id:'b',state:'review'}]};
 const incoming=structuredClone(previous);incoming.tasks[0].streaming='second';
 const next=mergeSnapshot(previous,incoming);
 assert.equal(next.tasks[0].streaming,'second');
 assert.equal(next.tasks[0].messages,previous.tasks[0].messages);
 assert.equal(next.tasks[1],previous.tasks[1]);
 assert.notEqual(next.tasks[0],previous.tasks[0]);
 assert.equal(previous.tasks[0].streaming,'first');
});

test('deleted nested fields, shorter arrays and nulls are never hidden as unchanged',()=>{
 const previous={task:{question:{id:'q'},messages:[1,2],review:'waiting'},root:'keep'};
 const next=mergeSnapshot(previous,{task:{messages:[1],review:null}});
 assert.deepEqual(next,{task:{messages:[1],review:null},root:'keep'});
 assert.equal(mergeSnapshot(next,{task:{review:null,messages:[1]}}),next,'object key order is not a change');
 const unsafe=JSON.parse('{"task":{"__proto__":{"polluted":true}}}');
 const merged=mergeSnapshot(next,unsafe);
 assert.equal(Object.getPrototypeOf(merged.task),Object.prototype);
 assert.equal(Object.hasOwn(merged.task,'__proto__'),true);
 assert.equal({}.polluted,undefined);
});
