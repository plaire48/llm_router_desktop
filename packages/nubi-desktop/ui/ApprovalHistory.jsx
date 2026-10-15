import {WorkspaceCatalogTabs} from './WorkspaceCatalogTabs.jsx';
import {MailKnowledgeSearch} from './MailKnowledgeSearch.jsx';
import {MailReader} from './MailReader.jsx';
import {LOCAL_MAIL_KINDS,APPROVAL_KINDS} from '../runtime/mail-file-kinds.mjs';
import React,{useEffect,useRef,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {AgentMark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import {MailBody} from './MailBody.jsx';
import {mailTableDate} from '../runtime/mail-presentation.mjs';
import './approval-history.css';
import {LoadingNote} from './LoadingNote.jsx';
const reasons={mail_portal_login:'포털에 다시 로그인해 주세요.',mail_portal_approval_login:'결재 요청에 로그인 화면이 반환됐어요.',mail_portal_identity:'결재에 필요한 사용자 ID를 확인하지 못했어요.',mail_portal_timeout:'포털 응답 시간이 초과됐어요.',mail_portal_format:'서버 응답이 예상한 결재 형식과 달라요.',mail_cancelled:'조회가 중단됐어요.',mail_portal_approval_request:'결재 서버가 요청 형식을 거부했어요.',mail_portal_approval_forbidden:'결재 서버가 접근을 거부했어요. 조회 권한을 확인해 주세요.',mail_portal_rate_limited:'요청이 많아요. 잠시 후 다시 시도해 주세요.',mail_portal_unavailable:'결재 서버 오류예요. 잠시 후 다시 시도해 주세요.',mail_portal_request:'결재 요청을 완료하지 못했어요.',mail_portal_not_found:'결재 API 경로를 찾지 못했어요.',mail_portal_response:'결재 데이터 대신 웹페이지가 반환됐어요.',mail_portal_redirect:'결재 요청이 다른 페이지로 이동했어요.',mail_tls_error:'서버 인증서를 확인하지 못했어요. 사내망 연결을 확인해 주세요.',mail_size_limit:'결재 원문이 읽기 한도를 넘었어요.',mail_input_invalid:'결재 문서 식별 정보를 확인하지 못했어요.',mail_approval_empty:'서버가 빈 결재 원문을 반환했어요.',mail_approval_parse:'가져온 원문을 문서로 해석하지 못했어요.'};
const stages={identity:'사용자 확인',list:'목록 조회',document:'본문 조회',parse:'문서 해석'};
function approvalNotice(cause,fallback,row=null){
 const detail=cause?.approvalFailure,code=detail?.code||cause?.message;
 return {stage:stages[detail?.stage]?detail.stage:fallback,code,reason:reasons[code]||'결재 요청을 완료하지 못했어요.',httpStatus:Number.isInteger(detail?.httpStatus)&&detail.httpStatus>=100&&detail.httpStatus<=599?detail.httpStatus:null,row};
}
function PortalApprovalHistory({api,onSettings}){
 const [page,setPage]=useState(1),[data,setData]=useState(null),[document,setDocument]=useState(null),[busy,setBusy]=useState(''),[failure,setFailure]=useState(null);
 const loginNeeded=['mail_portal_login','mail_portal_approval_login','mail_portal_identity'].includes(failure?.code);
 const read=useRef(0),selected=useRef(0),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;read.current++;selected.current++;};},[]);
 async function hydrate(items,epoch){
  const missing=items.filter(row=>row.titlePending);let next=0,authFailed=false;
  await Promise.all(Array.from({length:Math.min(4,missing.length)},async()=>{
   while(!authFailed&&alive.current&&epoch===read.current&&next<missing.length){const row=missing[next++];
    try{const value=await api('mail',{action:'approvalTitle',id:row.id,lineId:row.lineId});if(alive.current&&epoch===read.current)setData(current=>({...current,items:current.items.map(item=>item.id===row.id&&item.lineId===row.lineId?{...item,subject:value.subject,titlePending:false}:item)}));}
    catch(cause){if(alive.current&&epoch===read.current){authFailed||=['mail_portal_login','mail_portal_approval_login'].includes(cause.message);const detail=approvalNotice(cause,'document',row);setData(current=>({...current,items:current.items.map(item=>authFailed||item.id===row.id&&item.lineId===row.lineId?{...item,titlePending:false,titleFailed:true,titleFailure:detail.reason}:item)}));}}
   }
  }));
 }
 async function load(){const epoch=++read.current;selected.current++;setBusy('list');setFailure(null);try{const value=await api('mail',{action:'approvals',page});if(alive.current&&epoch===read.current){setData(value);void hydrate(value.items,epoch);}}catch(cause){if(alive.current&&epoch===read.current)setFailure(approvalNotice(cause,'list'));}finally{if(alive.current&&epoch===read.current)setBusy('');}}
 useEffect(()=>{setDocument(null);setData(null);void load();},[page,api]);
 async function open(row){const epoch=++selected.current;setBusy('document');setDocument(null);setFailure(null);try{const value=await api('mail',{action:'approvalRead',id:row.id,lineId:row.lineId});if(alive.current&&epoch===selected.current)setDocument(value);}catch(cause){if(alive.current&&epoch===selected.current)setFailure(approvalNotice(cause,'document',row));}finally{if(alive.current&&epoch===selected.current)setBusy('');}}
 return <section className="nubi-approval-history" aria-label="결재 조회">
  <header><strong><Icon name="clipboardCheck" size={20}/>결재</strong><CxButton data-icon-only aria-label="결재 새로고침" title="새로고침" disabled={Boolean(busy)} onClick={load}><Icon name="refresh" size={18}/></CxButton></header>
  {failure&&<div className="nubi-approval-notice" role="status"><Icon name="alertCircle" size={18}/><div className="nubi-approval-notice-copy"><strong>{stages[failure.stage]} 실패{failure.httpStatus&&<small>HTTP {failure.httpStatus}</small>}</strong><span>{failure.reason}</span></div><CxButton aria-label={loginNeeded?"로그인":"다시 불러오기"} disabled={Boolean(busy)} onClick={loginNeeded?onSettings:()=>failure.row?open(failure.row):load()}><Icon name={loginNeeded?"logIn":"refresh"} size={16}/>{loginNeeded?"로그인":"다시 시도"}</CxButton></div>}
  <div className="nubi-approval-list" aria-busy={busy==='list'}>
   {data?.items.length>0&&<table><thead><tr><th>제목</th><th>상신</th><th>완료</th></tr></thead><tbody>{data.items.map(row=><tr key={row.id+'|'+row.lineId} data-selected={document?.id===row.id&&document?.lineId===row.lineId||undefined}><td><CxButton disabled={Boolean(busy)} onClick={()=>open(row)} title={row.titleFailed?row.titleFailure+' 선택해 다시 불러오세요.':row.subject}><Icon name={row.titleFailed?"alertCircle":"clipboardCheck"} size={18}/><strong>{row.subject}</strong>{row.titlePending&&<span className="status-spinner" role="status" aria-label="결재 제목 확인 중"/>}</CxButton></td><td><time>{mailTableDate(row.submittedAt)}</time></td><td>{row.completedAt?<time>{mailTableDate(row.completedAt)}</time>:<span className="nubi-muted">—</span>}</td></tr>)}</tbody></table>}
   {!busy&&data?.items.length===0&&<div className="nubi-approval-empty"><AgentMark size={64} mood="still"/><p>표시할 결재가 없어요.</p></div>}
   {busy==='list'&&<LoadingNote className="nubi-approval-loading">결재 목록을 불러오는 중</LoadingNote>}
  </div>
  {data?.items.length>0&&<nav aria-label="결재 페이지"><CxButton data-icon-only aria-label="이전 결재 페이지" disabled={Boolean(busy)||page===1} onClick={()=>setPage(page-1)}><Icon name="chevronLeft" size={16}/></CxButton><span>{page}</span><CxButton data-icon-only aria-label="다음 결재 페이지" disabled={Boolean(busy)||!data?.hasNext} onClick={()=>setPage(page+1)}><Icon name="chevronRight" size={16}/></CxButton></nav>}
  {busy==='document'?<LoadingNote>결재 본문을 불러오는 중</LoadingNote>:document?<article className="nubi-approval-document"><h2><Icon name="clipboardCheck" size={20}/>{document.subject}</h2><MailBody text={document.mail.text} presentation={document.mail.presentation}/></article>:data?.items.length>0&&!failure?<p className="nubi-muted nubi-approval-selection">목록에서 결재를 선택하세요.</p>:null}
 </section>;
}

export function ApprovalHistory({api,onSettings,status,onAsk,onAskSearch,onDocument,revision}){
 const local=(status?.localKinds||[]).filter(kind=>APPROVAL_KINDS.includes(kind));
 const [mode,setMode]=useState(()=>!status?.connected&&local.length?'local:'+local[0]:'portal'),[query,setQuery]=useState(''),[source,setSource]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const generation=useRef(0),chosen=useRef(false);
 useEffect(()=>{if(!chosen.current&&!status?.connected&&local.length&&mode==='portal')setMode('local:'+local[0]);},[status?.connected,local.join('|'),mode]);
 useEffect(()=>()=>{generation.current++;},[]);
 function change(value){chosen.current=true;generation.current++;setMode(value);setSource(null);setQuery('');setLoading(false);setError('');}
 async function open(id,hash){const epoch=++generation.current;setLoading(true);setError('');try{const value=await api('mail',{action:'read',id,includePresentation:true});if(value.sourceHash!==hash)throw Error();if(epoch===generation.current)setSource(value);}catch{if(epoch===generation.current)setError('결재 원문을 읽지 못했어요. 다시 선택해 주세요.');}finally{if(epoch===generation.current)setLoading(false);}}
 return <>{local.length>0&&<WorkspaceCatalogTabs label="결재 자료" idPrefix="approval-source" active={mode} onChange={change} items={[{key:'portal',label:<><Icon name="clipboardCheck" size={16}/>포털</>},...local.map(kind=>({key:'local:'+kind,label:<><Icon name={LOCAL_MAIL_KINDS[kind].icon} size={16}/>{LOCAL_MAIL_KINDS[kind].label}</>}))]}/>}
 {mode==='portal'?<PortalApprovalHistory api={api} onSettings={onSettings}/>:<div className="nubi-mail-history-body"><div className="nubi-mail-history-list"><MailKnowledgeSearch key={mode} api={api} mailbox={mode} query={query} onQuery={setQuery} revision={revision} selectedId={source?.id} onOpen={open} onAskSelected={onAsk} onAskSearch={onAskSearch}/></div><article className="nubi-mail-history-detail" aria-label="결재 본문" aria-busy={loading}>{error&&<p role="alert">{error}</p>}{loading?<p role="status">결재 읽는 중</p>:source?<MailReader source={source} api={api} onAsk={onAsk} onDocument={onDocument}/>:<div className="nubi-mail-reader-empty"><AgentMark size={64} mood="still"/><strong>선택된 항목이 없습니다.</strong><p>목록에서 결재를 선택하세요.</p></div>}</article></div>}</>;
}
