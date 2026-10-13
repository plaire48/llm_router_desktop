import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {CxButton,CxInput,Icon} from '@e2e/cx-design-system';
import {mailRoleLabel} from '../runtime/mail-presentation.mjs';
import './mail-column-filter.css';

// E2E Report pattern: filters live next to their column, with a draft selection
// and explicit apply/reset. Filtering is still over the full collected mailbox.
export function MailColumnFilter({field,label,filters,facets,disabled,onChange}){
 const [open,setOpen]=useState(false),[draft,setDraft]=useState(filters),[query,setQuery]=useState(''),[position,setPosition]=useState({top:0,left:0});
 const trigger=useRef(null),popup=useRef(null);
 const active=field==='subject'?!!filters.subject:field==='sender'?!!filters.senders.length:field==='role'?!!filters.roles?.length:filters.period!=='all';
 const close=()=>{setOpen(false);trigger.current?.focus({preventScroll:true});};
 useLayoutEffect(()=>{
  if(!open)return;const place=()=>{const box=trigger.current.getBoundingClientRect(),height=popup.current?.getBoundingClientRect().height||260;setPosition({left:Math.max(12,Math.min(box.right-300,window.innerWidth-312)),top:Math.max(12,Math.min(box.bottom+8,window.innerHeight-height-12))});};
  const observer=new ResizeObserver(place);if(popup.current)observer.observe(popup.current);place();popup.current?.querySelector('input,button')?.focus();const outside=event=>{if(!popup.current?.contains(event.target)&&!trigger.current?.contains(event.target))setOpen(false);};
  document.addEventListener('pointerdown',outside);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);return()=>{observer.disconnect();document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
 },[open]);
 useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
 const toggle=(key,value)=>setDraft(current=>({...current,[key]:(current[key]||[]).includes(value)?current[key].filter(item=>item!==value):[...(current[key]||[]),value]}));
 const patch=()=>field==='subject'?{subject:draft.subject||''}:field==='sender'?{senders:draft.senders}:field==='role'?{roles:draft.roles||[]}:{period:draft.period,from:draft.from,to:draft.to};
 const reset=()=>{onChange(field==='subject'?{subject:''}:field==='sender'?{senders:[]}:field==='role'?{roles:[]}:{period:'all',from:'',to:''});close();};
 return <><button ref={trigger} type="button" className="nubi-mail-column-filter" data-active={active} aria-label={`${label} 필터`} title={`${label} 필터${active?' 적용 중':''}`} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={()=>{if(open)close();else{setDraft({...filters});setQuery('');setOpen(true);}}}><Icon name="filter" size={15}/></button>
 {open&&createPortal(<div ref={popup} role="dialog" aria-label={`${label} 필터 설정`} className="nubi-mail-column-popover" style={position} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}}}>
  <header><strong>{label}</strong><CxButton aria-label="필터 닫기" title="필터 닫기" onClick={close}><Icon name="xClose" size={16}/></CxButton></header>
  {field==='subject'&&<CxInput aria-label="제목에 포함된 단어" placeholder="제목에 포함된 단어" value={draft.subject||''} maxLength={500} onChange={event=>setDraft(current=>({...current,subject:event.target.value}))}/>}
  {field==='sender'&&<><CxInput type="search" aria-label="보낸 사람 필터 검색" placeholder="이름 또는 주소" value={query} onChange={event=>setQuery(event.target.value)}/><div className="nubi-mail-column-values">{(facets?.senders||[]).filter(item=>(item.label+' '+item.address).toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(item=><label key={item.address} title={item.label}><input type="checkbox" checked={draft.senders.includes(item.address)} onChange={()=>toggle('senders',item.address)}/><span>{item.label||item.address}</span></label>)}</div></>}
  {field==='role'&&<div className="nubi-mail-column-values">{['to','cc','bcc','sent','unknown'].map(role=><label key={role}><input type="checkbox" checked={(draft.roles||[]).includes(role)} onChange={()=>toggle('roles',role)}/><span>{mailRoleLabel(role)}</span></label>)}</div>}
  {field==='date'&&<><div className="nubi-mail-column-values">{[['all','전체 기간'],['7','최근 7일'],['30','최근 30일'],['custom','기간 지정'],['unknown','날짜 미확인']].map(([value,text])=><label key={value}><input type="radio" name="mail-date-period" checked={draft.period===value} onChange={()=>setDraft(current=>({...current,period:value}))}/><span>{text}</span></label>)}</div>{draft.period==='custom'&&<div className="nubi-mail-column-dates"><CxInput type="date" aria-label="시작 날짜" value={draft.from} onChange={event=>setDraft(current=>({...current,from:event.target.value}))}/><CxInput type="date" aria-label="종료 날짜" value={draft.to} onChange={event=>setDraft(current=>({...current,to:event.target.value}))}/></div>}</>}
  <footer><CxButton onClick={reset}>초기화</CxButton><CxButton variant="primary" disabled={field==='date'&&draft.period==='custom'&&(!draft.from||!draft.to||draft.from>draft.to)} onClick={()=>{onChange(patch());close();}}>적용</CxButton></footer>
 </div>,document.body)}</>;
}
