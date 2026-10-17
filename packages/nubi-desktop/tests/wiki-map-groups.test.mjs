import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWikiGraph,createWikiLayout,advanceWikiLayout,wikiLayoutPositions,wikiViewportItems} from '../ui/wiki-graph.mjs';
import {groupWikiGraph,clusterWikiGraph,wikiMapModes,deriveMailClusterKinds} from '../ui/wiki-map-groups.mjs';

test('mail topics use real relations or existing clusters, not timestamps or generic mail type',()=>{
 const items=[{path:'a',title:'누비 배포',type:'Mail',date:'2026-10-01'},{path:'b',title:'Re: 누비 배포',type:'Mail',date:'2026-11-01'},{path:'c',title:'식단 안내',type:'Mail',date:'2026-10-01'},{path:'d',title:'위키 품질',type:'Mail',cluster:'wiki',clusterTitle:'위키 개선',tags:['위키 개선']},{path:'e',title:'조사 결과',type:'Mail',cluster:'wiki',clusterTitle:'위키 개선',tags:['위키 개선']}];
 const original=buildWikiGraph(items,[{from:'a',to:'b',kind:'reply',confidence:'header',label:'회신'}]);
 const graph=groupWikiGraph(original,'topic'),section=path=>graph.nodes.find(node=>node.path===path).section;
 assert.equal(wikiMapModes(original.kind)[0].id,'topic');
 assert.equal(section('a'),section('b'));assert.notEqual(section('a'),section('c'));assert.equal(section('d'),section('e'));
 assert(graph.sections.some(group=>group.label==='위키 개선'));assert.equal(graph.links,original.links,'groups never manufacture evidence edges');
 assert.equal(original.nodes[0].section,'','source metadata is unchanged');
 assert.deepEqual(groupWikiGraph(original,'month').sections.map(group=>group.id).sort(),['2026-10','2026-11','날짜 없음']);
});
test('cluster kinds fall back to recorded broad categories without inventing relationships',()=>{
 const source=buildWikiGraph([{path:'a',title:'서로 다른 메일 제목',type:'Mail',category:'SR처리/접수'},{path:'b',title:'별개의 요청',type:'Mail',category:'SR처리/이력내용'},{path:'c',title:'휴가 승인',type:'Mail',category:'결재'},{path:'d',title:'제목으로 분류하지 마세요',type:'Mail'}]);
 const graph=groupWikiGraph(source,'type');
 assert.deepEqual(graph.sections.map(({label,count})=>({label,count})),[{label:'SR처리',count:2},{label:'결재',count:1},{label:'미분류',count:1}]);
 assert.equal(graph.links,source.links);assert.equal(source.nodes[0].category,'SR처리/접수');assert.equal(source.nodes[0].title,'서로 다른 메일 제목');
});
test('mail list kinds come from related clusters even when all old categories are identical',()=>{
 const source=buildWikiGraph([{path:'a',type:'Mail',category:'업무',tags:['접근 권한']},{path:'b',type:'Mail',category:'업무',tags:['접근 권한']},{path:'c',type:'Mail',category:'업무',tags:['장애 대응']},{path:'d',type:'Mail',category:'업무',tags:['장애 대응']}],[{from:'a',to:'b',kind:'reply'},{from:'c',to:'d',kind:'reply'}]);
 const graph=deriveMailClusterKinds(source);
 assert.deepEqual(graph.nodes.map(n=>n.type),['접근 권한','접근 권한','장애 대응','장애 대응']);assert.deepEqual(graph.types.map(n=>n.id).sort(),['접근 권한','장애 대응'].sort());
 assert.equal(graph.links,source.links);assert(source.nodes.every(n=>n.type==='업무'&&n.category==='업무'));assert.equal(groupWikiGraph(graph,'type').sections.length,2);assert.deepEqual(deriveMailClusterKinds(graph),graph,'repeated projection retains the original fallback metadata');
});
test('same derived kind does not merge separate evidence clusters and unlinked mail stays independent',()=>{
 const source=buildWikiGraph([{path:'a',type:'Mail',tags:['접근 권한']},{path:'b',type:'Mail',tags:['접근 권한']},{path:'c',type:'Mail',tags:['접근 권한']},{path:'d',type:'Mail',tags:['접근 권한']},{path:'e',type:'Mail',category:'결재'},{path:'f',type:'Mail',category:'업무'}],[{from:'a',to:'b'},{from:'c',to:'d'}]);
 const graph=deriveMailClusterKinds(source),topics=groupWikiGraph(graph,'topic');assert.equal(topics.sections.length,4);assert.equal(groupWikiGraph(graph,'type').sections.length,3);assert.equal(graph.links.length,2);assert.equal(graph.nodes.find(n=>n.path==='e').type,'결재');assert.equal(graph.nodes.find(n=>n.path==='f').type,'업무');
 assert.equal(deriveMailClusterKinds({...source,kind:'code'}).nodes,source.nodes,'code wiki kinds are unaffected');
});
test('mail topic labels prefer shared keywords then category and never a representative subject',()=>{
 const source=buildWikiGraph([{path:'a',title:'[긴급] 2026-10-16 결재 요청 123',type:'Mail',category:'업무',tags:['접근 권한','일회성']},{path:'b',title:'Re: 담당자 확인 바랍니다',type:'Mail',category:'업무',tags:['접근 권한']},{path:'c',title:'새로운 요청 건',type:'Mail',category:'SR처리/접수',cluster:'sr',clusterTitle:'긴 메일 제목을 복사한 묶음'},{path:'d',title:'월간 보고서 전달',type:'Mail',cluster:'unknown'}],[{from:'a',to:'b',kind:'reply',confidence:'header'}]);
 const graph=groupWikiGraph(source,'topic'),label=path=>graph.sections.find(s=>s.id===graph.nodes.find(n=>n.path===path).section).label;
 assert.equal(label('a'),'접근 권한');assert.equal(label('b'),'접근 권한');assert.equal(label('c'),'SR처리');assert.equal(label('d'),'미분류');assert.equal(graph.links,source.links);
 const positions=new Map(source.nodes.map((n,i)=>[n.path,{x:i*100,y:0}]));assert(clusterWikiGraph(graph,positions).graph.nodes.every(n=>!source.nodes.some(s=>s.title===n.title)));
 assert.equal(source.nodes[2].clusterTitle,'긴 메일 제목을 복사한 묶음','stored metadata remains untouched');
});
test('one mail keyword cannot name an entire mixed topic group',()=>{
 const source=buildWikiGraph([{path:'a',type:'Mail',category:'결재',tags:['개인 이름']},{path:'b',type:'Mail',category:'결재'},{path:'c',type:'Mail',category:'업무'}],[{from:'a',to:'b'},{from:'b',to:'c'}]);
 assert.equal(groupWikiGraph(source,'topic').sections[0].label,'결재 / 업무');
});
test('sparse category evidence does not assign a kind to an otherwise unknown cluster',()=>{
 const source=buildWikiGraph([{path:'a',type:'Mail',category:'결재'},{path:'b',type:'Mail'},{path:'c',type:'Mail'},{path:'d',type:'Mail'}],[{from:'a',to:'b'},{from:'b',to:'c'},{from:'c',to:'d'}]);
 assert(deriveMailClusterKinds(source).nodes.every(node=>node.type==='미분류'));
});
test('code types preserve distinct and custom kinds without changing references',()=>{
 const graph=groupWikiGraph(buildWikiGraph([{path:'a',type:'Process'},{path:'b',type:'Integration'},{path:'c',type:'Custom API'}]),'type');
 assert.deepEqual(graph.sections.map(group=>group.label).sort(),['Custom API','실행 흐름','외부 연동'].sort());assert.equal(graph.links.length,0);
});
test('cluster view preserves member counts and aggregates only real inter-group edges',()=>{
 const original=buildWikiGraph([{path:'a/1'},{path:'a/2'},{path:'b/1'},{path:'c/1'}],[{from:'a/1',to:'a/2'},{from:'a/1',to:'b/1',kind:'similar_topic',confidence:'candidate'},{from:'a/2',to:'b/1',kind:'similar_topic',confidence:'candidate'}]);
 const grouped=groupWikiGraph(original),positions=new Map([['a/1',{x:0,y:0}],['a/2',{x:20,y:20}],['b/1',{x:100,y:100}],['c/1',{x:500,y:500}]]);
 const cluster=clusterWikiGraph(grouped,positions);
 assert.equal(cluster.graph.nodes.length,3);assert.deepEqual(cluster.graph.nodes[0].members,['a/1','a/2']);assert.equal(cluster.graph.nodes[0].count,2);
 assert.deepEqual(cluster.positions.get('cluster:a'),{x:10,y:10});assert.equal(cluster.graph.links.length,1);assert.equal(cluster.graph.links[0].count,2);assert.equal(cluster.graph.links[0].relationship.confidence,'candidate');
 assert.equal(original.nodes.length,4);assert.equal(original.links.length,3);
 const filtered=clusterWikiGraph({...grouped,nodes:grouped.nodes.filter(node=>node.path==='b/1')},positions);assert.equal(filtered.graph.nodes[0].count,1);assert.equal(filtered.graph.links.length,0);
});
test('viewport includes crossing lines but excludes offscreen elements and reappears on pan',()=>{
 const graph={nodes:['a','b','c','d'].map(path=>({path})),links:[{from:'a',to:'b'},{from:'c',to:'d'}]};
 const positions=new Map([['a',{x:-100,y:50}],['b',{x:200,y:50}],['c',{x:300,y:500}],['d',{x:400,y:500}]]);
 const view=wikiViewportItems(graph,positions,{x:0,y:0,k:1},{width:100,height:100},0);
 assert.equal(view.nodes.length,0);assert.deepEqual(view.links,[graph.links[0]]);
 const moved=wikiViewportItems(graph,positions,{x:-280,y:-480,k:1},{width:160,height:100},0);
 assert.deepEqual(moved.nodes.map(node=>node.path),['c','d']);assert.deepEqual(moved.links,[graph.links[1]]);
});
test('3000-node layout uses local neighborhoods and keeps unclipped positions',()=>{
 const nodes=Array.from({length:3000},(_,i)=>({path:'page-'+i,section:'group-'+Math.floor(i/30)}));
 const layout=createWikiLayout({nodes,links:[]});advanceWikiLayout(layout,5);
 assert(layout.pairChecks<3000*2999/20,'spatial grid avoids global all-pairs calculation');
 const positions=wikiLayoutPositions(layout);assert([...positions.values()].every(at=>Number.isFinite(at.x)&&Number.isFinite(at.y)));
 assert([...positions.values()].some(at=>at.x<0));
 const visible=wikiViewportItems({nodes,links:[]},positions,{x:0,y:0,k:1},{width:640,height:420});
 assert(visible.nodes.length>0&&visible.nodes.length<3000/4);
});
