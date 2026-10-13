import React,{useEffect,useRef,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {AgentMark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import {MailBody} from './MailBody.jsx';
import {mailTableDate} from '../runtime/mail-presentation.mjs';
import './approval-history.css';
const reasons={mail_portal_login:'포털에 로그인해 주세요.',mail_portal_identity:'결재용 사용자 정보를 확인하지 못했어요. 포털에 다시 로그인해 주세요.',mail_portal_timeout:'포털 응답이 늦어요. 다시 불러와 주세요.',mail_portal_format:'결재 응답 형식을 확인하지 못했어요.',mail_cancelled:'조회가 중단됐어요.'};
export function ApprovalHistory({api,onSettings}){
 const [page,setPage]=useState(1),[data,setData]=useState(null),[document,setDocument]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const read=useRef(0),selected=useRef(0),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;read.current++;selected.current++;};},[]);
 async function load(){const epoch=++read.current;setBusy(true);setError('');try{const value=await api('mail',{action:'approvals',page});if(alive.current&&epoch===read.current)setData(value);}catch(cause){if(alive.current&&epoch===read.current)setError(reasons[cause.message]||'결재 목록을 가져오지 못했어요. 다시 시도해 주세요.');}finally{if(alive.current&&epoch===read.current)setBusy(false);}}
 useEffect(()=>{setDocument(null);selected.current++;void load();},[page,api]);
 async function open(row){const epoch=++selected.current;setBusy(true);setError('');try{const value=await api('mail',{action:'approvalRead',id:row.id,lineId:row.lineId});if(alive.current&&epoch===selected.current)setDocument(value);}catch(cause){if(alive.current&&epoch===selected.current)setError(reasons[cause.message]||'결재 본문을 가져오지 못했어요.');}finally{if(alive.current&&epoch===selected.current)setBusy(false);}}
 return <section className="nubi-approval-history" aria-label="결재 조회">
  <header><strong>결재</strong><CxButton data-icon-only aria-label="결재 새로고침" title="새로고침" disabled={busy} onClick={load}><Icon name="refresh" size={18}/></CxButton></header>
  {error&&<div className="nubi-approval-notice" role="status"><Icon name="alertCircle" size={18}/><span>{error}</span><CxButton onClick={onSettings}>로그인</CxButton></div>}
  <div className="nubi-approval-list" aria-busy={busy}>
   {data?.items.length>0&&<table><thead><tr><th>제목</th><th>상신</th><th>완료</th></tr></thead><tbody>{data.items.map(row=><tr key={row.id+'|'+row.lineId} data-selected={document?.id===row.id||undefined}><td><CxButton disabled={busy} onClick={()=>open(row)} title={row.subject}><Icon name="clipboardCheck" size={18}/><strong>{row.subject}</strong></CxButton></td><td><time>{mailTableDate(row.submittedAt)}</time></td><td>{row.completedAt?<time>{mailTableDate(row.completedAt)}</time>:<span className="nubi-muted">—</span>}</td></tr>)}</tbody></table>}
   {!busy&&data?.items.length===0&&<div className="nubi-approval-empty"><AgentMark size={64} mood="still"/><p>표시할 결재가 없어요.</p></div>}
   {busy&&<div className="nubi-approval-loading" role="status"><span className="status-spinner"/><span>결재를 불러오는 중</span></div>}
  </div>
  <nav aria-label="결재 페이지"><CxButton data-icon-only aria-label="이전 결재 페이지" disabled={busy||page===1} onClick={()=>setPage(page-1)}><Icon name="chevronLeft" size={16}/></CxButton><span>{page}</span><CxButton data-icon-only aria-label="다음 결재 페이지" disabled={busy||!data?.hasNext} onClick={()=>setPage(page+1)}><Icon name="chevronRight" size={16}/></CxButton></nav>
  {document?<article className="nubi-approval-document"><h2><Icon name="clipboardCheck" size={20}/>{document.subject}</h2><MailBody text={document.mail.text} presentation={document.mail.presentation}/></article>:<p className="nubi-muted nubi-approval-selection">목록에서 결재를 선택하세요.</p>}
 </section>;
}
