import {CollectionTable} from './CollectionTable.jsx';
import {WorkspaceCatalogTabs} from './WorkspaceCatalogTabs.jsx';
import {MailKnowledgeSearch} from './MailKnowledgeSearch.jsx';
import {MailReader} from './MailReader.jsx';
import {LOCAL_MAIL_KINDS,APPROVAL_KINDS} from '../runtime/mail-file-kinds.mjs';
import React,{useCallback,useEffect,useMemo,useRef,useState,memo} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {AgentMark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import {MailBody} from './MailBody.jsx';
import {mailTableDate} from '../runtime/mail-presentation.mjs';
import './approval-history.css';
import {PageNumbers} from './PageNumbers.jsx';
import {ApprovalListControls,ApprovalColumn} from './ApprovalListControls.jsx';
import {createApprovalSearch,emptyApprovalDates} from './approval-search.mjs';
import {LoadingNote} from './LoadingNote.jsx';
const reasons={mail_portal_login:'포털에 다시 로그인해 주세요.',mail_portal_approval_login:'결재 요청에 로그인 화면이 반환됐어요.',mail_portal_identity:'결재 사용자 ID를 찾지 못했어요. 메일 연결은 유지돼요.',mail_portal_timeout:'포털 응답 시간이 초과됐어요.',mail_portal_format:'서버 응답이 예상한 결재 형식과 달라요.',mail_cancelled:'조회가 중단됐어요.',mail_portal_approval_request:'결재 서버가 요청 형식을 거부했어요.',mail_portal_approval_forbidden:'결재 서버가 접근을 거부했어요. 조회 권한을 확인해 주세요.',mail_portal_rate_limited:'요청이 많아요. 잠시 후 다시 시도해 주세요.',mail_portal_unavailable:'결재 서버 오류예요. 잠시 후 다시 시도해 주세요.',mail_portal_request:'결재 요청을 완료하지 못했어요.',mail_portal_not_found:'결재 API 경로를 찾지 못했어요.',mail_portal_response:'결재 데이터 대신 웹페이지가 반환됐어요.',mail_portal_redirect:'결재 요청이 다른 페이지로 이동했어요.',mail_tls_error:'서버 인증서를 확인하지 못했어요. 사내망 연결을 확인해 주세요.',mail_size_limit:'결재 원문이 읽기 한도를 넘었어요.',mail_input_invalid:'결재 문서 식별 정보를 확인하지 못했어요.',mail_approval_empty:'서버가 빈 결재 원문을 반환했어요.',mail_approval_parse:'가져온 원문을 문서로 해석하지 못했어요.'};
const stages={identity:'사용자 확인',list:'목록 조회',document:'본문 조회',parse:'문서 해석'};
function approvalNotice(cause,fallback,row=null){
 const detail=cause?.approvalFailure,code=detail?.code||cause?.message;
 return {stage:stages[detail?.stage]?detail.stage:fallback,code,reason:reasons[code]||'결재 요청을 완료하지 못했어요.',httpStatus:Number.isInteger(detail?.httpStatus)&&detail.httpStatus>=100&&detail.httpStatus<=599?detail.httpStatus:null,row};
}
function PortalApprovalHistory({api,onSettings}){
 const [page,setPage]=useState(1),[data,setData]=useState(null),[document,setDocument]=useState(null),[busy,setBusy]=useState(''),[failure,setFailure]=useState(null);
 const [query,setQuery]=useState(''),[submitted,setSubmitted]=useState(emptyApprovalDates),[completed,setCompleted]=useState(emptyApprovalDates),[sort,setSort]=useState('server'),[size,setSize]=useState(()=>{try{const value=Number(localStorage.getItem('nubi-approval-page-size'));return [10,20,50,100].includes(value)?value:20;}catch{return 20;}}),[refresh,setRefresh]=useState(0),[progress,setProgress]=useState(null);
 const search=useMemo(()=>createApprovalSearch(api),[api,refresh]);
 const changeQuery=value=>{setQuery(value);setPage(1);},changeSort=value=>{setSort(value);setPage(1);};
 const changeDates=(which,patch)=>{(which==='submitted'?setSubmitted:setCompleted)(current=>({...current,...patch}));setPage(1);};
 const reset=()=>{setQuery('');setSubmitted(emptyApprovalDates());setCompleted(emptyApprovalDates());setSort('server');setPage(1);};
 const refreshList=()=>{setPage(1);setRefresh(value=>value+1);};
 const filtered=!!query||submitted.period!=='all'||completed.period!=='all';
 const loginNeeded=['mail_portal_login','mail_portal_approval_login'].includes(failure?.code);
 const read=useRef(0),selected=useRef(0),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;read.current++;selected.current++;};},[]);
 async function hydrate(items,epoch){
  const missing=items.filter(row=>row.titlePending);let next=0,authFailed=false,timer=null,updates=new Map();
  const flush=()=>{clearTimeout(timer);timer=null;if(!alive.current||epoch!==read.current){updates.clear();return;}const batch=updates;updates=new Map();if(batch.size||authFailed)setData(current=>current?({...current,items:current.items.map(item=>{const update=batch.get(item.id+'|'+item.lineId);return update?{...item,...update}:authFailed&&item.titlePending?{...item,titlePending:false,titleFailed:true}:item;})}):current);};
  const queue=(row,update)=>{if(!alive.current||epoch!==read.current)return;updates.set(row.id+'|'+row.lineId,update);if(!timer)timer=setTimeout(flush,80);};
  try{await Promise.all(Array.from({length:Math.min(3,missing.length)},async()=>{
   while(!authFailed&&alive.current&&epoch===read.current&&next<missing.length){const row=missing[next++];
    try{const value=await search.title(row);queue(row,{subject:value.subject,titlePending:false});}
    catch(cause){authFailed||=['mail_portal_login','mail_portal_approval_login'].includes(cause.message);const detail=approvalNotice(cause,'document',row);queue(row,{titlePending:false,titleFailed:true,titleFailure:detail.reason});}
   }
  }));}finally{flush();}
 }
 async function load(){const epoch=++read.current;selected.current++;setBusy('list');setFailure(null);setProgress(null);let lastProgress=0;try{const value=await search.search({page,size,query,submitted,completed,sort},value=>{if(alive.current&&epoch===read.current&&(Date.now()-lastProgress>=80||value.done===value.total)){lastProgress=Date.now();setProgress(value);}},()=>!alive.current||epoch!==read.current);if(alive.current&&epoch===read.current){setData(value);void hydrate(value.items,epoch);}}catch(cause){if(alive.current&&epoch===read.current)setFailure(approvalNotice(cause,'list'));}finally{if(alive.current&&epoch===read.current){setBusy('');setProgress(null);}}}
 useEffect(()=>{const timer=setTimeout(()=>void load(),query?250:0);read.current++;setBusy('list');return()=>{clearTimeout(timer);read.current++;};},[page,size,query,submitted,completed,sort,search]);
 const open=useCallback(async row=>{const epoch=++selected.current;setBusy('document');setDocument(null);setFailure(null);try{const value=await api('mail',{action:'approvalRead',id:row.id,lineId:row.lineId});if(alive.current&&epoch===selected.current)setDocument(value);}catch(cause){if(alive.current&&epoch===selected.current)setFailure(approvalNotice(cause,'document',row));}finally{if(alive.current&&epoch===selected.current)setBusy('');}},[api]);
 return <section className="nubi-approval-history" aria-label="결재 조회">
  <header><strong><Icon name="clipboardCheck" size={20}/>결재</strong><CxButton data-icon-only aria-label="결재 새로고침" title="새로고침" disabled={Boolean(busy)} onClick={refreshList}><Icon name="refresh" size={18}/></CxButton></header>
  <ApprovalListControls query={query} onQuery={changeQuery} size={size} onSize={value=>{setSize(value);setPage(1);try{localStorage.setItem('nubi-approval-page-size',String(value));}catch{}}} sort={sort} onSort={changeSort} data={data} pending={busy==='list'} onPage={setPage} filtered={submitted.period!=='all'||completed.period!=='all'||sort!=='server'||!!query} onReset={reset}/>
  {filtered&&<div className="nubi-mail-filter-chips" aria-label="결재 검색 조건">{[[query?'제목: '+query:'',()=>changeQuery('')],...[['submitted',submitted,'상신'],['completed',completed,'완료']].map(([field,filter,label])=>[filter.period==='all'?'':`${label}: ${filter.period==='custom'?filter.from+' ~ '+filter.to:filter.period==='unknown'?'날짜 미확인':'최근 '+filter.period+'일'}`,()=>changeDates(field,emptyApprovalDates())])].filter(([label])=>label).map(([label,clear])=><span key={label} title={label}><span>{label}</span><CxButton data-icon-only aria-label={label+' 조건 제거'} onClick={clear}><Icon name="xClose" size={12}/></CxButton></span>)}</div>}
  {failure&&<div className="nubi-approval-notice" role="status"><Icon name="alertCircle" size={18}/><div className="nubi-approval-notice-copy"><strong>{stages[failure.stage]} 실패{failure.httpStatus&&<small>HTTP {failure.httpStatus}</small>}</strong><span>{failure.reason}</span></div><CxButton aria-label={loginNeeded?"로그인":"다시 불러오기"} disabled={Boolean(busy)} onClick={loginNeeded?onSettings:()=>failure.row?open(failure.row):load()}><Icon name={loginNeeded?"logIn":"refresh"} size={16}/>{loginNeeded?"로그인":"다시 시도"}</CxButton></div>}
  <div className="nubi-approval-list" aria-busy={busy==='list'}>
   {data&&<CollectionTable><thead><tr><ApprovalColumn field="subject" label="제목" sort={sort} onSort={changeSort} filters={{subject:query}} onFilter={patch=>changeQuery(patch.subject)}/><ApprovalColumn field="submitted" label="상신" sort={sort} onSort={changeSort} filters={submitted} onFilter={patch=>changeDates('submitted',patch)}/><ApprovalColumn field="completed" label="완료" sort={sort} onSort={changeSort} filters={completed} onFilter={patch=>changeDates('completed',patch)}/></tr></thead><tbody>{data.items.map(row=><ApprovalRow key={row.id+'|'+row.lineId} row={row} selected={document?.id===row.id&&document?.lineId===row.lineId} busy={Boolean(busy)} onOpen={open} query={query}/>)}</tbody></CollectionTable>}
   {!busy&&data?.items.length===0&&<div className="nubi-approval-empty"><AgentMark size={64} mood="still"/><p>{filtered?'검색 결과가 없어요.':'표시할 결재가 없어요.'}</p></div>}
   {busy==='list'&&<LoadingNote className="nubi-approval-loading">{progress?`${progress.stage==='title'?'제목 확인':'목록 확인'} ${progress.done} / ${progress.total}`:'결재 목록을 불러오는 중'}</LoadingNote>}
  </div>
  <PageNumbers page={data?.page||1} totalPages={data?.totalPages||1} disabled={busy==='list'} label="결재" onPage={setPage}/>
  {data?.unavailable>0&&<p className="nubi-approval-coverage" role="status"><Icon name="infoCircle" size={16}/>제목 미확인 {data.unavailable}개는 검색과 제목 정렬이 제한돼요.<CxButton onClick={load}>다시 확인</CxButton></p>}
  {busy==='document'?<LoadingNote>결재 본문을 불러오는 중</LoadingNote>:document?<article className="nubi-approval-document"><h2><Icon name="clipboardCheck" size={20}/>{document.subject}</h2><MailBody text={document.mail.text} presentation={document.mail.presentation}/></article>:data?.items.length>0&&!failure?<p className="nubi-muted nubi-approval-selection">목록에서 결재를 선택하세요.</p>:null}
 </section>;
}

const ApprovalRow=memo(function ApprovalRow({row,selected,busy,onOpen,query}){
 return <tr data-selected={selected||undefined}><td><CxButton className="nubi-collection-title" disabled={busy} onClick={()=>onOpen(row)} title={row.titleFailed?(row.titleFailure||'제목을 확인하지 못했어요.')+' 선택해 다시 불러오세요.':row.subject}><Icon name={row.titleFailed?'alertCircle':'clipboardCheck'} size={18}/><strong><ApprovalTitle text={row.subject} query={query}/></strong>{row.titlePending&&<span className="status-spinner" role="status" aria-label="결재 제목 확인 중"/>}</CxButton></td><td><time>{mailTableDate(row.submittedAt)}</time></td><td>{row.completedAt?<time>{mailTableDate(row.completedAt)}</time>:<span className="nubi-muted">—</span>}</td></tr>;
});

function ApprovalTitle({text,query}){
 const term=query.trim();if(!term)return text;
 const offset=text.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
 return offset<0?text:<>{text.slice(0,offset)}<mark>{text.slice(offset,offset+term.length)}</mark>{text.slice(offset+term.length)}</>;
}

export function ApprovalHistory({api,onSettings,status,onAsk,onAskSearch,onDocument,revision}){
 const local=(status?.localKinds||[]).filter(kind=>APPROVAL_KINDS.includes(kind));
 const desktop=status?.desktop?.mode==='desktop';
 const [mode,setMode]=useState(()=>(desktop||!status?.connected)&&local.length?'local:'+local[0]:'portal'),[query,setQuery]=useState(''),[source,setSource]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const generation=useRef(0),chosen=useRef(false);
 useEffect(()=>{if(!chosen.current&&(desktop||!status?.connected)&&local.length&&mode==='portal')setMode('local:'+local[0]);},[desktop,status?.connected,local.join('|'),mode]);
 useEffect(()=>()=>{generation.current++;},[]);
 function change(value){chosen.current=true;generation.current++;setMode(value);setSource(null);setQuery('');setLoading(false);setError('');}
 async function open(id,hash){const epoch=++generation.current;setLoading(true);setError('');try{const value=await api('mail',{action:'read',id,includePresentation:true});if(value.sourceHash!==hash)throw Error();if(epoch===generation.current)setSource(value);}catch{if(epoch===generation.current)setError('결재 원문을 읽지 못했어요. 다시 선택해 주세요.');}finally{if(epoch===generation.current)setLoading(false);}}
 return <>{local.length>0&&<WorkspaceCatalogTabs label="결재 자료" idPrefix="approval-source" active={mode} onChange={change} items={[...(!desktop?[{key:'portal',label:<><Icon name="clipboardCheck" size={16}/>포털</>}]:[]),...local.map(kind=>({key:'local:'+kind,label:<><Icon name={LOCAL_MAIL_KINDS[kind].icon} size={16}/>{LOCAL_MAIL_KINDS[kind].label}</>}))]}/>}
 {mode==='portal'?(desktop?<p role="status">Knox Desktop에 저장된 결재 문서를 가져오면 여기에 표시돼요.</p>:<PortalApprovalHistory key={String(status?.accountKey||'')+':'+String(status?.identityRevision||'')+':'+String(!!status?.connected)} api={api} onSettings={onSettings}/>):<div className="nubi-mail-history-body"><div className="nubi-mail-history-list"><MailKnowledgeSearch key={mode} api={api} mailbox={mode} query={query} onQuery={setQuery} revision={revision} selectedId={source?.id} onOpen={open} onAskSelected={onAsk} onAskSearch={onAskSearch}/></div><article className="nubi-mail-history-detail" aria-label="결재 본문" aria-busy={loading}>{error&&<p role="alert">{error}</p>}{loading?<p role="status">결재 읽는 중</p>:source?<MailReader source={source} api={api} onAsk={onAsk} onDocument={onDocument}/>:<div className="nubi-mail-reader-empty"><AgentMark size={64} mood="still"/><strong>선택된 항목이 없습니다.</strong><p>목록에서 결재를 선택하세요.</p></div>}</article></div>}</>;
}
