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

test('a late change retains shared fields across a reordered snapshot',()=>{
 const previous={task:{id:'t',messages:[{content:'Retain this answer'}],sources:[{path:'source.md'}],elapsed:1}};
 const incoming={task:{sources:structuredClone(previous.task.sources),messages:structuredClone(previous.task.messages),id:'t',elapsed:2}};
 const merged=mergeSnapshot(previous,incoming);
 assert.equal(merged.task.messages,previous.task.messages);assert.equal(merged.task.sources,previous.task.sources);assert.equal(merged.task.elapsed,2);assert.equal(previous.task.elapsed,1);
});

test('copying a shared prefix preserves an own proto field without changing the prototype',()=>{
 const previous=JSON.parse('{"task":{"stable":"value","__proto__":{"safe":true},"elapsed":1}}'),incoming=structuredClone(previous);incoming.task.elapsed=2;
 const merged=mergeSnapshot(previous,incoming);
 assert.equal(Object.getPrototypeOf(merged.task),Object.prototype);assert.equal(Object.hasOwn(merged.task,'__proto__'),true);assert.equal(merged.task.__proto__,previous.task.__proto__);assert.equal({}.safe,undefined);
});

test('a sparse array preserves holes and length when a later element changes',()=>{
 const previous={rows:new Array(5)},incoming={rows:new Array(5)};previous.rows[0]={id:'stable'};previous.rows[4]=1;incoming.rows[0]={id:'stable'};incoming.rows[4]=2;
 const merged=mergeSnapshot(previous,incoming);
 assert.equal(merged.rows.length,5);assert.equal(1 in merged.rows,false);assert.equal(merged.rows[0],previous.rows[0]);assert.equal(merged.rows[4],2);
});
