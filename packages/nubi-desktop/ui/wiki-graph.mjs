// The Wiki map and table are derived from what OpenWiki already records: the
// Markdown links between pages (the edges the library resolves) and each page's
// front matter. Relationship strength is computed here, not stored anywhere.
export function wikiSection(path){const at=String(path||'').indexOf('/');return at<0?'':path.slice(0,at);}
export const ROOT_SECTION_LABEL='루트';
// Mail pages are grouped by the month they were collected ('2026-10' reads as 2026년 10월).
export const sectionLabel=id=>/^\d{4}-\d{2}$/.test(id||'')?`${id.slice(0,4)}년 ${Number(id.slice(5,7))}월`:(id||ROOT_SECTION_LABEL);
// One colour per section, in the graph's section order, shared by the map and the table.
export const WIKI_SECTION_PALETTE=['#3182F6','#F04452','#00A86B','#F59E0B','#8B5CF6','#0EA5E9','#EC4899','#64748B','#14B8A6','#A16207'];
export const sectionColors=graph=>new Map((graph?.sections||[]).map((entry,i)=>[entry.id,WIKI_SECTION_PALETTE[i%WIKI_SECTION_PALETTE.length]]));
const round=value=>Math.round(value*100)/100;
// Show the existing top-level category, not a new taxonomy. Preserve the full
// category on the node so detailed labels remain searchable and unchanged.
export function mailWikiType(category){
  return String(category||'').split(/[/>›»]/u).map(value=>value.trim()).find(Boolean)||'메일';
}
export function buildWikiGraph(items=[],edges=[],{kind}={}){
  const nodes=new Map(items.map(item=>[item.path,{...item,title:item.title||item.path,type:item.type?.toLowerCase()==='mail'?mailWikiType(item.category):item.type||'',description:item.description||'',tags:Array.isArray(item.tags)?item.tags:[],section:typeof item.section==='string'?item.section:wikiSection(item.path),links:[],backlinks:[]}]));
  const pairs=new Map();
  for(const edge of edges){
    const from=nodes.get(edge?.from),to=nodes.get(edge?.to);
    if(!from||!to||edge.from===edge.to)continue;
    if(!from.links.includes(edge.to))from.links.push(edge.to);
    if(!to.backlinks.includes(edge.from))to.backlinks.push(edge.from);
    const [a,b]=[edge.from,edge.to].sort(),key=a+'\n'+b,pair=pairs.get(key)||{a,b,ab:false,ba:false,relations:[]};
    if(edge.kind)pair.relations.push(edge);
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
    const relation=pair.relations.find(r=>r.confidence==='header')||pair.relations[0];
    const computedStrength=round(Math.min(4,1+(mutual?1:0)+Math.min(1,sharedTags.length*0.5)+(sameSection?0.5:0)+overlap));
    const strength=relation?.confidence==='candidate'?1.5:relation?.confidence==='header'?3:computedStrength;
    const reasons=relation?.label?[relation.label,...(relation.reasons||[]),...(relation.chronology?[`${relation.chronology.days}일 간격 (인과관계 미확인)`]:[])]:[mutual?'서로 참조':pair.ab?'앞 문서가 참조':'뒤 문서가 참조',...(sharedTags.length?[`태그 ${sharedTags.length}개 공유`]:[]),...(sameSection?['같은 분류']:[]),...(overlap>=0.3?['이웃 문서 공유']:[])];
    return {from:pair.a,to:pair.b,relationship:relation||null,mutual,sharedTags,sameSection,overlap,strength,reasons};
  }).sort((x,y)=>y.strength-x.strength||x.from.localeCompare(y.from)||x.to.localeCompare(y.to));
  const count=(key)=>{const map=new Map();for(const node of nodes.values()){const id=node[key];map.set(id,(map.get(id)||0)+1);}return [...map].map(([id,total])=>({id,count:total})).sort((x,y)=>y.count-x.count||String(x.id).localeCompare(String(y.id)));};
  const list=[...nodes.values()];
  return {kind:kind||(items.length&&items.every(item=>item.type?.toLowerCase()==='mail')?'mail':'code'),nodes:list,links,sections:count('section'),types:count('type').filter(entry=>entry.id),orphans:list.filter(node=>!node.degree).map(node=>node.path).sort(),hubs:list.filter(node=>node.degree>0).sort((x,y)=>y.degree-x.degree||x.title.localeCompare(y.title)).slice(0,8).map(node=>node.path)};
}
// Neighbours of one page, strongest first, with the reasons a reader can check.
export function relatedDocuments(graph,path){
  const byPath=new Map(graph.nodes.map(node=>[node.path,node]));
  if(!byPath.has(path))return [];
  return graph.links.filter(link=>link.from===path||link.to===path).map(link=>{
    const other=link.from===path?link.to:link.from,node=byPath.get(other),outgoing=byPath.get(path).links.includes(other),incoming=byPath.get(path).backlinks.includes(other);
    return {path:other,title:node.title,date:node.date,relationship:link.relationship,section:node.section,type:node.type,direction:outgoing&&incoming?'both':outgoing?'out':'in',strength:link.strength,reasons:link.relationship?.label?link.reasons:[outgoing&&incoming?'서로 참조':outgoing?'이 문서가 참조':'이 문서를 참조',...link.reasons.slice(1)]};
  }).sort((x,y)=>y.strength-x.strength||x.title.localeCompare(y.title));
}
// Table helpers: one filtered, sorted and paged view over the graph's nodes.
export const WIKI_SORTS=['title-asc','title-desc','section-asc','section-desc','type-asc','type-desc','links-desc','links-asc','updated-desc','updated-asc'];
const text=value=>String(value||'').toLocaleLowerCase();
export function filterWikiRows(nodes,{query='',sections=[],types=[],link='all',period='all',now=Date.now()}={}){
  const needle=text(query).trim(),since=period==='7'?now-7*86400000:period==='30'?now-30*86400000:null;
  return nodes.filter(node=>{
    if(needle&&![node.title,node.path,node.description,node.category,node.type,...node.tags].some(value=>text(value).includes(needle)))return false;
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
// A free canvas: groups have soft centres, not rectangular walls. Positions
// never clamp to viewport edges. Renderers can cull without changing topology.
const hash=value=>{let h=2166136261;for(const char of String(value)){h^=char.charCodeAt(0);h=Math.imul(h,16777619)>>>0;}return h/4294967296;};
export function createWikiLayout(graph,{width=640,height=420,padding=40}={}){
  const nodes=graph.nodes.map(node=>node.path),index=new Map(nodes.map((path,i)=>[path,i]));
  const groups=new Map();for(const node of graph.nodes){if(!groups.has(node.section))groups.set(node.section,[]);groups.get(node.section).push(node);}
  const ordered=[...groups].sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0]));
  const centers=new Map(),radii=new Map(),positions=new Array(nodes.length),k=46;let area=0;
  for(const [group,rows] of ordered){
    rows.sort((a,b)=>a.path.localeCompare(b.path));
    const radius=Math.max(65,Math.sqrt(rows.length)*k*.85),angle=centers.size*2.399963229728653;
    const ring=centers.size?Math.sqrt(area/Math.PI)+radius+80:0;
    const center={x:width/2+ring*Math.cos(angle),y:height/2+ring*Math.sin(angle)};
    centers.set(group,center);radii.set(group,radius);area+=Math.PI*(radius+70)**2;
    rows.forEach((node,i)=>{const theta=i*2.399963229728653+hash(group)*Math.PI*2,r=radius*Math.sqrt((i+.5)/rows.length);positions[index.get(node.path)]={x:center.x+r*Math.cos(theta),y:center.y+r*Math.sin(theta)};});
  }
  const links=graph.links.map(link=>({a:index.get(link.from),b:index.get(link.to),weight:.6+link.strength/4})).filter(link=>link.a!==undefined&&link.b!==undefined);
  return {nodes,positions,links,sections:centers,radii,sectionOf:graph.nodes.map(node=>node.section),width,height,padding,k,temperature:18,steps:0,maxSteps:!nodes.length?0:nodes.length>200?100:180,pairChecks:0};
}
export function advanceWikiLayout(layout,steps=1){
  const {positions,links,k}=layout,cutoff=k*3;
  for(let step=0;step<steps&&layout.steps<layout.maxSteps;step++,layout.steps++){
    const forces=positions.map(()=>({x:0,y:0})),grid=new Map();layout.pairChecks=0;
    positions.forEach((position,i)=>{const key=Math.floor(position.x/cutoff)+','+Math.floor(position.y/cutoff);if(!grid.has(key))grid.set(key,[]);grid.get(key).push(i);});
    for(let i=0;i<positions.length;i++){
      const cx=Math.floor(positions[i].x/cutoff),cy=Math.floor(positions[i].y/cutoff);
      for(let x=cx-1;x<=cx+1;x++)for(let y=cy-1;y<=cy+1;y++)for(const j of grid.get(x+','+y)||[]){
        if(j<=i)continue;layout.pairChecks++;
        let dx=positions[i].x-positions[j].x,dy=positions[i].y-positions[j].y,distance=Math.hypot(dx,dy);if(distance>cutoff)continue;
        if(distance<.01){dx=.1;dy=.1;distance=Math.hypot(dx,dy);}
        const push=k*k/(distance*distance)*.35;dx*=push;dy*=push;forces[i].x+=dx;forces[i].y+=dy;forces[j].x-=dx;forces[j].y-=dy;
      }
    }
    for(const link of links){
      const dx=positions[link.a].x-positions[link.b].x,dy=positions[link.a].y-positions[link.b].y,distance=Math.max(1,Math.hypot(dx,dy));
      // Cross-group links remain visible without collapsing separate clusters.
      const same=layout.sectionOf[link.a]===layout.sectionOf[link.b];
      const pull=Math.max(0,distance-k*1.5)/distance*link.weight*(same?.025:.001);
      forces[link.a].x-=dx*pull;forces[link.a].y-=dy*pull;forces[link.b].x+=dx*pull;forces[link.b].y+=dy*pull;
    }
    positions.forEach((position,i)=>{
      const home=layout.sections.get(layout.sectionOf[i]);forces[i].x+=(home.x-position.x)*.008;forces[i].y+=(home.y-position.y)*.008;
      const magnitude=Math.max(1e-6,Math.hypot(forces[i].x,forces[i].y)),limit=Math.min(magnitude,layout.temperature);
      position.x+=forces[i].x/magnitude*limit;position.y+=forces[i].y/magnitude*limit;
    });
    layout.temperature=Math.max(.5,layout.temperature*.97);
  }
  return layout.steps>=layout.maxSteps;
}
export function wikiLayoutPositions(layout){return new Map(layout.nodes.map((path,i)=>[path,{x:Math.round(layout.positions[i].x*10)/10,y:Math.round(layout.positions[i].y*10)/10}]));}
export function wikiPositionBounds(positions,padding=60){
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  for(const at of positions.values()){left=Math.min(left,at.x);top=Math.min(top,at.y);right=Math.max(right,at.x);bottom=Math.max(bottom,at.y);}
  return Number.isFinite(left)?{left:left-padding,top:top-padding,width:Math.max(1,right-left+padding*2),height:Math.max(1,bottom-top+padding*2)}:{left:0,top:0,width:640,height:420};
}
export function wikiViewportItems(graph,positions,view,size,margin=80){
  const left=-view.x/view.k-margin,top=-view.y/view.k-margin,right=(size.width-view.x)/view.k+margin,bottom=(size.height-view.y)/view.k+margin;
  const inside=at=>at&&at.x>=left&&at.x<=right&&at.y>=top&&at.y<=bottom;
  // Segment/rectangle intersection also retains a line crossing the viewport
  // whose two endpoints are off-screen.
  const intersects=(a,b)=>{if(!a||!b)return false;if(inside(a)||inside(b))return true;let lo=0,hi=1;const dx=b.x-a.x,dy=b.y-a.y;for(const [p,q] of [[-dx,a.x-left],[dx,right-a.x],[-dy,a.y-top],[dy,bottom-a.y]]){if(!p){if(q<0)return false;continue;}const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return false;}return true;};
  return {nodes:graph.nodes.filter(node=>inside(positions.get(node.path))),links:graph.links.filter(link=>intersects(positions.get(link.from),positions.get(link.to)))};
}
