import {test} from 'node:test';import assert from 'node:assert/strict';
import {buildWikiGraph,relatedDocuments,filterWikiRows,sortWikiRows,pageWikiRows,createWikiLayout,advanceWikiLayout,wikiLayoutPositions,wikiSection,sectionLabel} from '../ui/wiki-graph.mjs';
const items=[
  {path:'index.md',title:'위키 홈',type:'Section',tags:[],updatedAt:'2026-10-13T00:00:00Z'},
  {path:'orders/flow.md',title:'주문 흐름',type:'Process',tags:['order','state'],description:'상태 전이',updatedAt:'2026-10-12T00:00:00Z'},
  {path:'orders/states.md',title:'주문 상태표',type:'Reference',tags:['order','state'],updatedAt:'2026-09-01T00:00:00Z'},
  {path:'payments/gateway.md',title:'결제 연동',type:'Integration',tags:['payment'],updatedAt:'2026-10-01T00:00:00Z'},
  {path:'ops/monitoring.md',title:'모니터링',type:'Reference',tags:['ops'],updatedAt:'2026-08-01T00:00:00Z'}];
const edges=[{from:'index.md',to:'orders/flow.md'},{from:'index.md',to:'payments/gateway.md'},{from:'orders/flow.md',to:'orders/states.md'},{from:'orders/states.md',to:'orders/flow.md'},{from:'orders/flow.md',to:'payments/gateway.md'},{from:'orders/flow.md',to:'orders/flow.md'},{from:'ghost.md',to:'index.md'}];
test('graph counts distinct neighbours, scores mutual links, shared tags and sections, and finds orphans and hubs',()=>{
  const graph=buildWikiGraph(items,edges);
  assert.equal(wikiSection('orders/flow.md'),'orders');assert.equal(sectionLabel(''),'루트');
  const flow=graph.nodes.find(node=>node.path==='orders/flow.md');
  assert.deepEqual([flow.links,flow.backlinks,flow.degree],[['orders/states.md','payments/gateway.md'],['index.md','orders/states.md'],3]);
  const mutual=graph.links.find(link=>link.from==='orders/flow.md'&&link.to==='orders/states.md');
  assert.equal(mutual.strength,3.5);assert.deepEqual(mutual.reasons,['서로 참조','태그 2개 공유','같은 분류']);
  const home=graph.links.find(link=>link.from==='index.md'&&link.to==='orders/flow.md');
  assert.equal(home.strength,1.5);assert.deepEqual(home.reasons,['앞 문서가 참조','이웃 문서 공유']);
  assert.deepEqual(graph.orphans,['ops/monitoring.md']);assert.deepEqual(graph.hubs.slice(0,2),['orders/flow.md','payments/gateway.md'],'ties fall back to the title');
  assert.deepEqual(graph.sections.map(entry=>entry.id),['orders','','ops','payments']);assert.deepEqual(graph.types[0],{id:'Reference',count:2});
  assert.equal(graph.links.length,4,'self links and unknown pages are dropped');
});
test('related documents explain direction and strength for one page',()=>{
  const related=relatedDocuments(buildWikiGraph(items,edges),'orders/flow.md');
  assert.deepEqual(related.map(entry=>[entry.title,entry.direction,entry.strength]),[['주문 상태표','both',3.5],['결제 연동','out',1.5],['위키 홈','in',1.5]]);
  assert.deepEqual(related[2].reasons,['이 문서를 참조','이웃 문서 공유']);
  assert.deepEqual(relatedDocuments(buildWikiGraph(items,edges),'missing.md'),[]);
});
test('rows filter by text, section, type, link state and period, then sort and page',()=>{
  const nodes=buildWikiGraph(items,edges).nodes,now=Date.parse('2026-10-14T00:00:00Z');
  assert.deepEqual(filterWikiRows(nodes,{query:'상태'}).map(node=>node.path),['orders/flow.md','orders/states.md']);
  assert.deepEqual(filterWikiRows(nodes,{sections:['orders'],types:['Reference']}).map(node=>node.path),['orders/states.md']);
  assert.deepEqual(filterWikiRows(nodes,{link:'orphan'}).map(node=>node.path),['ops/monitoring.md']);
  assert.deepEqual(filterWikiRows(nodes,{period:'7',now}).map(node=>node.path),['index.md','orders/flow.md']);
  assert.deepEqual(sortWikiRows(nodes,'links-desc').map(node=>node.path).slice(0,2),['orders/flow.md','index.md']);
  assert.deepEqual(sortWikiRows(nodes,'updated-asc').map(node=>node.path)[0],'ops/monitoring.md');
  assert.deepEqual(sortWikiRows(nodes,'section-asc').map(node=>node.section),['','ops','orders','orders','payments'],'the root section sorts first');
  assert.deepEqual(sortWikiRows(nodes,'bogus').map(node=>node.title),['결제 연동','모니터링','위키 홈','주문 상태표','주문 흐름']);
  const page=pageWikiRows(nodes,3,2);assert.deepEqual([page.page,page.totalPages,page.offset,page.total,page.rows.length],[3,3,4,5,1]);
  assert.equal(pageWikiRows(nodes,0,2).page,1);
});
test('layout is deterministic, extends beyond the viewport and settles clusters by section',()=>{
  const graph=buildWikiGraph(items,edges);
  const first=createWikiLayout(graph,{width:600,height:400}),second=createWikiLayout(graph,{width:600,height:400});
  while(!advanceWikiLayout(first,25));while(!advanceWikiLayout(second,7));
  assert.deepEqual(wikiLayoutPositions(first),wikiLayoutPositions(second));
  for(const {x,y} of wikiLayoutPositions(first).values()){assert(Number.isFinite(x)&&Number.isFinite(y));}
  assert([...wikiLayoutPositions(first).values()].some(({x,y})=>x<40||x>560||y<40||y>360),'world positions are not clamped to a rectangular viewport');
  const at=wikiLayoutPositions(first),distance=(a,b)=>Math.hypot(at.get(a).x-at.get(b).x,at.get(a).y-at.get(b).y);
  assert(distance('orders/flow.md','orders/states.md')<distance('orders/flow.md','ops/monitoring.md'),'linked pages in one section sit closer than an orphan elsewhere');
  assert.equal(advanceWikiLayout(createWikiLayout(buildWikiGraph([],[])),5),true);
});
test('mail candidate reasons are not relabelled as proven document references',()=>{
 const graph=buildWikiGraph([{path:'a',title:'예산',type:'Mail'},{path:'b',title:'회신',type:'Mail',date:'2026-10-12'}],[{from:'a',to:'b',kind:'similar_topic',label:'비슷한 주제',confidence:'candidate',reasons:['공통 주제: 누비, 예산']}]);
 const related=relatedDocuments(graph,'a')[0];assert.equal(related.reasons[0],'비슷한 주제');assert.equal(related.strength,1.5);assert.equal(related.date,'2026-10-12');assert(!related.reasons.includes('이 문서가 참조'));
});
