import {CollectionTable} from './CollectionTable.jsx';
import React,{memo,useEffect,useLayoutEffect,useMemo,useRef} from 'react';
import {Icon} from '@e2e/cx-design-system';
import {MailMatchText} from './MailMatchText.jsx';
import {mailSender,mailRoleLabel,mailTableDate} from '../runtime/mail-presentation.mjs';
import {mailRoleValue} from '../runtime/mail-recipient-role.mjs';
import './mail-table.css';
import {useProgressiveList} from './useProgressiveList.js';
import {MailColumnFilter} from './MailColumnFilter.jsx';

const columns=[['subject','제목'],['sender','보낸 사람'],['role','구분'],['date','날짜']];
export function MailTable({rows,selected,selectedId,blocked,selecting,toggle,togglePage,allSelected,sort,onSort,onOpen,query,filters,facets,onFilters,viewportStart=0,rowHeightHint=60,onAdmissionComplete,onRowHeight}){
 const selectedIds=useMemo(()=>new Set(selected.map(item=>item.id)),[selected]);
 const table=useRef(null),first=Math.min(Math.max(0,rows.length-10),Math.max(0,Math.floor(viewportStart/rowHeightHint)));
 const focused=table.current?.ownerDocument.activeElement,focusedId=focused?.closest('[data-mail-id]')?.dataset.mailId;
 const admission=useProgressiveList({id:rows,start:0,end:rows.length,firstStart:first,firstEnd:first+10,include:rows.flatMap((row,index)=>selectedIds.has(row.sourceId)||row.sourceId===selectedId||row.sourceId===focusedId?[index]:[]),batchSize:8});
 useLayoutEffect(()=>{if(focusedId&&focused?.isConnected&&focused.ownerDocument.activeElement===focused.ownerDocument.body)focused.focus({preventScroll:true});});
 useEffect(()=>{if(!admission.loading)onAdmissionComplete?.();},[rows,admission.loading,onAdmissionComplete]);
 useLayoutEffect(()=>{const row=table.current?.querySelector('[data-mail-id]');if(!row)return;const observer=new ResizeObserver(entries=>{const size=entries[0]?.borderBoxSize?.[0]?.blockSize;if(size>0)onRowHeight?.(size);});observer.observe(row);return()=>observer.disconnect();},[rows,onRowHeight]);
 function ordering(key){if(key==='date')return sort==='oldest'?'ascending':['auto','newest'].includes(sort)&&!query||sort==='newest'?'descending':'none';return sort===key+'-asc'?'ascending':sort===key+'-desc'?'descending':'none';}
 return <CollectionTable ref={table} data-query={!!query} aria-rowcount={rows.length+1} className="nubi-mail-table" aria-label="메일 목록"><colgroup><col className="mail-check-col"/><col className="mail-subject-col"/><col className="mail-sender-col"/><col className="mail-role-col"/><col className="mail-date-col"/></colgroup><thead><tr>
  <th scope="col"><label className="nubi-mail-select"><input type="checkbox" aria-label="현재 페이지 메일 선택" checked={allSelected} ref={node=>{if(node)node.indeterminate=!allSelected&&rows.some(row=>selectedIds.has(row.sourceId));}} disabled={blocked||!rows.length||selecting} onChange={togglePage}/></label></th>
  {columns.map(([key,label])=><th key={key} scope="col" aria-sort={ordering(key)}><div className="nubi-mail-column-heading"><button disabled={blocked} onClick={()=>onSort(key==='date'?(sort==='newest'||sort==='auto'?'oldest':'newest'):sort===key+'-asc'?key+'-desc':key+'-asc')} aria-label={`${label} 정렬`}><span>{label}</span><Icon name={ordering(key)==='none'?'sort':ordering(key)==='ascending'?'arrowUp':'arrowDown'} size={14}/></button>{filters&&onFilters&&<MailColumnFilter field={key} label={label} filters={filters} facets={facets} disabled={blocked} onChange={onFilters}/>}</div></th>)}
 </tr></thead>{rows.map((row,index)=><tbody key={row.sourceId} className="nubi-mail-row-group" style={{'--nubi-mail-group-rows':1}}>{admission.indices.has(index)?<MailRow key={row.sourceId} index={index} row={row} checked={selectedIds.has(row.sourceId)} opened={selectedId===row.sourceId} blocked={blocked} selecting={selecting} toggle={toggle} onOpen={onOpen} query={query}/>:<tr className="nubi-mail-gap" aria-hidden="true"><td colSpan={5} style={{'--nubi-mail-gap-rows':1}}/></tr>}</tbody>)}</CollectionTable>;
}

const MailRow=memo(function MailRow({row,index,checked,opened,blocked,selecting,toggle,onOpen,query}){return <tr data-mail-id={row.sourceId} aria-rowindex={index+2} data-open={opened} data-selected={checked} onClick={()=>{if(!blocked)onOpen(row.sourceId,row.sourceHash,{match:row.match,query});}}>
  <td onClick={event=>event.stopPropagation()}><label className="nubi-mail-select"><input type="checkbox" aria-label={`${row.title||'제목 없음'} 선택`} checked={checked} disabled={blocked||selecting} onChange={()=>toggle(row)}/></label></td>
  <td><button className="nubi-mail-result" disabled={blocked} aria-pressed={opened} title={row.title||'제목 없음'}><span>{row.local?.pinned&&<Icon name="bookmark" size={15} className="nubi-mail-pinned-mark"/>}<Icon name="mail" size={18}/><strong><MailMatchText text={row.title||'제목 없음'} query={query}/></strong>{row.attachmentCount>0&&<Icon name="file" size={14}/>}</span>{query&&<small><MailMatchText text={row.preview||row.excerpt||''} query={query}/></small>}</button></td>
  <td title={row.senderLabel||mailSender(row)}><MailMatchText text={row.senderLabel||mailSender(row)} query={query}/></td>
  <td><span className="nubi-mail-role" data-role={mailRoleValue(row.recipientRole)}>{mailRoleLabel(row.recipientRole)}</span></td>
  <td><time dateTime={row.date||undefined}>{mailTableDate(row.date)}</time></td>
 </tr>;});
