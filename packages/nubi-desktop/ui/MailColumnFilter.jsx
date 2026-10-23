import {useFilterPosition} from './useFilterPosition.js';
import {ShowMore} from './ShowMore.jsx';
import './filter-panel.css';
import React,{useEffect,useRef,useState,useMemo} from 'react';
import {createPortal} from 'react-dom';
import {CxButton,CxInput,Icon,SearchField} from '@e2e/cx-design-system';
import {mailRoleLabel} from '../runtime/mail-presentation.mjs';
import {MAIL_RECIPIENT_ROLES,mailRoleFilters} from '../runtime/mail-recipient-role.mjs';
import {WorkspaceAction} from './WorkspaceAction.jsx';
import './mail-column-filter.css';

// E2E Report pattern (TableControls.ColumnFilter): filters live next to their column with an active dot,
// a value search, '전체 선택' with a count, a draft selection and explicit apply/reset.
// Filtering is still over the full collected mailbox.
function SelectAll({options,draft,onChange}){
 const selected=useMemo(()=>new Set(draft),[draft]),count=options.filter(option=>selected.has(option)).length,all=options.length>0&&count===options.length;
 return <label className="nubi-mail-column-all"><input type="checkbox" checked={all} ref={node=>{if(node)node.indeterminate=count>0&&!all;}} onChange={()=>onChange(all?[]:options)}/><span>전체 선택</span><small>{count} / {options.length}</small></label>;
}
export function MailColumnFilter({field,label,filters,facets,disabled,onChange}){
 const [open,setOpen]=useState(false),[draft,setDraft]=useState(filters),[query,setQuery]=useState('');
 const trigger=useRef(null),popup=useRef(null);
 const active=field==='subject'?!!filters.subject:field==='sender'?!!filters.senders.length:field==='role'?!!filters.roles?.length:filters.period!=='all';
 const close=()=>{setOpen(false);trigger.current?.focus({preventScroll:true});};
 const position=useFilterPosition(open,trigger,popup,{onOutside:()=>setOpen(false)});
 useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
 const senderOptions=useMemo(()=>{if(!open||field!=='sender')return [];const term=query.toLocaleLowerCase();return (facets?.senders||[]).filter(item=>(item.label+' '+item.address).toLocaleLowerCase().includes(term));},[open,field,facets?.senders,query]);
 const senderSelection=useMemo(()=>new Set(draft.senders),[draft.senders]);
 const toggle=(key,value)=>setDraft(current=>({...current,[key]:(current[key]||[]).includes(value)?current[key].filter(item=>item!==value):[...(current[key]||[]),value]}));
 const patch=()=>field==='subject'?{subject:draft.subject||''}:field==='sender'?{senders:draft.senders}:field==='role'?{roles:draft.roles||[]}:{period:draft.period,from:draft.from,to:draft.to};
 const reset=()=>{onChange(field==='subject'?{subject:''}:field==='sender'?{senders:[]}:field==='role'?{roles:[]}:{period:'all',from:'',to:''});close();};
 return <><button ref={trigger} type="button" className="nubi-mail-column-filter" data-active={active} aria-label={`${label} 필터`} title={`${label} 필터${active?' 적용 중':''}`} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={()=>{if(open)close();else{setDraft({...filters,roles:mailRoleFilters(filters.roles)});setQuery('');setOpen(true);}}}><Icon name="filter" size={15}/>{active&&<i aria-hidden="true"/>}</button>
 {open&&createPortal(<div ref={popup} role="dialog" aria-label={`${label} 필터 설정`} className="nubi-mail-column-popover nubi-filter-panel" style={position} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}}}>
  <header><span className="nubi-mail-column-popover-title"><Icon name={({subject:'search',sender:'mail',role:'users',date:'calendar'})[field]||'filter'} size={16}/><strong>{label}</strong></span><CxButton aria-label="필터 닫기" title="필터 닫기" onClick={close}><Icon name="xClose" size={16}/></CxButton></header>
  {field==='subject'&&<CxInput aria-label="제목에 포함된 단어" placeholder="제목에 포함된 단어" value={draft.subject||''} maxLength={500} onChange={event=>setDraft(current=>({...current,subject:event.target.value}))}/>}
  {field==='sender'&&<><SearchField className="nubi-mail-column-search" label="보낸 사람 필터 검색" placeholder="이름 또는 주소" value={query} onChange={setQuery}/><SelectAll options={senderOptions.map(item=>item.address)} draft={draft.senders} onChange={senders=>setDraft(current=>({...current,senders}))}/><div className="nubi-mail-column-values"><ShowMore items={senderOptions} step={60} resetKey={query}>{visible=>visible.map(item=><label key={item.address} title={item.label}><input type="checkbox" checked={senderSelection.has(item.address)} onChange={()=>toggle('senders',item.address)}/><span>{item.label||item.address}</span></label>)}</ShowMore>{!senderOptions.length&&<p className="nubi-mail-column-empty">일치하는 값이 없어요.</p>}</div></>}
  {field==='role'&&<div className="nubi-mail-column-values"><SelectAll options={MAIL_RECIPIENT_ROLES} draft={draft.roles||[]} onChange={roles=>setDraft(current=>({...current,roles}))}/>{MAIL_RECIPIENT_ROLES.map(role=><label key={role}><input type="checkbox" checked={(draft.roles||[]).includes(role)} onChange={()=>toggle('roles',role)}/><span>{mailRoleLabel(role)}</span></label>)}</div>}
  {field==='date'&&<><div className="nubi-mail-column-values">{[['all','전체 기간'],['7','최근 7일'],['30','최근 30일'],['custom','기간 지정'],['unknown','날짜 미확인']].map(([value,text])=><label key={value}><input type="radio" name="mail-date-period" checked={draft.period===value} onChange={()=>setDraft(current=>({...current,period:value}))}/><span>{text}</span></label>)}</div>{draft.period==='custom'&&<div className="nubi-mail-column-dates"><CxInput type="date" aria-label="시작 날짜" value={draft.from} onChange={event=>setDraft(current=>({...current,from:event.target.value}))}/><CxInput type="date" aria-label="종료 날짜" value={draft.to} onChange={event=>setDraft(current=>({...current,to:event.target.value}))}/></div>}</>}
  <footer><WorkspaceAction action="clearFilters" iconOnly={false} label="필터 초기화" visibleLabel="초기화" onClick={reset}/><WorkspaceAction action="apply" iconOnly={false} label="필터 적용" visibleLabel="적용" className="nubi-filter-apply" disabled={field==='date'&&draft.period==='custom'&&(!draft.from||!draft.to||draft.from>draft.to)} onClick={()=>{onChange(patch());close();}}/></footer>
 </div>,document.body)}</>;
}
