import React,{useRef,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {MailBody} from './MailBody.jsx';
import {FileKindIcon} from './FileKindIcon.jsx';
import {WorkspaceAction} from './WorkspaceAction.jsx';
import {mailDate} from './MailMatchText.jsx';

// Only real MIME child files belong in the list. Never synthesize a body file.
export function MimeMailPreview({document,onDownloadAttachment,actions,source,onToggleSource,rangeControl}){
  const mail=document.mailMessage,[downloading,setDownloading]=useState(null),[notice,setNotice]=useState(''),lock=useRef(false);
  async function download(part){
    if(lock.current||!onDownloadAttachment)return;lock.current=true;setDownloading(part.id);setNotice('');
    try{const result=await onDownloadAttachment(part);if(result?.saved)setNotice('파일을 저장했어요.');}
    catch(error){setNotice(error.message==='mail_source_changed'?'첨부 원문이 바뀌었어요. 메일을 다시 열어 주세요.':'파일을 저장하지 못했어요. 다시 시도해 주세요.');}
    finally{lock.current=false;setDownloading(null);}
  }
  const sender=mail.from?.match(/^\s*"?([^<>]+?)"?\s*<([^<>]+)>\s*$/);
  return <article className="nubi-mail-reader-content" aria-label="첨부 메일">
    <header className="nubi-mail-reader-heading"><h2>{mail.subject||'제목 없음'}</h2></header>
    <div className="nubi-mail-reader-envelope"><div className="nubi-mail-sender"><strong>{sender?sender[1]:mail.from}</strong>{sender&&<span>{sender[2]}</span>}</div>{mail.date&&<time className="nubi-mail-sent-at" dateTime={mail.date}>{mailDate(mail.date,true)}</time>}
      {(mail.to||mail.cc)&&<dl className="nubi-mail-addresses">{mail.to&&<div><dt>받는 사람</dt><dd>{mail.to}</dd></div>}{mail.cc&&<div><dt>참조</dt><dd>{mail.cc}</dd></div>}</dl>}
    </div>
    <div className="nubi-mail-reader-actions" role="group" aria-label="첨부 메일 도구">
      {actions?.onAsk&&<CxButton className="nubi-mail-ask" disabled={actions.askDisabled} onClick={actions.onAsk} title="이 메일 본문을 대화에 연결해 질문"><Icon name="message" size={16}/><span>AI에 질문</span></CxButton>}
      <div className="nubi-mail-reader-utilities">
        {onToggleSource&&<CxButton className="nubi-utility-action" aria-label={source?'문서 보기':'추출 텍스트 보기'} title={source?'메일 보기':'추출 텍스트 보기'} aria-pressed={!!source} onClick={onToggleSource}><Icon name={source?'eye':'code'} size={16}/></CxButton>}
        {actions?.onDownloadOriginal&&<WorkspaceAction action="download" label="첨부 원본 다운로드" title={`${document.title||'첨부 메일'} 원본 다운로드`} busy={actions.downloadBusy} onClick={actions.onDownloadOriginal}/>}
      </div>
    </div>
    {rangeControl}
    {source?<pre className="nubi-document-source">{document.text}</pre>:<MailBody text={document.text} presentation={document.partial?undefined:mail.presentation} title="첨부 메일 본문"/>}
    {mail.attachments.length>0&&<section className="nubi-mail-attachments" aria-label="내부 첨부 파일"><h3><Icon name="file" size={15}/>첨부 {mail.attachments.length}개</h3>{mail.attachments.map(part=><div key={part.id} className="nubi-mail-attachment-row"><div className="nubi-mail-attachment"><FileKindIcon name={part.filename} size={20}/><span className="nubi-mail-attachment-label" title={part.filename}><strong>{part.filename||'첨부 파일'}</strong></span></div>{onDownloadAttachment&&<WorkspaceAction action="download" label={`${part.filename||'첨부 파일'} 다운로드`} busy={downloading===part.id} disabled={downloading!==null} onClick={()=>download(part)}/>}</div>)}</section>}
    {mail.attachments.length>0&&<p className="nubi-mail-reading-note">내부 파일 내용은 아직 읽지 않았어요.</p>}
    {notice&&<p role="status" className="nubi-mail-reading-note">{notice}</p>}
  </article>;
}
