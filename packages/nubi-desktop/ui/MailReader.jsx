import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
import React,{useEffect,useRef,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {WorkspaceAction as ActionButton} from './WorkspaceAction.jsx';
import {MailBody} from './MailBody.jsx';
import {FileKindIcon} from './FileKindIcon.jsx';
import {MailLocalControls} from './MailLocalControls.jsx';
import {MailMatchText,mailDate,mailLocation} from './MailMatchText.jsx';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';
const documentErrors={document_format:'지원되지 않는 문서 형식',document_vision_unavailable:'이미지를 읽을 수 있는 모델이 연결되지 않음',document_empty:'읽을 수 있는 본문 없음',document_limit:'파일을 나누어 열어 주세요. 처리 가능한 크기나 분량을 넘었어요.',document_password:'암호로 보호된 문서',document_timeout:'첨부 읽기 시간 초과',document_reader_busy:'다른 첨부를 읽는 중',document_office_required:'Office에서 읽기 대기',document_office_missing:'Office 또는 PowerShell 실행 확인 필요',document_office_version:'Office 2016 호환 버전 확인 필요',document_office_policy:'Office 읽기 전용 열기 실패',document_office_timeout:'Office 읽기 시간 초과. 열린 문서 확인 필요',document_office_cleanup:'Office의 읽기용 사본 정리 확인 필요',document_office_busy:'Office의 안내 창이나 진행 중인 작업을 확인한 뒤 다시 읽어 주세요.',document_office_read_failed:'Office에서 열기 또는 읽기 확인 필요',mail_source_changed:'원문 변경됨'};
const attachmentStatus=(attachment,reading)=>attachment.contentState==='not_stored'?'저장하지 않은 첨부':reading?'첨부 읽는 중':attachment.contentState==='document_read'?(attachment.originalStored===false?'읽은 내용 보관 / 원본 미보관':attachment.coverage):attachment.contentState==='document_attention'?(documentErrors[attachment.error]||'첨부 읽기 확인 필요'):'첨부 본문 읽기 대기';
const locationOf=match=>({...match?.page?{page:match.page}:{},...match?.slide?{slide:match.slide}:{},...match?.sheet?{sheet:match.sheet}:{}});
export function MailReader({source,api,onDocument,onAsk,onLocalChange}){
 const [downloading,setDownloading]=useState(null),[asking,setAsking]=useState(false),[readingDocuments,setReadingDocuments]=useState([]);
 const alive=useRef(true),observed=useRef(source),documentReads=useRef(new Set()),downloadLock=useRef(false),matchedExcerpt=useRef(null);
 observed.current=source;
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(source?.searchQuery)matchedExcerpt.current?.scrollIntoView({block:'nearest'});},[source]);
 async function openAttachment(mail,attachment,match,searchQuery,attempt=source){
  if(!DESKTOP_FEATURES.mailAttachmentReading)return;
  const key=mail.id+'/'+attachment.id;if(documentReads.current.has(key))return;
  documentReads.current.add(key);setReadingDocuments([...documentReads.current]);
  try{const location=locationOf(match);await onDocument?.(mail.id,attachment.id,{sourceHash:mail.sourceHash,attachmentHash:attachment.sha256,...Object.keys(location).length?{location}:{},query:searchQuery||'',canPresent:()=>alive.current&&attempt===observed.current});}
  catch(error){if(alive.current&&attempt===observed.current)notifyWorkspaceToast(documentErrors[error.message]||(error.message==='document_format'?'미리보기는 지원하지 않지만 원래 파일은 다운로드할 수 있어요.':'첨부 내용을 읽지 못했어요. 원문을 다시 확인해 주세요.'),{error:true});}
  finally{documentReads.current.delete(key);if(alive.current)setReadingDocuments([...documentReads.current]);}
 }
 async function download(kind,attachment){
  if(downloadLock.current||!source)return;downloadLock.current=true;setDownloading(attachment?.id||kind);
  try{
   const result=await api('downloadMail',{id:source.id,expectedSourceHash:source.sourceHash,kind,...attachment?{attachmentId:attachment.id}:{}});
   if(result.saved)notifyWorkspaceToast('파일을 저장했어요.');
   else if(result.previewOnly)notifyWorkspaceToast('화면 미리보기예요. 실제 파일은 저장하지 않았어요.');
  }catch(error){notifyWorkspaceToast(error.message==='mail_source_changed'?'원문이 바뀌었어요. 메일을 다시 선택해 주세요.':error.message==='mail_download_unconfirmed'?'저장한 파일이 원문과 달라 지웠어요. 다시 시도해 주세요.':'파일을 저장하지 못했어요. 다시 시도해 주세요.',{error:true});}
  finally{downloadLock.current=false;if(alive.current)setDownloading(null);}
 }
 async function ask(){
  if(!source||asking)return;setAsking(true);
  try{
   const match=source.match,attachment=DESKTOP_FEATURES.mailAttachmentReading&&match?.kind==='attachment'&&source.mail.attachments.find(item=>item.id===match.attachmentId);
   const location=attachment&&!match.filenameOnly?locationOf(match):{};
   await onAsk?.({id:source.id,sourceHash:source.sourceHash,...attachment?{attachmentId:attachment.id,attachmentHash:attachment.sha256}:{},...Object.keys(location).length?{location}:{}});
  }catch(error){if(alive.current)notifyWorkspaceToast(error.message==='mail_reference_limit'?'메일 근거는 20개까지 연결할 수 있어요. 입력창에서 일부를 제거해 주세요.':error.message==='mail_source_changed'?'원문이 바뀌었어요. 메일을 다시 선택해 주세요.':'메일을 대화에 연결하지 못했어요. 다시 시도해 주세요.',{error:true});}
  finally{if(alive.current)setAsking(false);}
 }
 const sender=source.mail.from?.match(/^\s*"?([^<>]+?)"?\s*<([^<>]+)>\s*$/);
 return <div className="nubi-mail-reader-content">
     <header className="nubi-mail-reader-heading"><h2><MailMatchText text={source.mail.subject||'제목 없음'} query={source.searchQuery}/></h2></header>
     <div className="nubi-mail-reader-envelope">
       <div className="nubi-mail-sender"><strong>{sender?sender[1]:source.mail.from}</strong>{sender&&<span>{sender[2]}</span>}</div>
       <time className="nubi-mail-sent-at" dateTime={source.mail.date||undefined}>{mailDate(source.mail.date,true)}</time>
       {(source.mail.to||source.mail.cc)&&<dl className="nubi-mail-addresses">{source.mail.to&&<div><dt>받는 사람</dt><dd>{source.mail.to}</dd></div>}{source.mail.cc&&<div><dt>참조</dt><dd>{source.mail.cc}</dd></div>}</dl>}
     </div>
     {source.mail.documentKindLabel&&<p className="nubi-muted" title="가져온 폴더 이름 기준">{source.mail.documentKindLabel}</p>}
     {source.local?.tags?.length>0&&<div className="nubi-mail-local-tags">{source.local.tags.map(tag=><span key={tag}><Icon name="tag" size={11}/>{tag}</span>)}</div>}
     <div className="nubi-mail-reader-actions" role="group" aria-label="메일 도구">
       {onAsk&&<CxButton type="button" className="nubi-mail-ask" aria-label={source.mail.sourceType==='approval'?'이 결재로 질문':'이 메일로 질문'} title="이 자료를 대화에 연결해 질문" disabled={asking} onClick={ask}><Icon name="message" size={16}/><span>{asking?'연결 중':'AI에 질문'}</span></CxButton>}
       <div className="nubi-mail-reader-utilities"><MailLocalControls key={source.id} api={api} source={source} onChange={(id,local)=>onLocalChange?.(id,local)}/><ActionButton action="download" label="메일 본문 다운로드" busy={downloading==='body'} disabled={!!downloading} onClick={()=>download('body')}/></div>
     </div>
     {source.searchQuery&&source.match&&<section ref={matchedExcerpt} className="nubi-mail-match" aria-label="검색어가 나온 위치"><span><Icon name={source.match.kind==='attachment'?'file':'search'} size={13}/>{mailLocation(source.match)}</span><p><MailMatchText text={source.match.excerpt} query={source.searchQuery}/></p></section>}
     <MailBody text={source.mail.text} query={source.searchQuery} presentation={source.mail.presentation} inlineImageCount={source.mail.inlineImageCount}/>
     {source.mail.truncated&&<p className="nubi-muted">긴 본문 일부만 표시해요. 본문 다운로드로 전체 내용을 확인할 수 있어요.</p>}
     {source.mail.attachments.length>0&&<section className="nubi-mail-attachments" aria-label="첨부 문서"><h3 title={!DESKTOP_FEATURES.mailAttachmentReading?'Beta에서는 첨부 다운로드만 지원해요.':undefined}><Icon name="file" size={15}/>첨부 {source.mail.attachments.length}개</h3>{source.mail.attachments.map(attachment=>{const reading=readingDocuments.includes(source.id+'/'+attachment.id);return <div key={attachment.id} className="nubi-mail-attachment-row">{!DESKTOP_FEATURES.mailAttachmentReading?<div className="nubi-mail-attachment" title="Beta에서는 다운로드만 지원해요."><FileKindIcon name={attachment.filename} size={20}/><span className="nubi-mail-attachment-label" title={attachment.filename}><strong><MailMatchText text={attachment.filename||'첨부 파일'} query={source.searchQuery}/></strong></span></div>:<CxButton className="nubi-mail-attachment" disabled={reading||attachment.contentState==='not_stored'} aria-busy={reading} onClick={()=>openAttachment(source,attachment)}>{reading?<span role="status" aria-label="첨부 읽는 중" className="status-spinner"/>:<FileKindIcon name={attachment.filename} size={20}/>}<span className="nubi-mail-attachment-label" title={attachment.filename}><strong><MailMatchText text={attachment.filename||'첨부 문서'} query={source.searchQuery}/></strong><small title={attachmentStatus(attachment,reading)}>{attachmentStatus(attachment,reading)}</small></span></CxButton>}<ActionButton action="download" label={`${attachment.filename||'첨부 문서'} 다운로드`} busy={downloading===attachment.id} disabled={!!downloading||attachment.contentState==='not_stored'||attachment.originalStored===false} onClick={()=>download('attachment',attachment)}/></div>;})}</section>}
     <details className="nubi-mail-original"><summary><Icon name="mail" size={14}/>{source.mail.storage?.mode==='body_only'?'첨부 제외 사본':source.mail.sourceType==='approval'?'원본 결재':'원본 메일'}</summary><div><span>{source.mail.sourceFilename||'메일 앱에서 열 수 있는 .eml 파일'}</span><ActionButton action="download" label="원본 메일 다운로드" busy={downloading==='raw'} disabled={!!downloading} onClick={()=>download('raw')}/></div><pre className="nubi-mail-reader-text nubi-mail-raw-text">{source.mail.text}</pre></details>
 </div>;
}
