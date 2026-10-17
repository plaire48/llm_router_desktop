import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWikiGraph} from '../ui/wiki-graph.mjs';
import {deriveMailClusterKinds} from '../ui/wiki-map-groups.mjs';
import {recordedWikiGraph,wikiMapInsights} from '../ui/wiki-map-insights.mjs';
const node=(path,extra={})=>({path,title:path,...extra});
test('duplicate and reciprocal references count once',()=>{
 const graph=buildWikiGraph([node('a/1'),node('b/2'),node('c/3')],[{from:'a/1',to:'b/2'},{from:'a/1',to:'b/2'},{from:'b/2',to:'a/1'}]);
 const r=wikiMapInsights(graph);assert.equal(r.total,3);assert.equal(r.recordedPairs,1);assert.equal(r.connected.length,2);assert.equal(r.bridges.length,2);assert.equal(r.isolated.length,1);assert.deepEqual(r.bridges.find(n=>n.path==='a/1').otherGroups,['b']);
});
test('candidate neighbors neither inflate connectivity nor create bridges',()=>{
 const graph=buildWikiGraph([node('a/1'),node('b/2'),node('a/3')],[{from:'a/1',to:'a/3'},{from:'a/1',to:'b/2',kind:'subject',confidence:'candidate',label:'주제 유사 후보'}]);
 const before=structuredClone(graph),r=wikiMapInsights(graph);assert.equal(r.recordedPairs,1);assert.equal(r.candidates.length,1);assert.equal(r.connected.length,2);assert.equal(r.bridges.length,0);assert.deepEqual(r.isolated.map(n=>n.path),['b/2']);assert.equal(r.graph.nodes.find(n=>n.path==='a/1').degree,1);assert.deepEqual(graph,before);assert.equal(recordedWikiGraph(graph,true).nodes.find(n=>n.path==='a/1').degree,2);
});
test('mail groups use recorded category, not collection month or cluster label',()=>{
 const graph=deriveMailClusterKinds(buildWikiGraph([node('2026-01/a',{type:'Mail',category:'장애/접수',tags:['임시 키워드']}),node('2026-02/b',{type:'Mail',category:'장애/대응'}),node('2026-01/c',{type:'Mail',category:'배포'})],[{from:'2026-01/a',to:'2026-02/b',kind:'reply',confidence:'header'},{from:'2026-02/b',to:'2026-01/c',kind:'reply',confidence:'header'}]));
 const r=wikiMapInsights(graph);assert.deepEqual(r.groups.map(g=>[g.label,g.count,g.connected]),[['장애',2,2],['배포',1,1]]);assert.deepEqual(r.bridges.map(n=>n.path).sort(),['2026-01/c','2026-02/b']);
});
test('unknown categories and root pages do not become semantic bridge claims',()=>{
 const r=wikiMapInsights(buildWikiGraph([node('root.md'),node('api/a')],[{from:'root.md',to:'api/a'}]));assert.equal(r.connected.length,2);assert.equal(r.bridges.length,0);
});
test('same folder and tag do not manufacture links',()=>{
 const r=wikiMapInsights(buildWikiGraph([node('api/a',{tags:['같은 태그']}),node('api/b',{tags:['같은 태그']})]));assert.equal(r.connected.length,0);assert.equal(r.isolated.length,2);assert.equal(r.recordedPairs,0);assert.equal(r.candidates.length,0);
});
test('empty and large disconnected datasets retain truthful denominators',()=>{
 const empty=wikiMapInsights(buildWikiGraph());assert.equal(empty.total,0);assert.deepEqual(empty.groups,[]);
 const r=wikiMapInsights(buildWikiGraph(Array.from({length:5000},(_,i)=>node(`section${i%5}/${i}`))));assert.equal(r.total,5000);assert.equal(r.isolated.length,5000);assert.equal(r.groups.reduce((n,g)=>n+g.count,0),5000);assert(r.groups.every(g=>g.connected===0));
});

test('reading evidence follows the selected document and preserves original paths',()=>{
 const r=wikiMapInsights(buildWikiGraph([node('a/1'),node('b/2'),node('c/3')],[{from:'b/2',to:'a/1'},{from:'a/1',to:'c/3',kind:'subject',confidence:'candidate',label:'주제 유사 후보'}]));
 assert.equal(r.documents.find(n=>n.path==='a/1').evidence[0].path,'b/2');
 assert.equal(r.documents.find(n=>n.path==='a/1').evidence[0].reasons[0],'이 문서를 참조');
 assert.equal(r.documents.find(n=>n.path==='b/2').evidence[0].reasons[0],'이 문서가 참조');
 assert.equal(r.documents.find(n=>n.path==='c/3').evidence.length,0);
});
