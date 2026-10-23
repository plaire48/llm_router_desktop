import {ResponseTime} from './ResponseTime.jsx';
import {MailTimestamp} from './MailTimestamp.jsx';
import {WikiInitializationProgress} from './WikiInitializationProgress.jsx';
import {MailBackground} from './MailBackground.jsx';
import {WorkspaceOperationStatus} from './WorkspaceOperationStatus.jsx';
import React,{useEffect,useRef,useState} from 'react';
import {Icon} from '@e2e/cx-design-system';
const stages={indexing:'메일 검색 준비 중',indexed:'메일 검색 준비 완료',ready:'정리 완료',connecting:'메일 연결 중',disconnected:'메일 연결 필요',off:'자동 정리 꺼짐',checking:'새 메일 확인 중',attachments:'첨부 읽는 중',organizing:'메일 정리 중',waiting_model:'모델 연결 대기',waiting_agent:'현재 작업 후 정리',queued:'정리 대기',paused:'수집 일시중지',attention:'확인 필요',watching:'새 메일 확인 대기'};
const active=new Set(['connecting','checking','attachments','organizing','indexing']);
export function MailProgress({api,wiki,activity,onSettings,onOpenMessage}){
  const [status,setStatus]=useState(null),[unavailable,setUnavailable]=useState(false);
  const [open,setOpen]=useState(false),trigger=useRef(null);
  useEffect(()=>{
    if(open)return; // The open panel owns its status and list snapshot.
    let alive=true,pending=false;
    async function refresh(){
      if(pending)return;pending=true;
      try{const value=await api('mail',{action:'status',includeMessages:false});if(alive){setStatus(value);setUnavailable(false);}}
      catch{if(alive)setUnavailable(true);}
      finally{pending=false;}
    }
    void refresh();const timer=setInterval(refresh,3000);
    const unsubscribe=window.nubi?.onHostEvent?.(event=>{if(['mail_pop3_connected','mail_portal_connected'].includes(event.type))void refresh();});
    return()=>{alive=false;clearInterval(timer);unsubscribe?.();};
  },[api,open]);
  const showMail=!!status&&(status.connected||status.connecting||status.counts?.received>0||status.error&&status.error!=='mail_cancelled'||open),showWiki=wiki?.state==='running';
  if(!showMail&&!showWiki&&!activity)return null;
  if(!showMail)return <footer className="desktop-mail-progress" tabIndex={0} aria-label="작업 상태"><WorkspaceOperationStatus activity={activity}/>{showWiki&&<WikiInitializationProgress job={wiki} inline/>}</footer>;
  const progress=status.progress||{stage:status.connecting?'connecting':!status.connected&&!status.localCount?'disconnected':!status.autoWiki?'off':status.checking?'checking':status.readingAttachments?'attachments':status.summarizing?'organizing':status.error?'attention':status.watchPaused?'paused':'watching',completed:status.counts?.saved||0,remaining:null,queued:status.counts?.queued||0,attention:status.counts?.attentionTotal??((status.counts?.attention||0)+(status.counts?.attachmentAttention||0))};
  // Current controls take precedence over a processing snapshot from before
  // stopping. Collection pause is distinct from turning auto organization off.
  const stage=unavailable?'attention':status.connecting?'connecting':!status.connected&&!status.localCount?'disconnected':!status.autoWiki?'off':progress.stage;
  const background=status.connected&&status.autoWiki&&!status.watchPaused&&!unavailable;
  const stopped=['off','disconnected','paused'].includes(stage);
  const pending=stopped?progress.queued:progress.remaining??progress.queued;
  const showCounts=progress.completed>0||progress.indexed>0||pending>0||progress.attention>0;
  const next=status.connected&&status.autoWiki&&!status.watchPaused&&status.nextCheckAt&&!active.has(stage)?new Date(status.nextCheckAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'}):null;
  return <><footer className="desktop-mail-progress" tabIndex={0} aria-label="작업 상태">
    <WorkspaceOperationStatus activity={activity}/>
    {showWiki&&<WikiInitializationProgress job={wiki} inline/>}
    <button ref={trigger} type="button" className="nubi-mail-progress-state nubi-mail-progress-open" aria-label="메일 처리 상태 확인" title="확인 필요한 메일과 조치 보기" aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{active.has(stage)||(background&&stage==='watching')?<span className={`status-spinner${stage==='watching'?' nubi-mail-watching-spinner':''}`} aria-hidden="true"/>:<Icon name={stage==='attention'?'alertCircle':'mail'} size={14}/>}<strong>{unavailable?'상태 확인 중':stages[stage]||'메일 처리 중'}</strong></button>
    {showCounts&&<span className="nubi-mail-progress-counts">{progress.indexed>0&&<span>검색 가능 <b>{progress.indexed}</b></span>}{progress.completed>0&&<span>완료 <b>{progress.completed}</b></span>}{pending>0&&<span>{stopped?'보류':progress.remaining==null?'정리 대기':'남음'} <b>{pending}</b></span>}{progress.attention>0&&<span>확인 필요 <b>{progress.attention}</b></span>}</span>}
    {!stopped&&progress.timing&&<ResponseTime timing={progress.timing} label={progress.timing.kind==='saving'?'저장':'정리'} live/>}
    {!stopped&&progress.attachment&&<span className="nubi-mail-progress-attachment">첨부 {progress.attachment.completed}/{progress.attachment.total}</span>}
    <MailTimestamp at={progress.lastAppliedAt}/>
    {next&&<span className="nubi-mail-progress-next">다음 확인 {next}</span>}
  </footer>{open&&<MailBackground api={api} status={status} onStatus={setStatus} onClose={()=>{setOpen(false);requestAnimationFrame(()=>trigger.current?.focus({preventScroll:true}));}} onSettings={()=>{setOpen(false);onSettings?.();}} onOpenMessage={onOpenMessage&&(source=>{setOpen(false);onOpenMessage(source);})}/>}</>;
}
