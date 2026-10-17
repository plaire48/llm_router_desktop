import {CollectionTable} from './CollectionTable.jsx';
import React,{useMemo} from 'react';
import {Icon} from '@e2e/cx-design-system';
import {MailMatchText} from './MailMatchText.jsx';
import {mailSender,mailRoleLabel,mailTableDate} from '../runtime/mail-presentation.mjs';
import './mail-table.css';
import {MailColumnFilter} from './MailColumnFilter.jsx';

const columns=[['subject','제목'],['sender','보낸 사람'],['role','구분'],['date','날짜']];
export function MailTable({rows,selected,selectedId,blocked,selecting,toggle,togglePage,allSelected,sort,onSort,onOpen,query,filters,facets,onFilters}){
 const selectedIds=useMemo(()=>new Set(selected.map(item=>item.id)),[selected]);
 function ordering(key){if(key==='date')return sort==='oldest'?'ascending':['auto','newest'].includes(sort)&&!query||sort==='newest'?'descending':'none';return sort===key+'-asc'?'ascending':sort===key+'-desc'?'descending':'none';}
 return <CollectionTable className="nubi-mail-table" aria-label="메일 목록"><colgroup><col className="mail-check-col"/><col className="mail-subject-col"/><col className="mail-sender-col"/><col className="mail-role-col"/><col className="mail-date-col"/></colgroup><thead><tr>
  <th scope="col"><label className="nubi-mail-select"><input type="checkbox" aria-label="현재 페이지 메일 선택" checked={allSelected} ref={node=>{if(node)node.indeterminate=!allSelected&&rows.some(row=>selectedIds.has(row.sourceId));}} disabled={blocked||!rows.length||selecting} onChange={togglePage}/></label></th>
  {columns.map(([key,label])=><th key={key} scope="col" aria-sort={ordering(key)}><div className="nubi-mail-column-heading"><button disabled={blocked} onClick={()=>onSort(key==='date'?(sort==='newest'||sort==='auto'?'oldest':'newest'):sort===key+'-asc'?key+'-desc':key+'-asc')} aria-label={`${label} 정렬`}><span>{label}</span><Icon name={ordering(key)==='none'?'sort':ordering(key)==='ascending'?'arrowUp':'arrowDown'} size={14}/></button>{filters&&onFilters&&<MailColumnFilter field={key} label={label} filters={filters} facets={facets} disabled={blocked} onChange={onFilters}/>}</div></th>)}
 </tr></thead><tbody>{rows.map(row=><tr key={row.sourceId} data-open={selectedId===row.sourceId} data-selected={selectedIds.has(row.sourceId)} onClick={()=>{if(!blocked)onOpen(row.sourceId,row.sourceHash,{match:row.match,query});}}>
  <td onClick={event=>event.stopPropagation()}><label className="nubi-mail-select"><input type="checkbox" aria-label={`${row.title||'제목 없음'} 선택`} checked={selectedIds.has(row.sourceId)} disabled={blocked||selecting} onChange={()=>toggle(row)}/></label></td>
  <td><button className="nubi-mail-result" disabled={blocked} aria-pressed={selectedId===row.sourceId} title={row.title||'제목 없음'}><span>{row.local?.pinned&&<Icon name="bookmark" size={15} className="nubi-mail-pinned-mark"/>}<Icon name="mail" size={18}/><strong><MailMatchText text={row.title||'제목 없음'} query={query}/></strong>{row.attachmentCount>0&&<Icon name="file" size={14}/>}</span>{query&&<small><MailMatchText text={row.preview||row.excerpt||''} query={query}/></small>}</button></td>
  <td title={row.senderLabel||mailSender(row)}><MailMatchText text={row.senderLabel||mailSender(row)} query={query}/></td>
  <td><span className="nubi-mail-role" data-role={row.recipientRole||'unknown'} title={!row.recipientRole||row.recipientRole==='unknown'?'본인 메일 주소와 원문의 To/Cc/Bcc가 일치하지 않아요. 메일 설정의 수신 구분을 확인해 주세요.':undefined}>{mailRoleLabel(row.recipientRole)}</span></td>
  <td><time dateTime={row.date||undefined}>{mailTableDate(row.date)}</time></td>
 </tr>)}</tbody></CollectionTable>;
}
