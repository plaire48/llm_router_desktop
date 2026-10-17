import test from 'node:test';
import assert from 'node:assert/strict';
import {commitGraphPage} from '../ui/commit-graph.mjs';
const row=(id,...parents)=>({id,parents});
test('linear commits share one lane and root has no invented parent',()=>{
 const graph=commitGraphPage([row('c','b'),row('b','a'),row('a')]);
 assert.equal(graph.columns,1);assert.deepEqual(graph.rows.map(r=>r.column),[0,0,0]);
 assert.equal(graph.rows[0].edges.some(e=>e.kind==='incoming'),false);
 assert.equal(graph.rows[2].edges.some(e=>e.kind==='outgoing'),false);assert.deepEqual(graph.next.lanes,[]);
});
test('merge, branch work and reunion preserve parent identities across pages',()=>{
 const commits=[row('merge','main','side'),row('side','base'),row('main','base'),row('base')];
 const whole=commitGraphPage(commits),first=commitGraphPage(commits.slice(0,2));
 const saved=structuredClone(first.next),second=commitGraphPage(commits.slice(2),first.next);
 assert.deepEqual(first.next,saved,'input checkpoint is immutable');
 assert.deepEqual([...first.rows,...second.rows],whole.rows);assert.deepEqual(second.next,whole.next);
 assert.equal(whole.rows[0].merge,true);assert.equal(whole.columns,2);
 assert.deepEqual(first.next.lanes.map(l=>l?.id),['main','base']);
 assert.equal(second.rows[0].edges.find(e=>e.kind==='outgoing').to,1);
});
test('octopus merges and disconnected roots keep every edge',()=>{
 const graph=commitGraphPage([row('m','a','b','c'),row('a','r'),row('b','r'),row('c','r'),row('r'),row('other')]);
 assert.equal(graph.columns,3);assert.equal(graph.rows[0].edges.filter(e=>e.kind==='outgoing').length,3);
 assert.equal(graph.rows.at(-1).edges.length,0);assert.deepEqual(graph.next.lanes,[]);
});
test('unloaded parents continue below the page without a fabricated root',()=>{
 const graph=commitGraphPage([row('tip','later')]);assert.deepEqual(graph.next.lanes,[{id:'later',color:0}]);
 assert.equal(graph.rows[0].edges[0].kind,'outgoing');
});
test('many pages render only their rows and match a full traversal',()=>{
 const commits=Array.from({length:10000},(_,i)=>row(String(i),...(i<9999?[String(i+1)]:[])));
 let next;const rows=[];for(let i=0;i<commits.length;i+=25){const page=commitGraphPage(commits.slice(i,i+25),next);assert.equal(page.rows.length,25);rows.push(...page.rows);next=page.next;}
 assert.deepEqual(rows,commitGraphPage(commits).rows);assert.deepEqual(next.lanes,[]);
});
