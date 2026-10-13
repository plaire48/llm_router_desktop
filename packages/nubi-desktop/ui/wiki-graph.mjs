// The Wiki map and table are derived from what OpenWiki already records: the
// Markdown links between pages (the edges the library resolves) and each page's
// front matter. Relationship strength is computed here, not stored anywhere.
export function wikiSection(path){const at=String(path||'').indexOf('/');return at<0?'':path.slice(0,at);}
export const ROOT_SECTION_LABEL='루트';
export const sectionLabel=id=>id||ROOT_SECTION_LABEL;
// One colour per section, in the graph's section order, shared by the map and the table.
export const WIKI_SECTION_PALETTE=['#3182F6','#F04452','#00A86B','#F59E0B','#8B5CF6','#0EA5E9','#EC4899','#64748B','#14B8A6','#A16207'];
export const sectionColors=graph=>new Map((graph?.sections||[]).map((entry,i)=>[entry.id,WIKI_SECTION_PALETTE[i%WIKI_SECTION_PALETTE.length]]));
const round=value=>Math.round(value*100)/100;
export function buildWikiGraph(items=[],edges=[]){
  const nodes=new Map(items.map(item=>[item.path,{...item,title:item.title||item.path,type:item.type||'',description:item.description||'',tags:Array.isArray(item.tags)?item.tags:[],section:wikiSection(item.path),links:[],backlinks:[]}]));
  const pairs=new Map();
  for(const edge of edges){
    const from=nodes.get(edge?.from),to=nodes.get(edge?.to);
    if(!from||!to||edge.from===edge.to)continue;
    if(!from.links.includes(edge.to))from.links.push(edge.to);
    if(!to.backlinks.includes(edge.from))to.backlinks.push(edge.from);
    const [a,b]=[edge.from,edge.to].sort(),key=a+'\n'+b,pair=pairs.get(key)||{a,b,ab:false,ba:false};
    if(edge.from===a)pair.ab=true;else pair.ba=true;
    pairs.set(key,pair);
  }
  const neighbors=path=>new Set([...nodes.get(path).links,...nodes.get(path).backlinks]);
  for(const node of nodes.values())node.degree=neighbors(node.path).size;
  const links=[...pairs.values()].map(pair=>{
    const a=nodes.get(pair.a),b=nodes.get(pair.b),mutual=pair.ab&&pair.ba;
    const sharedTags=a.tags.filter(tag=>b.tags.includes(tag)),sameSection=a.section===b.section;
    const na=neighbors(pair.a),nb=neighbors(pair.b);na.delete(pair.b);nb.delete(pair.a);
    const common=[...na].filter(path=>nb.has(path)).length,union=new Set([...na,...nb]).size,overlap=union?round(common/union):0;
    const strength=round(Math.min(4,1+(mutual?1:0)+Math.min(1,sharedTags.length*0.5)+(sameSection?0.5:0)+overlap));
    const reasons=[mutual?'서로 참조':pair.ab?'앞 문서가 참조':'뒤 문서가 참조',...(sharedTags.length?[`태그 ${sharedTags.length}개 공유`]:[]),...(sameSection?['같은 분류']:[]),...(overlap>=0.3?['이웃 문서 공유']:[])];
    return {from:pair.a,to:pair.b,mutual,sharedTags,sameSection,overlap,strength,reasons};
  }).sort((x,y)=>y.strength-x.strength||x.from.localeCompare(y.from)||x.to.localeCompare(y.to));
  const count=(key)=>{const map=new Map();for(const node of nodes.values()){const id=node[key];map.set(id,(map.get(id)||0)+1);}return [...map].map(([id,total])=>({id,count:total})).sort((x,y)=>y.count-x.count||String(x.id).localeCompare(String(y.id)));};
  const list=[...nodes.values()];
  return {nodes:list,links,sections:count('section'),types:count('type').filter(entry=>entry.id),orphans:list.filter(node=>!node.degree).map(node=>node.path).sort(),hubs:list.filter(node=>node.degree>0).sort((x,y)=>y.degree-x.degree||x.title.localeCompare(y.title)).slice(0,8).map(node=>node.path)};
}
// Neighbours of one page, strongest first, with the reasons a reader can check.
export function relatedDocuments(graph,path){
  const byPath=new Map(graph.nodes.map(node=>[node.path,node]));
  if(!byPath.has(path))return [];
  return graph.links.filter(link=>link.from===path||link.to===path).map(link=>{
    const other=link.from===path?link.to:link.from,node=byPath.get(other),outgoing=byPath.get(path).links.includes(other),incoming=byPath.get(path).backlinks.includes(other);
    return {path:other,title:node.title,section:node.section,type:node.type,direction:outgoing&&incoming?'both':outgoing?'out':'in',strength:link.strength,reasons:[outgoing&&incoming?'서로 참조':outgoing?'이 문서가 참조':'이 문서를 참조',...link.reasons.slice(1)]};
  }).sort((x,y)=>y.strength-x.strength||x.title.localeCompare(y.title));
}
// Table helpers: one filtered, sorted and paged view over the graph's nodes.
export const WIKI_SORTS=['title-asc','title-desc','section-asc','section-desc','type-asc','type-desc','links-desc','links-asc','updated-desc','updated-asc'];
const text=value=>String(value||'').toLocaleLowerCase();
export function filterWikiRows(nodes,{query='',sections=[],types=[],link='all',period='all',now=Date.now()}={}){
  const needle=text(query).trim(),since=period==='7'?now-7*86400000:period==='30'?now-30*86400000:null;
  return nodes.filter(node=>{
    if(needle&&![node.title,node.path,node.description,...node.tags].some(value=>text(value).includes(needle)))return false;
    if(sections.length&&!sections.includes(node.section))return false;
    if(types.length&&!types.includes(node.type))return false;
    if(link==='orphan'&&node.degree)return false;
    if(link==='linked'&&!node.degree)return false;
    if(since!==null){const at=Date.parse(node.updatedAt||'');if(!Number.isFinite(at)||at<since)return false;}
    return true;
  });
}
export function sortWikiRows(rows,sort='title-asc'){
  const [key,direction]=WIKI_SORTS.includes(sort)?sort.split('-'):['title','asc'],sign=direction==='asc'?1:-1;
  const value=node=>key==='links'?node.degree:key==='updated'?(Date.parse(node.updatedAt||'')||0):key==='section'?sectionLabel(node.section):key==='type'?node.type:node.title;
  return [...rows].sort((x,y)=>{const a=value(x),b=value(y);const order=typeof a==='number'?a-b:String(a).localeCompare(String(b),'ko');return (order||x.title.localeCompare(y.title,'ko'))*sign;});
}
export function pageWikiRows(rows,page=1,size=20){
  const total=rows.length,totalPages=Math.max(1,Math.ceil(total/size)),current=Math.min(Math.max(1,page),totalPages),offset=(current-1)*size;
  return {rows:rows.slice(offset,offset+size),page:current,totalPages,offset,total};
}
// Layout: sections start on a ring so clusters are readable before the forces
// settle. Progressive steps let the screen animate large wikis without blocking.
const hash=value=>{let h=2166136261;for(const char of String(value)){h^=char.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h/4294967296;};
export function createWikiLayout(graph,{width=640,height=420,padding=40}={}){
  const nodes=graph.nodes.map(node=>node.path),index=new Map(nodes.map((path,i)=>[path,i]));
  const sections=[...new Set(graph.nodes.map(node=>node.section))].sort();
  const centerX=width/2,centerY=height/2,ring=Math.min(width,height)*(sections.length>1?0.3:0);
  const centers=new Map(sections.map((section,i)=>[section,{x:centerX+ring*Math.cos(2*Math.PI*i/sections.length-Math.PI/2),y:centerY+ring*Math.sin(2*Math.PI*i/sections.length-Math.PI/2)}]));
  const positions=graph.nodes.map(node=>{const center=centers.get(node.section),angle=hash(node.path)*2*Math.PI,radius=18+hash(node.path+'r')*Math.min(width,height)*0.12;return {x:center.x+radius*Math.cos(angle),y:center.y+radius*Math.sin(angle)};});
  const links=graph.links.map(link=>({a:index.get(link.from),b:index.get(link.to),weight:0.6+link.strength/4}));
  const total=Math.max(1,nodes.length),k=Math.sqrt((width-2*padding)*(height-2*padding)/total)*0.85;
  return {nodes,positions,links,sections:centers,sectionOf:graph.nodes.map(node=>node.section),width,height,padding,k,temperature:Math.max(width,height)/8,steps:0,maxSteps:!nodes.length?0:nodes.length>200?120:nodes.length>60?200:300};
}
export function advanceWikiLayout(layout,steps=1){
  const {positions,links,k,padding,width,height}=layout;
  for(let step=0;step<steps&&layout.steps<layout.maxSteps;step++,layout.steps++){
    const forces=positions.map(()=>({x:0,y:0}));
    for(let i=0;i<positions.length;i++)for(let j=i+1;j<positions.length;j++){
      let dx=positions[i].x-positions[j].x,dy=positions[i].y-positions[j].y;const distance=Math.max(1,Math.hypot(dx,dy));
      if(distance>k*5)continue;
      const push=k*k/distance/distance;dx*=push;dy*=push;forces[i].x+=dx;forces[i].y+=dy;forces[j].x-=dx;forces[j].y-=dy;
    }
    for(const link of links){
      const dx=positions[link.a].x-positions[link.b].x,dy=positions[link.a].y-positions[link.b].y,distance=Math.max(1,Math.hypot(dx,dy));
      const pull=distance/k*link.weight*0.12;forces[link.a].x-=dx*pull;forces[link.a].y-=dy*pull;forces[link.b].x+=dx*pull;forces[link.b].y+=dy*pull;
    }
    positions.forEach((position,i)=>{
      const home=layout.sections.get(layout.sectionOf[i]);forces[i].x+=(home.x-position.x)*0.04+(width/2-position.x)*0.01;forces[i].y+=(home.y-position.y)*0.04+(height/2-position.y)*0.01;
      const magnitude=Math.max(1e-6,Math.hypot(forces[i].x,forces[i].y)),limit=Math.min(magnitude,layout.temperature);
      position.x=Math.min(width-padding,Math.max(padding,position.x+forces[i].x/magnitude*limit));
      position.y=Math.min(height-padding,Math.max(padding,position.y+forces[i].y/magnitude*limit));
    });
    layout.temperature=Math.max(0.8,layout.temperature*0.96);
  }
  return layout.steps>=layout.maxSteps;
}
export function wikiLayoutPositions(layout){return new Map(layout.nodes.map((path,i)=>[path,{x:Math.round(layout.positions[i].x*10)/10,y:Math.round(layout.positions[i].y*10)/10}]));}
