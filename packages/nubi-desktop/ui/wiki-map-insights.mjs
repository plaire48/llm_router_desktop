import {mailWikiType,sectionLabel} from './wiki-graph.mjs';

// Reading aids derived only from the loaded graph. Never treat proximity,
// folder membership, degree or a subject-match candidate as verified meaning.
export const isWikiCandidate=link=>link.relationship?.confidence==='candidate';
export function recordedWikiGraph(source,includeCandidates=false){
 const links=source.links.filter(link=>includeCandidates||!isWikiCandidate(link));
 const adjacent=new Map(source.nodes.map(node=>[node.path,new Set()]));
 for(const {from,to} of links){adjacent.get(from)?.add(to);adjacent.get(to)?.add(from);}
 const nodes=source.nodes.map(node=>({...node,degree:adjacent.get(node.path).size,links:node.links.filter(path=>adjacent.get(node.path).has(path)),backlinks:node.backlinks.filter(path=>adjacent.get(node.path).has(path))}));
 return {...source,nodes,links,orphans:nodes.filter(node=>!node.degree).map(node=>node.path),hubs:nodes.filter(node=>node.degree).sort((a,b)=>b.degree-a.degree||a.path.localeCompare(b.path)).slice(0,8).map(node=>node.path)};
}
const bucketOf=(node,kind)=>kind==='mail'?mailWikiType(node.category||node.sourceType||''):sectionLabel(node.sourceSection??node.section);
export function wikiMapInsights(source){
 const graph=recordedWikiGraph(source),byPath=new Map(graph.nodes.map(node=>[node.path,node]));
 const outgoing=new Map(graph.nodes.map(node=>[node.path,new Set(node.links)])),incoming=new Map(graph.nodes.map(node=>[node.path,new Set(node.backlinks)]));
 const groups=new Map(),neighbors=new Map(graph.nodes.map(node=>[node.path,new Set()])),evidence=new Map(graph.nodes.map(node=>[node.path,[]]));
 for(const node of graph.nodes){const key=bucketOf(node,graph.kind);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(node);}
 for(const link of graph.links){
  for(const [path,other] of [[link.from,link.to],[link.to,link.from]]){
   neighbors.get(path).add(other);
   const out=outgoing.get(path).has(other),into=incoming.get(path).has(other);
   const reasons=link.relationship?.label?link.reasons:[out&&into?'서로 참조':out?'이 문서가 참조':'이 문서를 참조',...link.reasons.slice(1)];
   evidence.get(path).push({path:other,title:byPath.get(other).title,reasons});
  }
 }
 const unknown=new Set(['루트','메일','미분류','']);
 const documents=graph.nodes.map(node=>{
  const group=bucketOf(node,graph.kind),related=[...neighbors.get(node.path)];
  const otherGroups=[...new Set(related.map(path=>bucketOf(byPath.get(path),graph.kind)).filter(key=>key!==group&&!unknown.has(key)))].sort((a,b)=>a.localeCompare(b,'ko'));
  return {...node,group,related,evidence:evidence.get(node.path),otherGroups,bridge:!unknown.has(group)&&otherGroups.length>0};
 }).sort((a,b)=>b.degree-a.degree||a.title.localeCompare(b.title,'ko'));
 const bridges=documents.filter(node=>node.bridge).sort((a,b)=>b.otherGroups.length-a.otherGroups.length||b.degree-a.degree||a.path.localeCompare(b.path));
 const candidates=source.links.filter(isWikiCandidate).map(link=>({...link,a:byPath.get(link.from),b:byPath.get(link.to)})).filter(link=>link.a&&link.b);
 return {graph,total:documents.length,recordedPairs:graph.links.length,connected:documents.filter(node=>node.degree>0),isolated:documents.filter(node=>!node.degree),bridges,candidates,documents,
  groups:[...groups].map(([label,nodes])=>({label,count:nodes.length,connected:nodes.filter(node=>node.degree>0).length})).sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label,'ko'))};
}
