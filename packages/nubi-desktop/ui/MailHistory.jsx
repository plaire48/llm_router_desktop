import React,{useEffect,useRef,useState} from 'react';
import {CxButton,ActionButton,Icon} from '@e2e/cx-design-system';
import {DeckEmpty} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {MailLocalControls} from './MailLocalControls.jsx';
import {MailKnowledgeSearch} from './MailKnowledgeSearch.jsx';
import {MailMatchText,mailDate,mailLocation} from './MailMatchText.jsx';
import {MailTimestamp} from './MailTimestamp.jsx';
import {ResponseTime} from './ResponseTime.jsx';
import {durationLabel} from '../runtime/response-timing.mjs';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';

const documentErrors={document_format:'지원되지 않는 문서 형식',document_empty:'읽을 수 있는 본문 없음',document_limit:'문서 크기 또는 분량 초과',document_password:'암호로 보호된 문서',document_timeout:'첨부 읽기 시간 초과',document_reader_busy:'다른 첨부를 읽는 중',document_office_required:'Office에서 읽기 대기',document_office_missing:'Office 또는 PowerShell 실행 확인 필요',document_office_version:'Office 2016 호환 버전 확인 필요',document_office_policy:'회사 Office 실행 정책 확인 필요',document_office_timeout:'Office 읽기 시간 초과. 열린 문서 확인 필요',document_office_cleanup:'Office의 읽기용 사본 정리 확인 필요',document_office_read_failed:'Office에서 열기 또는 읽기 확인 필요',mail_source_changed:'원문 변경됨'};
const locationOf=match=>({...match?.page?{page:match.page}:{},...match?.slide?{slide:match.slide}:{},...match?.sheet?{sheet:match.sheet}:{}});
export function MailHistory({api,onDocument,onAsk,onSettings,connectionRef,sourceTarget,onReturn}){
 const [status,setStatus]=useState(null),[refreshing,setRefreshing]=useState(false),[searchRevision,setSearchRevision]=useState(0);
 const [page,setPage]=useState({messages:[],total:0}),[query,setQuery]=useState(''),[source,setSource]=useState(null),[loading,setLoading]=useState(false),[downloading,setDownloading]=useState(null),[asking,setAsking]=useState(false);
 const [readingDocuments,setReadingDocuments]=useState([]),documentReads=useRef(new Set());
 const alive=useRef(true),epoch=useRef(0),selection=useRef(0),downloadLock=useRef(false),matchedExcerpt=useRef(null);
 useEffect(()=>{alive.current=true;let pending=false;async function refresh(){if(pending)return;pending=true;const attempt=++epoch.current;try{const [value,current]=await Promise.all([api('mail',{action:'history'}),api('mail',{action:'status'})]);if(alive.current&&attempt===epoch.current){setPage(value);setStatus(current);}}catch{if(alive.current)notifyWorkspaceToast('메일 이력을 읽지 못했어요. 연결 상태를 확인해 주세요.',{error:true});}finally{pending=false;}}void refresh();const timer=setInterval(refresh,3000);return()=>{alive.current=false;epoch.current++;selection.current++;clearInterval(timer);};},[api]);
 useEffect(()=>{if(!sourceTarget)return;let live=true;const attempt=++selection.current;let observed=attempt;void (async()=>{try{await api('mail',{action:'evidence',...sourceTarget});if(!live||attempt!==selection.current)return;const opened=await open(sourceTarget.id,sourceTarget.sourceHash);observed=selection.current;if(opened&&sourceTarget.attachmentId&&live)await onDocument?.(sourceTarget.id,sourceTarget.attachmentId,{...sourceTarget,canPresent:()=>live&&alive.current&&observed===selection.current});}catch{if(live&&observed===selection.current)notifyWorkspaceToast('원문이 바뀌었거나 읽을 수 없어요.',{error:true});}})();return()=>{live=false;};},[sourceTarget?.key]);
 useEffect(()=>{if(source?.searchQuery)matchedExcerpt.current?.scrollIntoView({block:'nearest'});},[source]);
 async function open(id,expectedHash,context={}){
  const attempt=++selection.current;setLoading(true);
  try{
   const value=await api('mail',{action:'read',id});if(expectedHash&&value.sourceHash!==expectedHash)throw Error('mail_source_changed');
   if(!alive.current||attempt!==selection.current)return false;
   setSource({...value,match:context.match,searchQuery:context.query||''});
   const attachment=context.match?.kind==='attachment'&&value.mail.attachments.find(item=>item.id===context.match.attachmentId);
   if(attachment&&['document_read','text_read'].includes(attachment.contentState)&&!context.match.filenameOnly)await openAttachment(value,attachment,context.match,context.query,attempt);
   return alive.current&&attempt===selection.current;
  }catch{if(alive.current&&attempt===selection.current)notifyWorkspaceToast('원문이 바뀌었거나 읽을 수 없어요.',{error:true});return false;}
  finally{if(alive.current&&attempt===selection.current)setLoading(false);}
 }
 async function openAttachment(mail,attachment,match,searchQuery,attempt=selection.current){
  const key=mail.id+'/'+attachment.id;if(documentReads.current.has(key))return;
  documentReads.current.add(key);setReadingDocuments([...documentReads.current]);
  try{const location=locationOf(match);await onDocument?.(mail.id,attachment.id,{sourceHash:mail.sourceHash,attachmentHash:attachment.sha256,...Object.keys(location).length?{location}:{},query:searchQuery||'',canPresent:()=>alive.current&&attempt===selection.current});}
  catch(error){if(alive.current&&attempt===selection.current)notifyWorkspaceToast(documentErrors[error.message]||(error.message==='document_format'?'미리보기는 지원하지 않지만 원래 파일은 다운로드할 수 있어요.':'첨부 내용을 읽지 못했어요. 원문을 다시 확인해 주세요.'),{error:true});}
  finally{documentReads.current.delete(key);if(alive.current)setReadingDocuments([...documentReads.current]);}
 }
 async function download(kind,attachment){
  if(downloadLock.current||!source)return;downloadLock.current=true;setDownloading(attachment?.id||kind);
  try{
   const result=await api('downloadMail',{id:source.id,expectedSourceHash:source.sourceHash,kind,...attachment?{attachmentId:attachment.id}:{}});
   if(result.saved)notifyWorkspaceToast('파일을 저장했어요.');
   else if(result.previewOnly)notifyWorkspaceToast('화면 미리보기예요. 실제 파일은 저장하지 않았어요.');
  }catch(error){notifyWorkspaceToast(error.message==='mail_source_changed'?'원문이 바뀌었어요. 메일을 다시 선택해 주세요.':error.message==='mail_download_unconfirmed'?'저장한 파일을 확인하지 못했어요. 저장 위치를 확인해 주세요.':'파일을 저장하지 못했어요. 다시 시도해 주세요.',{error:true});}
  finally{downloadLock.current=false;if(alive.current)setDownloading(null);}
 }
 async function ask(){
  if(!source||asking)return;setAsking(true);
  try{
   const match=source.match,attachment=match?.kind==='attachment'&&source.mail.attachments.find(item=>item.id===match.attachmentId);
   const location=attachment&&!match.filenameOnly?locationOf(match):{};
   await onAsk?.({id:source.id,sourceHash:source.sourceHash,...attachment?{attachmentId:attachment.id,attachmentHash:attachment.sha256}:{},...Object.keys(location).length?{location}:{}});
  }catch(error){if(alive.current)notifyWorkspaceToast(error.message==='mail_reference_limit'?'메일 근거는 20개까지 연결할 수 있어요. 입력창에서 일부를 제거해 주세요.':error.message==='mail_source_changed'?'원문이 바뀌었어요. 메일을 다시 선택해 주세요.':'메일을 대화에 연결하지 못했어요. 다시 시도해 주세요.',{error:true});}
  finally{if(alive.current)setAsking(false);}
 }
 async function reload(){
  if(refreshing)return;setRefreshing(true);
  try{
   let current=await api('mail',{action:'status'});
   if(current.connected&&current.autoWiki&&!current.checking&&!current.connecting){
    if(!current.nextCheckAt||Date.now()>=Date.parse(current.nextCheckAt))current=await api('mail',{action:'check'});
    else notifyWorkspaceToast(`다음 메일 확인은 ${new Date(current.nextCheckAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}이에요.`);
   }
   const value=await api('mail',{action:'history'});if(alive.current){setStatus(current);setPage(value);setSearchRevision(value=>value+1);}
  }catch(error){if(alive.current)notifyWorkspaceToast(error.message==='mail_check_wait'?'서버 확인 대기 시간이 남아 있어요. 다음 확인 시각에 자동으로 가져옵니다.':'메일을 다시 확인하지 못했어요. 연결 상태를 확인해 주세요.',{error:true});}
  finally{if(alive.current)setRefreshing(false);}
 }
 const checkedAt=status?.progress?.checkedAt||status?.lastCheckedAt;
 const revision=JSON.stringify([searchRevision,page.total,page.messages.map(row=>[row.id,row.state,row.attachmentState])]);
 return <section className="nubi-mail-history" data-selected={!!source} aria-label="메일 이력">
  <header className="nubi-mail-history-bar">{onReturn&&<ActionButton action="back" label="대화로 돌아가기" onClick={onReturn}/>}<Icon name="mail" size={22}/><h1>메일</h1><span>{page.total}개</span><div className="nubi-mail-history-asof"><MailTimestamp at={status?.progress?.lastAppliedAt}/><MailTimestamp at={checkedAt} label="서버 확인"/></div><ActionButton action="refresh" label="메일 다시 확인" disabled={refreshing||status?.checking||status?.connecting} onClick={reload}/>{(refreshing||status?.checking)&&<span className="status-spinner" role="status" aria-label="메일 확인 중"/>}<CxButton ref={connectionRef} className="nubi-mail-connect-link" onClick={onSettings}><Icon name="mail" size={18}/><span>메일 연결</span></CxButton></header>
  <div className="nubi-mail-history-body">
   <div className="nubi-mail-history-list"><MailKnowledgeSearch api={api} query={query} onQuery={setQuery} lastAppliedAt={status?.progress?.lastAppliedAt} revision={revision} selectedId={source?.id} onOpen={open}/></div>
   <article className="nubi-mail-history-detail" aria-label="메일 본문" aria-busy={loading}>
    {loading?<p role="status">메일 읽는 중</p>:source?<>
     <header className="nubi-mail-reader-heading"><h2><MailMatchText text={source.mail.subject||'제목 없음'} query={source.searchQuery}/></h2><MailLocalControls key={source.id} api={api} source={source} onChange={(id,local)=>{if(!alive.current)return;setSource(current=>current?.id===id?{...current,local}:current);setSearchRevision(value=>value+1);}}/><ActionButton action="download" label="메일 본문 다운로드" busy={downloading==='body'} disabled={!!downloading} onClick={()=>download('body')}/></header>
     <div className="nubi-mail-reader-meta"><span>{source.mail.from}</span><time dateTime={source.mail.date||undefined}>{mailDate(source.mail.date,true)}</time></div>
     <>{source.local?.tags?.length>0&&<div className="nubi-mail-local-tags">{source.local.tags.map(tag=><span key={tag}><Icon name="tag" size={11}/>{tag}</span>)}</div>}</><ResponseTime timing={source.summaryTiming} label={source.summaryTiming?.kind==='saving'?'저장':'정리'}/>
     {onAsk&&<CxButton type="button" className="nubi-mail-ask" disabled={asking} onClick={ask}><Icon name="message" size={16}/><span>{asking?'연결 중':'이 메일로 질문'}</span></CxButton>}
     {source.searchQuery&&source.match&&<section ref={matchedExcerpt} className="nubi-mail-match" aria-label="검색어가 나온 위치"><span><Icon name={source.match.kind==='attachment'?'file':'search'} size={13}/>{mailLocation(source.match)}</span><p><MailMatchText text={source.match.excerpt} query={source.searchQuery}/></p></section>}
     <pre className="nubi-mail-reader-text"><MailMatchText text={source.mail.text} query={source.searchQuery}/></pre>
     {source.mail.truncated&&<p className="nubi-muted">긴 본문 일부만 표시해요. 본문 다운로드로 전체 내용을 확인할 수 있어요.</p>}
     {source.mail.attachments.length>0&&<section className="nubi-mail-attachments" aria-label="첨부 문서"><h3><Icon name="file" size={15}/>첨부 {source.mail.attachments.length}개</h3>{source.mail.attachments.map(attachment=>{const reading=readingDocuments.includes(source.id+'/'+attachment.id);return <div key={attachment.id} className="nubi-mail-attachment-row"><CxButton className="nubi-mail-attachment" disabled={reading} aria-busy={reading} onClick={()=>openAttachment(source,attachment)}>{reading?<span role="status" aria-label="첨부 읽는 중" className="status-spinner"/>:<Icon name="file" size={17}/>}<span><strong><MailMatchText text={attachment.filename||'첨부 문서'} query={source.searchQuery}/></strong><small>{reading?'첨부 읽는 중':attachment.contentState==='document_read'?attachment.coverage:attachment.contentState==='document_attention'?(documentErrors[attachment.error]||'미리보기 확인 필요'):'첨부 본문 읽기 대기'}</small></span></CxButton><ActionButton action="download" label={`${attachment.filename||'첨부 문서'} 다운로드`} busy={downloading===attachment.id} disabled={!!downloading} onClick={()=>download('attachment',attachment)}/></div>;})}</section>}
     <details className="nubi-mail-original"><summary><Icon name="mail" size={14}/>원본 메일</summary><div><span>메일 앱에서 열 수 있는 .eml 파일</span><ActionButton action="download" label="원본 메일 다운로드" busy={downloading==='raw'} disabled={!!downloading} onClick={()=>download('raw')}/></div></details>
    </>:<DeckEmpty title="메일을 선택해 주세요" description="본문과 첨부를 확인하고 다운로드할 수 있어요."/>}
   </article>
  </div>
  {status?.recentChecks?.length>0&&<details className="nubi-mail-recent"><summary><Icon name="clock" size={14}/>최근 처리 기록</summary><ol>{status.recentChecks.map((record,index)=><li key={`${record.at}:${index}`}><time dateTime={record.at}>{new Date(record.at).toLocaleString()}</time><span>{record.kind==='organized'?`정리 완료 ${record.completed}개${durationLabel(record.durationMs)?` / ${durationLabel(record.durationMs)}`:''}`:record.kind==='error'?'서버 연결 확인 필요':`수신 ${record.received}개${record.pendingServer===null?'':` / 남음 ${record.pendingServer}개`}${record.attention?` / 확인 필요 ${record.attention}개`:''}`}</span></li>)}</ol></details>}
 </section>;
}
