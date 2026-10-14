import React,{useEffect,useMemo,useRef,useState} from 'react';
import {CxButton,Icon,SearchField} from '@e2e/cx-design-system';
import {BookMark} from './marks.jsx';
import {advanceWikiLayout,createWikiLayout,sectionColors,sectionLabel,wikiLayoutPositions} from './wiki-graph.mjs';

// One picture of the whole Wiki: pages as circles sized by how many pages they
// connect to, sections as colours, and thicker lines for stronger relations.
const radiusOf=degree=>5+Math.min(11,degree*1.5);
const text=value=>String(value||'').toLocaleLowerCase();
export function WikiMap({graph,selectedPath,onOpen,disabled}){
 const frame=useRef(null),[size,setSize]=useState({width:640,height:420}),[positions,setPositions]=useState(()=>new Map());
 const [query,setQuery]=useState(''),[hidden,setHidden]=useState(()=>new Set()),[orphans,setOrphans]=useState(true),[hover,setHover]=useState(null),[view,setView]=useState({x:0,y:0,k:1}),[expanded,setExpanded]=useState(false);
 const drag=useRef(null);
 // Re-layout only when the frame really changes width; scrollbars toggling a few pixels must not restart the animation.
 useEffect(()=>{if(!frame.current)return;const measure=()=>{const width=Math.max(320,Math.round(frame.current.clientWidth)),height=Math.max(320,Math.round(frame.current.clientHeight));setSize(current=>Math.abs(current.width-width)<=8&&Math.abs(current.height-height)<=8?current:{width,height});};const observer=new ResizeObserver(measure);observer.observe(frame.current);measure();return()=>observer.disconnect();},[]);
 useEffect(()=>{const layout=createWikiLayout(graph,size);let id=0;const tick=()=>{const done=advanceWikiLayout(layout,8);setPositions(wikiLayoutPositions(layout));if(!done)id=requestAnimationFrame(tick);};tick();setView({x:0,y:0,k:1});return()=>cancelAnimationFrame(id);},[graph,size.width,size.height]);
 const colors=useMemo(()=>sectionColors(graph),[graph]);
 const byPath=useMemo(()=>new Map(graph.nodes.map(node=>[node.path,node])),[graph]);
 const visible=graph.nodes.filter(node=>!hidden.has(node.section)&&(orphans||node.degree>0));
 const shown=new Set(visible.map(node=>node.path)),needle=text(query).trim();
 const matches=needle?new Set(visible.filter(node=>[node.title,node.path,node.description,...node.tags].some(value=>text(value).includes(needle))).map(node=>node.path)):null;
 const focus=hover||selectedPath,focusNode=focus?byPath.get(focus):null;
 const near=focusNode?new Set([focus,...focusNode.links,...focusNode.backlinks]):null;
 const emphasised=path=>(!near||near.has(path))&&(!matches||matches.has(path));
 const links=graph.links.filter(link=>shown.has(link.from)&&shown.has(link.to)&&positions.has(link.from)&&positions.has(link.to));
 const zoom=(factor,center)=>setView(current=>{const k=Math.min(3,Math.max(0.4,current.k*factor)),cx=center?.x??size.width/2,cy=center?.y??size.height/2;return {k,x:cx-(cx-current.x)*k/current.k,y:cy-(cy-current.y)*k/current.k};});
 const point=event=>{const box=event.currentTarget.getBoundingClientRect();return {x:(event.clientX-box.left)*size.width/box.width,y:(event.clientY-box.top)*size.height/box.height};};
 const large=visible.length>300,crowded=visible.length>120;
 const labelled=path=>{const node=byPath.get(path);return path===focus||matches?.has(path)||(near?.has(path)&&near.size<=12)||(visible.length<=40)||(!crowded&&node.degree>=2)||(crowded&&!large&&node.degree>=4&&view.k>=0.8)||(large&&node.degree>=8&&view.k>=1.2);};
 const drawn=large?links.filter(link=>link.strength>=2||(near&&(near.has(link.from)||near.has(link.to)))):links;
 return <section className="nubi-wiki-map" aria-label="위키 관계 지도" data-expanded={expanded||undefined} data-large={large||undefined}>
  <div className="nubi-wiki-map-tools">
   <SearchField label="지도에서 문서 찾기" placeholder="지도에서 문서 찾기" maxLength={200} value={query} onChange={setQuery}/>
   <div className="nubi-wiki-map-stats" aria-label="위키 요약"><span title={`문서 ${graph.nodes.length}개`}><BookMark size={16}/><span className="visually-hidden">문서 </span>{graph.nodes.length}</span><span title={`연결 ${graph.links.length}개`}><Icon name="link" size={16}/><span className="visually-hidden">연결 </span>{graph.links.length}</span><span data-attention={graph.orphans.length>0} title={`고립 문서 ${graph.orphans.length}개`}><Icon name="alertCircle" size={16}/><span className="visually-hidden">고립 문서 </span>{graph.orphans.length}</span></div>
  </div>
  <div className="nubi-wiki-map-legend" role="group" aria-label="분류별 표시">
   {graph.sections.map(entry=><button type="button" key={entry.id||'(root)'} aria-pressed={!hidden.has(entry.id)} onClick={()=>setHidden(current=>{const next=new Set(current);if(next.has(entry.id))next.delete(entry.id);else next.add(entry.id);return next;})}><i style={{background:colors.get(entry.id)}} aria-hidden="true"/>{sectionLabel(entry.id)}<small>{entry.count}</small></button>)}
   {graph.orphans.length>0&&<button type="button" className="nubi-wiki-map-orphans" aria-pressed={orphans} aria-label={`고립 문서 ${orphans?'숨기기':'표시'}`} title={`고립 문서 ${orphans?'숨기기':'표시'}`} onClick={()=>setOrphans(value=>!value)}><Icon name="alertCircle" size={16}/><small>{graph.orphans.length}</small></button>}
  </div>
  <div className="nubi-wiki-map-body">
   <div ref={frame} className="nubi-wiki-map-frame" data-dragging={!!drag.current}>
    <svg viewBox={`0 0 ${size.width} ${size.height}`} role="img" aria-label={`${visible.length}개 문서의 연결`}
     onWheel={event=>{event.preventDefault();zoom(event.deltaY<0?1.15:1/1.15,point(event));}}
     onContextMenu={event=>event.preventDefault()}
     onPointerDown={event=>{if(![0,2].includes(event.button)||(event.button===0&&event.target.closest('[role=button]')))return;drag.current={x:event.clientX,y:event.clientY,view};event.currentTarget.setPointerCapture(event.pointerId);}}
     onPointerMove={event=>{if(!drag.current)return;const box=event.currentTarget.getBoundingClientRect(),scale=size.width/box.width;setView({...drag.current.view,x:drag.current.view.x+(event.clientX-drag.current.x)*scale,y:drag.current.view.y+(event.clientY-drag.current.y)*scale});}}
     onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
     <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
      {drawn.map(link=>{const a=positions.get(link.from),b=positions.get(link.to),strong=(near&&near.has(link.from)&&near.has(link.to)&&(link.from===focus||link.to===focus));return <line key={link.from+'>'+link.to} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={0.6+link.strength*0.7} data-strong={strong||undefined} data-dim={(near||matches)&&!strong&&!(emphasised(link.from)&&emphasised(link.to))||undefined}>{!large&&<title>{`${byPath.get(link.from).title} ↔ ${byPath.get(link.to).title}: ${link.reasons.join(', ')}`}</title>}</line>;})}
      {visible.map(node=>{const at=positions.get(node.path);if(!at)return null;const dim=!emphasised(node.path);return <g key={node.path} role="button" tabIndex={disabled?-1:0} aria-label={node.title} aria-pressed={selectedPath===node.path} data-dim={dim||undefined} transform={`translate(${at.x} ${at.y})`} onClick={()=>{if(!disabled)onOpen(node.path);}} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();if(!disabled)onOpen(node.path);}}} onPointerEnter={()=>setHover(node.path)} onPointerLeave={()=>setHover(current=>current===node.path?null:current)} onFocus={()=>setHover(node.path)} onBlur={()=>setHover(current=>current===node.path?null:current)}>
       <circle r={radiusOf(node.degree)+(selectedPath===node.path?3:0)} fill={colors.get(node.section)} data-selected={selectedPath===node.path||undefined}/>
       {labelled(node.path)&&<text y={radiusOf(node.degree)+14} textAnchor="middle">{node.title.length>14?node.title.slice(0,14)+'…':node.title}</text>}
      </g>;})}
     </g>
    </svg>
    {!graph.links.length&&<p className="nubi-wiki-map-note">문서 사이의 링크가 아직 없어요. 문서를 수정해 다른 문서를 연결하면 지도에 선이 생겨요.</p>}
    <div className="nubi-wiki-map-zoom" role="group" aria-label="지도 확대"><CxButton data-icon-only aria-label="확대" title="확대 (휠)" onClick={()=>zoom(1.25)}><Icon name="plus" size={16}/></CxButton><CxButton data-icon-only aria-label="축소" title="축소 (휠)" onClick={()=>zoom(1/1.25)}><Icon name="minus" size={16}/></CxButton><CxButton data-icon-only aria-label="전체 보기" title="전체 보기" onClick={()=>setView({x:0,y:0,k:1})}><Icon name="fitView" size={16}/></CxButton><CxButton data-icon-only aria-label={expanded?'기본 크기':'넓게 보기'} title={expanded?'기본 크기':'넓게 보기'} aria-pressed={expanded} onClick={()=>setExpanded(value=>!value)}><Icon name={expanded?'minimize':'maximize'} size={16}/></CxButton></div>
    {hover&&focusNode&&<div className="nubi-wiki-map-card" role="status"><strong>{focusNode.title}</strong><span>{[focusNode.type,sectionLabel(focusNode.section),`연결 ${focusNode.degree}개`].filter(Boolean).join(' / ')}</span>{focusNode.description&&<p>{focusNode.description}</p>}</div>}
   </div>
   <aside className="nubi-wiki-map-side">
    <h3><Icon name="link" size={16}/>연결 많은 문서</h3>
    <ol>{graph.hubs.map(path=>{const node=byPath.get(path);return <li key={path}><button type="button" disabled={disabled} aria-pressed={selectedPath===path} onClick={()=>onOpen(path)}><span>{node.title}</span><small>{node.degree}</small></button></li>;})}{!graph.hubs.length&&<li className="nubi-muted">아직 연결된 문서가 없어요.</li>}</ol>
    {graph.orphans.length>0&&<><h3 title={`고립 문서 ${graph.orphans.length}개`} data-orphan="true"><Icon name="alertCircle" size={16}/><span className="visually-hidden">고립 문서 </span><small>{graph.orphans.length}</small></h3><ul>{graph.orphans.slice(0,8).map(path=><li key={path}><button type="button" disabled={disabled} aria-pressed={selectedPath===path} onClick={()=>onOpen(path)}><span>{byPath.get(path).title}</span></button></li>)}{graph.orphans.length>8&&<li className="nubi-muted">목록에서 고립 문서 필터로 모두 볼 수 있어요.</li>}</ul></>}
   </aside>
  </div>
 </section>;
}
