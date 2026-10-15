// Display-only groups. They never add evidence edges or rewrite stored pages.
const typeNames={section:['개요','book'],process:['실행 흐름','gitBranch'],workflow:['실행 흐름','gitBranch'],reference:['참고','file'],integration:['외부 연동','link'],module:['모듈','layers'],component:['구성 요소','layers'],architecture:['아키텍처','layers'],concept:['개념','book'],entity:['데이터','file'],policy:['규칙','file'],playbook:['운영 절차','file'],test:['검증','check']};
export function wikiTypeLabel(type){return typeNames[String(type||'').toLowerCase()]?.[0]||type||'미분류';}
export function wikiMapModes(kind){return kind==='mail'?[{id:'topic',label:'주제 묶음',icon:'link'},{id:'type',label:'종류',icon:'tag'},{id:'month',label:'날짜',icon:'clock'}]:[{id:'section',label:'분류',icon:'layers'},{id:'type',label:'종류',icon:'tag'},{id:'topic',label:'연결 묶음',icon:'link'}];}
const subject=title=>String(title||'').replace(/^(?:\s*(?:re|fw|fwd|회신|답장|전달)\s*:\s*)+/gi,'').trim();
export function groupWikiGraph(source,mode='section'){
 const nodes=source.nodes,byPath=new Map(nodes.map(node=>[node.path,node]));
 const parent=new Map(nodes.map(node=>[node.path,node.path]));
 const find=path=>{let root=path;while(parent.get(root)!==root)root=parent.get(root);while(path!==root){const next=parent.get(path);parent.set(path,root);path=next;}return root;};
 const join=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent.set(a<b?b:a,a<b?a:b);};
 // Keep producer-assigned clusters intact. Otherwise use the already bounded,
 // evidence-backed relationship graph. Time alone never creates a topic group.
 const declared=node=>node.cluster||node.topic||'';
 if(mode==='topic')for(const link of source.links){const a=byPath.get(link.from),b=byPath.get(link.to);if(a&&b&&!declared(a)&&!declared(b))join(a.path,b.path);}
 const members=new Map(),keyOf=new Map();
 for(const node of nodes){
  let key;
  if(mode==='topic')key=declared(node)?'declared:'+declared(node):node.degree?'related:'+find(node.path):'unlinked';
  else if(mode==='type')key=node.type||'미분류';
  else if(mode==='month'){const date=new Date(node.date||'');key=Number.isFinite(+date)?`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`:'날짜 없음';}
  else key=node.section;
  keyOf.set(node.path,key);if(!members.has(key))members.set(key,[]);members.get(key).push(node);
 }
 const sections=[...members].map(([id,rows])=>{
  const representative=[...rows].sort((a,b)=>b.degree-a.degree||a.path.localeCompare(b.path))[0];
  const label=mode==='topic'?(id==='unlinked'?'연결 없는 문서':declared(representative)?representative.clusterTitle||representative.topic||declared(representative):subject(representative.title)):mode==='type'?wikiTypeLabel(id):id;
  return {id,label,count:rows.length};
 }).sort((a,b)=>b.count-a.count||a.id.localeCompare(b.id));
 return {...source,nodes:nodes.map(node=>({...node,section:keyOf.get(node.path),sourceSection:node.section})),sections,grouping:mode};
}

// Collapse only the presentation. Every aggregate link counts existing document
// links; expanding returns to the unchanged source nodes and evidence.
export function clusterWikiGraph(graph,positions){
 const groups=new Map(),nodeGroup=new Map(),centers=new Map();
 const labels=new Map(graph.sections.map(group=>[group.id,group.label||group.id||'루트']));
 for(const node of graph.nodes){
  const at=positions.get(node.path);if(!at)continue;
  const key='cluster:'+node.section;nodeGroup.set(node.path,key);
  if(!groups.has(key))groups.set(key,{path:key,clusterId:node.section,section:node.section,title:labels.get(node.section)||node.section,count:0,members:[],x:0,y:0,links:[],backlinks:[],tags:[],type:'문서 묶음'});
  const group=groups.get(key);group.count++;group.members.push(node.path);group.x+=at.x;group.y+=at.y;
 }
 const pairs=new Map();
 for(const edge of graph.links){
  const a=nodeGroup.get(edge.from),b=nodeGroup.get(edge.to);if(!a||!b||a===b)continue;
  const [from,to]=[a,b].sort(),key=JSON.stringify([from,to]);
  if(!pairs.has(key))pairs.set(key,{from,to,count:0,candidates:0,strength:1,reasons:[]});
  const link=pairs.get(key);link.count++;if(edge.relationship?.confidence==='candidate')link.candidates++;
 }
 const links=[...pairs.values()].map(link=>{
  groups.get(link.from).links.push(link.to);groups.get(link.to).backlinks.push(link.from);
  return {...link,strength:Math.min(4,1+Math.log2(link.count)),reasons:[`문서 연결 ${link.count}개`],relationship:link.candidates===link.count?{confidence:'candidate'}:null};
 });
 const nodes=[...groups.values()].map(({x,y,...node})=>{centers.set(node.path,{x:x/node.count,y:y/node.count});return {...node,degree:node.links.length+node.backlinks.length,description:`문서 ${node.count}개. 누르면 문서별로 펼쳐집니다.`};});
 return {graph:{...graph,nodes,links},positions:centers};
}
