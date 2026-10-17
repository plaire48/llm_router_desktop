import React,{useEffect,useMemo,useRef,useState} from 'react';
import {CxButton,Icon,SearchField} from '@e2e/cx-design-system';
import {BookMark} from './marks.jsx';
import {groupWikiGraph,clusterWikiGraph,wikiMapModes,wikiTypeLabel} from './wiki-map-groups.mjs';
import {WorkspaceCatalogTabs} from './WorkspaceCatalogTabs.jsx';
import {DriftLabel} from './DriftLabel.jsx';
import {createWikiLayout,sectionColors,sectionLabel,wikiLayoutPositions,wikiPositionBounds,wikiViewportItems} from './wiki-graph.mjs';

// One picture of the whole Wiki: pages as circles sized by how many pages they
// connect to and sections as colours. Equal lines avoid implying confidence.
const radiusOf=degree=>5+Math.min(11,degree*1.5);
const fitBounds=(bounds,size)=>{const k=Math.min(2,Math.max(1,size.width-160)/bounds.width,Math.max(1,size.height-80)/bounds.height);return {k,x:(size.width-bounds.width*k)/2-bounds.left*k,y:(size.height-bounds.height*k)/2-bounds.top*k};};
const text=value=>String(value||'').toLocaleLowerCase();
export function WikiNetwork({graph:source,selectedPath,onOpen,disabled}){
 const modes=wikiMapModes(source.kind),[grouping,setGrouping]=useState(modes[0].id),[representation,setRepresentation]=useState('documents');
 useEffect(()=>setGrouping(wikiMapModes(source.kind)[0].id),[source.kind]);
 const mode=modes.some(item=>item.id===grouping)?grouping:modes[0].id;
 const graph=useMemo(()=>groupWikiGraph(source,mode),[source,mode]);
 const labels=useMemo(()=>new Map(graph.sections.map(entry=>[entry.id,sectionLabel(entry.label??entry.id)])),[graph]);
 const groupLabel=id=>labels.get(id)||sectionLabel(id);
 const frame=useRef(null),[size,setSize]=useState({width:640,height:420}),[positions,setPositions]=useState(()=>new Map());
 const [query,setQuery]=useState(''),[hidden,setHidden]=useState(()=>new Set()),[orphans,setOrphans]=useState(true),[hover,setHover]=useState(null),[view,setView]=useState({x:0,y:0,k:1}),[expanded,setExpanded]=useState(false),[sideOpen,setSideOpen]=useState(true);
 const drag=useRef(null),savedViews=useRef({});
 // Viewport dimensions affect culling and zoom only, never layout coordinates.
 useEffect(()=>{if(!frame.current)return;const measure=()=>{const width=Math.max(320,Math.round(frame.current.clientWidth)),height=Math.max(320,Math.round(frame.current.clientHeight));setSize(current=>Math.abs(current.width-width)<=8&&Math.abs(current.height-height)<=8?current:{width,height});};const observer=new ResizeObserver(measure);observer.observe(frame.current);measure();return()=>observer.disconnect();},[]);
 // Publish a cheap initial cluster layout immediately. Relaxation runs off the
 // UI thread; panning never restarts it and viewport resize never squeezes nodes.
 const bounds=useMemo(()=>wikiPositionBounds(positions),[positions]);
 const fitted=()=>fitBounds(bounds,size);
 const changeRepresentation=value=>{if(value===representation)return;savedViews.current[representation]=view;setRepresentation(value);setHover(null);setView(savedViews.current[value]||(value==='clusters'?fitted():{x:0,y:0,k:1}));};
 useEffect(()=>{
  const layout=createWikiLayout(graph),initial=wikiLayoutPositions(layout);savedViews.current={};setPositions(initial);setView(graph.nodes.length<=250?fitBounds(wikiPositionBounds(initial),size):{x:0,y:0,k:1});setHidden(new Set());setHover(null);
  let worker;const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  try{worker=new Worker(new URL('chunks/wiki-layout-worker.js',document.baseURI),{type:'module'});
   worker.onmessage=({data})=>{if(!reduced||data.done)setPositions(new Map(data.positions));if(data.done)worker.terminate();};
   worker.onerror=event=>{event.preventDefault();worker.terminate();};
   worker.postMessage({graph:{nodes:graph.nodes.map(({path,section})=>({path,section})),links:graph.links.map(({from,to,strength})=>({from,to,strength}))}});
  }catch{/* The initial free-canvas layout remains usable if workers are unavailable. */}
  return()=>worker?.terminate();
 },[graph]);
 const openNode=node=>{
  if(disabled)return;
  if(node.clusterId!==undefined){savedViews.current.clusters=view;const memberPositions=new Map(node.members.map(path=>[path,positions.get(path)]));const box=wikiPositionBounds(memberPositions,40);const k=Math.max(.6,Math.min(1.5,Math.max(1,size.width-160)/box.width,Math.max(1,size.height-80)/box.height));setRepresentation('documents');setHover(null);setView({k,x:(size.width-box.width*k)/2-box.left*k,y:(size.height-box.height*k)/2-box.top*k});}
  else onOpen(node.path);
 };
 const colors=useMemo(()=>sectionColors(graph),[graph]);
 const byPath=useMemo(()=>new Map(graph.nodes.map(node=>[node.path,node])),[graph]);
 // Pan/hover changes the viewport, not the graph. Reuse membership, links and
 // search matches; aggregate clusters only while the cluster view is visible.
 const visible=useMemo(()=>graph.nodes.filter(node=>!hidden.has(node.section)&&(orphans||node.degree>0)),[graph,hidden,orphans]);
 const shown=useMemo(()=>new Set(visible.map(node=>node.path)),[visible]),needle=text(query).trim();
 const documentLinks=useMemo(()=>graph.links.filter(link=>shown.has(link.from)&&shown.has(link.to)&&positions.has(link.from)&&positions.has(link.to)),[graph,shown,positions]);
 const collapsed=useMemo(()=>representation==='clusters'?clusterWikiGraph({...graph,nodes:visible,links:documentLinks},positions):null,[representation,graph,positions,visible,documentLinks]);
 const displayPositions=representation==='clusters'?collapsed.positions:positions;
 const displayNodes=collapsed?collapsed.graph.nodes:visible;
 const displayByPath=useMemo(()=>new Map(displayNodes.map(node=>[node.path,node])),[displayNodes]);
 const matches=useMemo(()=>{
  if(!needle)return null;
  const found=new Set(visible.filter(node=>[node.title,node.path,node.description,...node.tags].some(value=>text(value).includes(needle))).map(node=>node.path));
  if(collapsed)for(const node of displayNodes)if(node.members.some(path=>found.has(path))||text(node.title).includes(needle))found.add(node.path);
  return found;
 },[needle,visible,collapsed,displayNodes]);
 const focus=hover||selectedPath,focusNode=focus?displayByPath.get(focus):null;
 const near=focusNode?new Set([focus,...focusNode.links,...focusNode.backlinks]):null;
 const emphasised=path=>(!near||near.has(path))&&(!matches||matches.has(path));
 const links=collapsed?collapsed.graph.links:documentLinks;
 const minZoom=Math.min(0.4,Math.min(Math.max(1,size.width-160)/bounds.width,Math.max(1,size.height-80)/bounds.height)*0.9);
 const zoom=(factor,center)=>setView(current=>{const k=Math.min(3,Math.max(minZoom,current.k*factor)),cx=center?.x??size.width/2,cy=center?.y??size.height/2;return {k,x:cx-(cx-current.x)*k/current.k,y:cy-(cy-current.y)*k/current.k};});
 const point=event=>{const box=event.currentTarget.getBoundingClientRect();return {x:(event.clientX-box.left)*size.width/box.width,y:(event.clientY-box.top)*size.height/box.height};};
 // The wheel zooms the map and never scrolls the page: React's wheel listener is passive, so a native non-passive
 // listener on the svg takes it (user report 2026-10-14: scrolling moved the page up and down).
 const svg=useRef(null),wheel=useRef(null);wheel.current=event=>{event.preventDefault();zoom(event.deltaY<0?1.15:1/1.15,point(event));};
 useEffect(()=>{const node=svg.current;if(!node)return;const handler=event=>wheel.current?.(event);node.addEventListener('wheel',handler,{passive:false});return()=>node.removeEventListener('wheel',handler);},[]);
 const viewport=useMemo(()=>wikiViewportItems({nodes:displayNodes,links},displayPositions,view,size,80/view.k),[displayNodes,links,displayPositions,view,size]);
 const rendered=viewport.nodes;
 const large=rendered.length>300,crowded=rendered.length>120;
 // Keep labels at reading size. At overview zoom show representative labels,
 // and avoid collisions rather than shrinking every title into unreadable text.
 const labelPaths=new Set(),occupied=representation==='clusters'?rendered.map(node=>{const at=displayPositions.get(node.path),x=at.x*view.k+view.x,y=at.y*view.k+view.y,r=18+Math.min(14,Math.sqrt(node.count));return {left:x-r,right:x+r,top:y-r,bottom:y+r};}):[],labelGroups=new Set();
 for(const node of [...rendered].sort((a,b)=>(b.path===focus)-(a.path===focus)||Number(matches?.has(b.path)||false)-Number(matches?.has(a.path)||false)||b.degree-a.degree||a.path.localeCompare(b.path))){
  const important=node.path===focus||matches?.has(node.path);
  if(labelPaths.size>=80&&node.path!==focus)continue;
  if(!important&&view.k<.75&&labelGroups.has(node.section))continue;
  const at=displayPositions.get(node.path),x=at.x*view.k+view.x,y=at.y*view.k+view.y+(node.clusterId!==undefined?34:radiusOf(node.degree)*view.k)+16;
  const half=Math.min(node.title.length,15)*4.5,box={left:x-half,right:x+half,top:y-14,bottom:y+6};
  if(node.path!==focus&&occupied.some(other=>box.left<other.right+8&&box.right>other.left-8&&box.top<other.bottom+4&&box.bottom>other.top-4))continue;
  labelPaths.add(node.path);labelGroups.add(node.section);occupied.push(box);
 }
 const labelled=path=>labelPaths.has(path);

 const inView=viewport.links;
 const drawn=inView;
 return <section className="nubi-wiki-map" aria-label="위키 관계 지도" data-expanded={expanded||undefined} data-side-closed={!sideOpen||undefined} data-large={large||undefined}>
  <div className="nubi-wiki-map-tools">
   <SearchField label="지도에서 문서 찾기" placeholder="지도에서 문서 찾기" maxLength={200} value={query} onChange={setQuery}/>
   <div className="nubi-wiki-map-stats" aria-label="위키 요약"><span title={`문서 ${graph.nodes.length}개`}><BookMark size={16}/><span className="visually-hidden">문서 </span>{graph.nodes.length}</span><span title={`표시된 연결 ${graph.links.length}쌍`}><Icon name="link" size={16}/><span className="visually-hidden">표시된 연결 </span>{graph.links.length}</span><span data-unlinked={graph.orphans.length>0} title={`연결 없는 문서 ${graph.orphans.length}개`}><Icon name="file" size={16}/><span className="visually-hidden">연결 없는 문서 </span>{graph.orphans.length}</span></div>
  </div>
  <details className="nubi-wiki-map-options"><summary>묶음과 표시 설정</summary>
  <div className="nubi-wiki-map-views">
  <WorkspaceCatalogTabs wide={false} label="지도 보기 방식" idPrefix="wiki-map-view" active={representation} onChange={changeRepresentation} items={[{key:'documents',label:<><Icon name="file" size={16}/>문서로 보기</>},{key:'clusters',label:<><Icon name="layers" size={16}/>묶어서 보기</>}]}/>
  <WorkspaceCatalogTabs wide={false} label="지도 묶음 기준" idPrefix="wiki-map-group" active={mode} onChange={setGrouping} items={modes.map(item=>({key:item.id,label:<><Icon name={item.icon} size={16}/>{item.label}</>}))}/>
  </div>
  <div className="nubi-wiki-map-legend" role="group" aria-label="분류별 표시">
   {graph.sections.map(entry=><button type="button" key={entry.id||'(root)'} aria-pressed={!hidden.has(entry.id)} title={`${groupLabel(entry.id)} (${entry.count}개 문서)`} onClick={()=>setHidden(current=>{const next=new Set(current);if(next.has(entry.id))next.delete(entry.id);else next.add(entry.id);return next;})}><i style={{background:colors.get(entry.id)}} aria-hidden="true"/><span>{groupLabel(entry.id)}</span><small>{entry.count}개</small></button>)}
   {graph.orphans.length>0&&<button type="button" className="nubi-wiki-map-orphans" aria-pressed={orphans} aria-label={`연결 없는 문서 ${orphans?'숨기기':'표시'}`} title={`연결 없는 문서 ${orphans?'숨기기':'표시'}`} onClick={()=>setOrphans(value=>!value)}><Icon name="file" size={16}/><small>{graph.orphans.length}</small></button>}
  </div>
  {(mode==='topic'||representation==='clusters')&&<p className="nubi-wiki-map-group-note"><Icon name="infoCircle" size={14}/>{representation==='clusters'?(source.kind==='mail'?'묶음의 공통 키워드나 분류를 표시해요. 누르면 문서별로 펼쳐집니다.':'묶음을 누르면 문서별로 펼쳐집니다.'):source.kind==='mail'?'회신과 주제 유사도로 묶었어요. 점선은 관련 후보예요.':'문서에 기록된 연결을 기준으로 묶었어요.'}</p>}
  </details>
  <p className="nubi-wiki-map-group-note">{representation==='clusters'?'묶음 안 숫자는 문서 수예요.':'점 크기는 연결된 문서 수예요.'} 거리와 위치는 중요도나 유사도 점수가 아니에요.{source.links.some(link=>link.relationship?.confidence==='candidate')?' 현재 표시에는 관련 후보도 포함돼요.':''}</p>
  <div className="nubi-wiki-map-body">
   <div ref={frame} className="nubi-wiki-map-frame" data-dragging={!!drag.current}>
    <svg ref={svg} viewBox={`0 0 ${size.width} ${size.height}`} role="group" aria-label={representation==='clusters'?`${displayNodes.length}개 클러스터의 연결`:`${visible.length}개 문서의 연결`}
     onContextMenu={event=>event.preventDefault()}
     onPointerDown={event=>{if(![0,2].includes(event.button)||(event.button===0&&event.target.closest('[role=button]')))return;drag.current={x:event.clientX,y:event.clientY,view};event.currentTarget.setPointerCapture(event.pointerId);}}
     onPointerMove={event=>{if(!drag.current)return;const box=event.currentTarget.getBoundingClientRect(),scale=size.width/box.width;setView({...drag.current.view,x:drag.current.view.x+(event.clientX-drag.current.x)*scale,y:drag.current.view.y+(event.clientY-drag.current.y)*scale});}}
     onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
     <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
      {drawn.map(link=>{const a=displayPositions.get(link.from),b=displayPositions.get(link.to),strong=(near&&near.has(link.from)&&near.has(link.to)&&(link.from===focus||link.to===focus));return <line key={link.from+'>'+link.to} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={1.2/view.k} data-candidate={link.relationship?.confidence==='candidate'||undefined} data-strong={strong||undefined} data-dim={(near||matches)&&!strong&&!(emphasised(link.from)&&emphasised(link.to))||undefined}>{!large&&<title>{`${displayByPath.get(link.from).title} ↔ ${displayByPath.get(link.to).title}: ${link.reasons.join(', ')}`}</title>}</line>;})}
      {rendered.map(node=>{const at=displayPositions.get(node.path);if(!at)return null;const dim=!emphasised(node.path);return <g key={node.path} role="button" tabIndex={disabled?-1:0} aria-label={node.clusterId!==undefined?`${node.title}, 문서 ${node.count}개 펼치기`:node.title} aria-pressed={selectedPath===node.path} data-dim={dim||undefined} transform={`translate(${at.x} ${at.y})`} onClick={()=>openNode(node)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openNode(node);}}} onPointerEnter={()=>setHover(node.path)} onPointerLeave={()=>setHover(current=>current===node.path?null:current)} onFocus={()=>setHover(node.path)} onBlur={()=>setHover(current=>current===node.path?null:current)}>
       <title>{node.title}</title><circle r={node.clusterId!==undefined?(18+Math.min(14,Math.sqrt(node.count)))/view.k:Math.max(radiusOf(node.degree),4/view.k)+(selectedPath===node.path?3/view.k:0)} fill={colors.get(node.section)} fillOpacity={node.clusterId!==undefined?.18:undefined} style={node.clusterId!==undefined?{stroke:colors.get(node.section),strokeWidth:1/view.k}:undefined} data-selected={selectedPath===node.path||undefined}/>
       {node.clusterId!==undefined&&<text className="nubi-wiki-cluster-count" textAnchor="middle" dominantBaseline="central" transform={`scale(${1/view.k})`}>{node.count}</text>}
       {labelled(node.path)&&<text y={node.clusterId!==undefined?50:radiusOf(node.degree)*view.k+16} transform={`scale(${1/view.k})`} textAnchor="middle">{node.title.length>14?node.title.slice(0,14)+'…':node.title}</text>}
      </g>;})}
     </g>
    </svg>
    {representation==='documents'&&!graph.links.length&&<p className="nubi-wiki-map-note">문서 사이의 링크가 아직 없어요. 문서를 수정해 다른 문서를 연결하면 지도에 선이 생겨요.</p>}
    <div className="nubi-wiki-map-zoom" role="group" aria-label="지도 확대"><CxButton data-icon-only aria-label="확대" title="확대 (휠)" onClick={()=>zoom(1.25)}><Icon name="plus" size={16}/></CxButton><CxButton data-icon-only aria-label="축소" title="축소 (휠)" onClick={()=>zoom(1/1.25)}><Icon name="minus" size={16}/></CxButton><CxButton data-icon-only aria-label="전체 보기" title="전체 보기" onClick={()=>setView(fitted())}><Icon name="fitView" size={16}/></CxButton><CxButton data-icon-only aria-label={expanded?'기본 크기':'넓게 보기'} title={expanded?'기본 크기':'넓게 보기'} aria-pressed={expanded} onClick={()=>setExpanded(value=>!value)}><Icon name={expanded?'minimize':'maximize'} size={16}/></CxButton></div>
    {hover&&focusNode&&<div className="nubi-wiki-map-card" role="status"><strong>{focusNode.title}</strong><span>{[wikiTypeLabel(focusNode.type),groupLabel(focusNode.section),`연결 ${focusNode.degree}개`].filter(Boolean).join(' / ')}</span>{focusNode.description&&<p>{focusNode.description}</p>}</div>}
   </div>
   {sideOpen?<aside className="nubi-wiki-map-side">
    {/* One control folds the panel (user standard 2026-10-14: no duplicate buttons); it sits in the first header. */}
    <div className="nubi-wiki-map-side-head"><h3><Icon name="link" size={16}/>연결을 따라 읽기</h3><button type="button" className="nubi-wiki-map-side-toggle" aria-label="목록 접기" title="목록 접기" onClick={()=>setSideOpen(false)}><Icon name="chevronsRight" size={16}/></button></div>
    <ol>{graph.hubs.map(path=>{const node=byPath.get(path);return <li key={path}><button type="button" disabled={disabled} aria-pressed={selectedPath===path} title={`${node.title} (${groupLabel(node.section)}, 연결 ${node.degree}개)`} aria-label={`${node.title}, 연결 ${node.degree}개`} onClick={()=>onOpen(path)}><i className="nubi-wiki-map-dot" aria-hidden="true" style={{background:colors.get(node.section)}}/><small className="nubi-wiki-map-count">{node.degree}</small><DriftLabel>{node.title}</DriftLabel></button></li>;})}{!graph.hubs.length&&<li className="nubi-muted">아직 연결된 문서가 없어요.</li>}</ol>
    {graph.orphans.length>0&&<details open><summary><h3 title={`연결 없는 문서 ${graph.orphans.length}개`} data-orphan="true"><Icon name="file" size={16}/><span className="visually-hidden">연결 없는 문서 </span><small>{graph.orphans.length}</small></h3><Icon name="chevronDown" size={14}/></summary><ul>{graph.orphans.slice(0,8).map(path=><li key={path}><button type="button" disabled={disabled} aria-pressed={selectedPath===path} title={`${byPath.get(path).title} (${groupLabel(byPath.get(path).section)})`} onClick={()=>onOpen(path)}><i className="nubi-wiki-map-dot" aria-hidden="true" style={{background:colors.get(byPath.get(path).section)}}/><span>{byPath.get(path).title}</span></button></li>)}{graph.orphans.length>8&&<li className="nubi-muted">목록에서 연결 없는 문서 필터로 모두 볼 수 있어요.</li>}</ul></details>}
   </aside>:<button type="button" className="nubi-wiki-map-side-open" aria-label="연결을 따라 읽기 목록 펼치기" title="연결을 따라 읽기 목록 펼치기" onClick={()=>setSideOpen(true)}><Icon name="chevronsLeft" size={16}/></button>}
  </div>
 </section>;
}
