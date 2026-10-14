import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {CxButton,CxInput,Icon} from '@e2e/cx-design-system';
import {WorkspaceAction as ActionButton} from './WorkspaceAction.jsx';
import {sectionLabel,WIKI_SORTS} from './wiki-graph.mjs';
import './mail-column-filter.css';

// The Wiki list follows the mail list: one table, sort and filter on each
// column, pages below. Filtering is over every page the library listed.
export const WIKI_COLUMNS=[['title','제목'],['section','분류'],['type','종류'],['links','연결'],['updated','수정일']];
export const WIKI_PAGE_SIZES=[10,20,50,100];
export const EMPTY_WIKI_FILTERS=Object.freeze({sections:[],types:[],link:'all',period:'all'});
export const WIKI_SORT_LABELS={'title-asc':'제목 오름차순','title-desc':'제목 내림차순','section-asc':'분류 오름차순','section-desc':'분류 내림차순','type-asc':'종류 오름차순','type-desc':'종류 내림차순','links-desc':'연결 많은 순','links-asc':'연결 적은 순','updated-desc':'최근 수정 순','updated-asc':'오래된 수정 순'};
const LINK_CHOICES=[['all','전체 문서','file'],['linked','연결된 문서','link'],['orphan','고립 문서','alertCircle']],PERIOD_CHOICES=[['all','전체 기간'],['7','최근 7일'],['30','최근 30일']];
export function wikiDate(value){const at=Date.parse(value||'');if(!Number.isFinite(at))return '';const date=new Date(at),pad=n=>String(n).padStart(2,'0');return `${date.getFullYear()}.${pad(date.getMonth()+1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;}
export function activeWikiFilter(field,filters){return field==='section'?filters.sections.length>0:field==='type'?filters.types.length>0:field==='links'?filters.link!=='all':field==='updated'?filters.period!=='all':false;}

function SelectAll({options,draft,onChange}){
 const all=options.length>0&&options.every(option=>draft.includes(option)),count=options.filter(option=>draft.includes(option)).length;
 return <label className="nubi-mail-column-all"><input type="checkbox" checked={all} ref={node=>{if(node)node.indeterminate=count>0&&!all;}} onChange={()=>onChange(all?[]:options)}/><span>전체 선택</span><small>{count} / {options.length}</small></label>;
}
function ColumnFilter({field,label,filters,facets,disabled,onChange}){
 const [open,setOpen]=useState(false),[draft,setDraft]=useState(filters),[position,setPosition]=useState({top:0,left:0});
 const trigger=useRef(null),popup=useRef(null),active=activeWikiFilter(field,filters);
 const close=()=>{setOpen(false);trigger.current?.focus({preventScroll:true});};
 useLayoutEffect(()=>{
  if(!open)return;const place=()=>{const box=trigger.current.getBoundingClientRect(),height=popup.current?.getBoundingClientRect().height||260;setPosition({left:Math.max(12,Math.min(box.right-300,window.innerWidth-312)),top:Math.max(12,Math.min(box.bottom+8,window.innerHeight-height-12))});};
  const observer=new ResizeObserver(place);if(popup.current)observer.observe(popup.current);place();popup.current?.querySelector('input,button')?.focus();const outside=event=>{if(!popup.current?.contains(event.target)&&!trigger.current?.contains(event.target))setOpen(false);};
  document.addEventListener('pointerdown',outside);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);return()=>{observer.disconnect();document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
 },[open]);
 useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
 const toggle=(key,value)=>setDraft(current=>({...current,[key]:current[key].includes(value)?current[key].filter(item=>item!==value):[...current[key],value]}));
 const patch=()=>field==='section'?{sections:draft.sections}:field==='type'?{types:draft.types}:field==='links'?{link:draft.link}:{period:draft.period};
 const reset=()=>{onChange(field==='section'?{sections:[]}:field==='type'?{types:[]}:field==='links'?{link:'all'}:{period:'all'});close();};
 return <><button ref={trigger} type="button" className="nubi-mail-column-filter" data-active={active} aria-label={`${label} 필터`} title={`${label} 필터${active?' 적용 중':''}`} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={()=>{if(open)close();else{setDraft({...filters});setOpen(true);}}}><Icon name="filter" size={15}/>{active&&<i aria-hidden="true"/>}</button>
 {open&&createPortal(<div ref={popup} role="dialog" aria-label={`${label} 필터 설정`} className="nubi-mail-column-popover" style={position} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}}}>
  <header><span className="nubi-mail-column-popover-title"><Icon name={({section:'layers',type:'tag',links:'link',updated:'clock'})[field]||'filter'} size={16}/><strong>{label}</strong></span><CxButton aria-label="필터 닫기" title="필터 닫기" onClick={close}><Icon name="xClose" size={16}/></CxButton></header>
  {field==='section'&&<div className="nubi-mail-column-values">{facets?.sections?.length>0&&<SelectAll options={facets.sections.map(item=>item.id)} draft={draft.sections} onChange={sections=>setDraft(current=>({...current,sections}))}/>}{(facets?.sections||[]).map(item=><label key={item.id}><input type="checkbox" checked={draft.sections.includes(item.id)} onChange={()=>toggle('sections',item.id)}/><span>{sectionLabel(item.id)} ({item.count})</span></label>)}{!facets?.sections?.length&&<p className="nubi-muted">분류가 없어요.</p>}</div>}
  {field==='type'&&<div className="nubi-mail-column-values">{facets?.types?.length>0&&<SelectAll options={facets.types.map(item=>item.id)} draft={draft.types} onChange={types=>setDraft(current=>({...current,types}))}/>}{(facets?.types||[]).map(item=><label key={item.id}><input type="checkbox" checked={draft.types.includes(item.id)} onChange={()=>toggle('types',item.id)}/><span>{item.id} ({item.count})</span></label>)}{!facets?.types?.length&&<p className="nubi-muted">종류가 적힌 문서가 없어요.</p>}</div>}
  {field==='links'&&<div className="nubi-mail-column-values">{LINK_CHOICES.map(([value,text,icon])=><label key={value}><input type="radio" name="wiki-link-filter" checked={draft.link===value} onChange={()=>setDraft(current=>({...current,link:value}))}/><span className="nubi-mail-column-choice" data-choice={value}><Icon name={icon} size={14}/>{text}</span></label>)}</div>}
  {field==='updated'&&<div className="nubi-mail-column-values">{PERIOD_CHOICES.map(([value,text])=><label key={value}><input type="radio" name="wiki-period-filter" checked={draft.period===value} onChange={()=>setDraft(current=>({...current,period:value}))}/><span>{text}</span></label>)}</div>}
  <footer><WorkspaceAction action="clearFilters" iconOnly={false} label="필터 초기화" visibleLabel="초기화" onClick={reset}/><WorkspaceAction action="apply" iconOnly={false} label="필터 적용" visibleLabel="적용" className="nubi-filter-apply" onClick={()=>{onChange(patch());close();}}/></footer>
 </div>,document.body)}</>;
}

export function WikiTable({rows,selectedPath,sort,onSort,onOpen,filters,facets,onFilters,disabled,drafts,colors}){
 const ordering=key=>{const [field,direction]=sort.split('-');return field===key?direction==='asc'?'ascending':'descending':'none';};
 const next=key=>{const [field,direction]=sort.split('-');if(field===key)return `${key}-${direction==='asc'?'desc':'asc'}`;return key==='links'||key==='updated'?`${key}-desc`:`${key}-asc`;};
 return <table className="nubi-wiki-table" aria-label="위키 문서 목록"><colgroup><col className="wiki-title-col"/><col className="wiki-section-col"/><col className="wiki-type-col"/><col className="wiki-links-col"/><col className="wiki-date-col"/></colgroup><thead><tr>
  {WIKI_COLUMNS.map(([key,label])=><th key={key} scope="col" aria-sort={ordering(key)}><div className="nubi-mail-column-heading"><button type="button" disabled={disabled} onClick={()=>onSort(next(key))} aria-label={`${label} 정렬`}><span>{label}</span><Icon name={ordering(key)==='ascending'?'chevronUp':'chevronDown'} size={14}/></button>{key!=='title'&&<ColumnFilter field={key} label={label} filters={filters} facets={facets} disabled={disabled} onChange={onFilters}/>}</div></th>)}
 </tr></thead><tbody>{rows.map(row=><tr key={row.path} data-open={selectedPath===row.path} onClick={()=>{if(!disabled)onOpen(row.path);}}>
  <td><button type="button" className="nubi-wiki-result" disabled={disabled} aria-pressed={selectedPath===row.path} title={row.path}><span><strong>{row.title}</strong>{drafts?.has(row.path)&&<span className="nubi-wiki-draft-mark" aria-label="저장 전">●</span>}</span><small>{row.description||row.path}</small></button></td>
  <td title={sectionLabel(row.section)}><span className="nubi-wiki-section">{colors?.has(row.section)&&<i style={{background:colors.get(row.section)}} aria-hidden="true"/>}{sectionLabel(row.section)}</span></td>
  <td>{row.type?<span className="nubi-wiki-type">{row.type}</span>:<span className="nubi-muted">—</span>}</td>
  <td><span className="nubi-wiki-degree" data-orphan={!row.degree} title={row.degree?`연결된 문서 ${row.degree}개`:'연결된 문서 없음'}>{row.degree?<><Icon name="link" size={14}/>{row.degree}</>:<><Icon name="alertCircle" size={16}/><span className="visually-hidden">고립 문서</span></>}</span></td>
  <td><time dateTime={row.updatedAt||undefined}>{wikiDate(row.updatedAt)}</time></td>
 </tr>)}</tbody></table>;
}

export function WikiPagination({page,totalPages,total,offset,count,size,onPage,onSize,sort,onSort,disabled}){
 // Paging is the numbered pager under the table, as in skills (user request 2026-10-14); this keeps count and sort.
 return <div className="nubi-mail-pagination nubi-wiki-pagination">
  <details className="nubi-mail-page-options" onKeyDown={event=>{if(event.key==='Escape'){event.currentTarget.open=false;event.currentTarget.querySelector('summary').focus();}}}>
   <summary aria-label="위키 페이지 설정" title="페이지 이동과 목록 보기"><span aria-live="polite">{total?`${offset+1}–${offset+count} / ${total}`:'0개'}</span><Icon name="chevronDown" size={12}/></summary>
   <div className="nubi-mail-page-popover">
    <label>표시 개수<select aria-label="페이지당 문서 수" value={size} onChange={event=>onSize(Number(event.target.value))}>{WIKI_PAGE_SIZES.map(value=><option key={value} value={value}>{value}개씩</option>)}</select></label>
    <label>정렬<select aria-label="위키 정렬" value={sort} onChange={event=>onSort(event.target.value)}>{WIKI_SORTS.map(value=><option key={value} value={value}>{WIKI_SORT_LABELS[value]}</option>)}</select></label>
   </div>
  </details>
 </div>;
}
