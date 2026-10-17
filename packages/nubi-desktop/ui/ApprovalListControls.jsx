import React,{useEffect,useState} from 'react';
import {CxButton,CxInput,Icon,SearchField} from '@e2e/cx-design-system';
import {CxSelect} from './WorkspaceSelect.jsx';
import {MailColumnFilter} from './MailColumnFilter.jsx';

export function ApprovalListControls({query,onQuery,size,onSize,sort,onSort,data,pending,onPage,onReset,filtered}){
 const page=data?.page||1,pages=data?.totalPages||1,[draft,setDraft]=useState(String(page));
 useEffect(()=>setDraft(String(page)),[page]);
 const commit=()=>{const next=Number(draft);if(Number.isSafeInteger(next)&&next>0){const value=Math.min(pages,next);setDraft(String(value));onPage(value);}else setDraft(String(page));};
 return <div className="nubi-approval-controls">
  <SearchField label="결재 검색" placeholder="제목 검색" maxLength={500} value={query} onChange={onQuery}/>
  {filtered&&<CxButton data-icon-only aria-label="결재 검색 조건 초기화" title="검색 조건 초기화" onClick={onReset}><Icon name="filterClear" size={16}/></CxButton>}
  <div className="nubi-mail-pagination">
   <details className="nubi-mail-page-options" onKeyDown={event=>{if(event.key==='Escape'){event.currentTarget.open=false;event.currentTarget.querySelector('summary').focus();}}}>
    <summary aria-label="결재 페이지 설정" title="페이지 이동과 목록 보기"><span aria-live="polite">{data?.total?`${data.offset+1}–${data.offset+data.items.length} / ${data.total}`:'0개'}</span><Icon name="chevronDown" size={12}/></summary>
    <div className="nubi-mail-page-popover">
     <label><span className="nubi-mail-page-label"><Icon name="list" size={16}/>페이지</span><span className="nubi-mail-page-number"><CxInput aria-label="결재 페이지" inputMode="numeric" value={draft} disabled={pending} maxLength={8} onChange={event=>{if(/^\d*$/.test(event.target.value))setDraft(event.target.value);}} onBlur={commit} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing){event.preventDefault();commit();}}}/><span>/ {pages}</span></span></label>
     <label><span className="nubi-mail-page-label"><Icon name="layers" size={16}/>표시 개수</span><CxSelect aria-label="페이지당 결재 수" value={size} onChange={event=>onSize(Number(event.target.value))}>{[10,20,50,100].map(count=><option key={count} value={count}>{count}개씩</option>)}</CxSelect></label>
     <label><span className="nubi-mail-page-label"><Icon name="sort" size={16}/>정렬</span><CxSelect aria-label="결재 정렬" value={sort} onChange={event=>onSort(event.target.value)}>{[['server','기본순'],['submitted-desc','상신 최신순'],['submitted-asc','상신 오래된순'],['completed-desc','완료 최신순'],['completed-asc','완료 오래된순'],['subject-asc','제목 오름차순'],['subject-desc','제목 내림차순']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</CxSelect></label>
    </div>
   </details>
   <CxButton data-icon-only aria-label="이전 결재 페이지" title="이전 페이지" disabled={pending||page<=1} onClick={()=>onPage(page-1)}><Icon name="chevronLeft" size={16}/></CxButton>
   <CxButton data-icon-only aria-label="다음 결재 페이지" title="다음 페이지" disabled={pending||page>=pages} onClick={()=>onPage(page+1)}><Icon name="chevronRight" size={16}/></CxButton>
  </div>
 </div>;
}

export function ApprovalColumn({field,label,sort,onSort,filters,onFilter}){
 const active=sort.startsWith(field+'-'),ascending=sort===field+'-asc';
 return <th aria-sort={active?(ascending?'ascending':'descending'):'none'}><div className="nubi-approval-column">
  <button type="button" title={`${label} 정렬`} onClick={()=>onSort(field+'-'+(active&&ascending?'desc':'asc'))}>{label}<Icon name={active?(ascending?'arrowUp':'arrowDown'):'sort'} size={14}/></button>
  <MailColumnFilter field={field==='subject'?'subject':'date'} label={label} filters={filters} onChange={onFilter}/>
 </div></th>;
}
