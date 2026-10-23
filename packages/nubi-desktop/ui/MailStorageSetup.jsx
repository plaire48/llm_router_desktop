import {TaskProgressBar} from './TaskProgressBar.jsx';
import React,{useEffect,useRef,useState} from 'react';
import {CxButton,DetailPanel,Icon} from '@e2e/cx-design-system';
import {durationLabel} from '../runtime/response-timing.mjs';
import './mail-storage-setup.css';
import {FolderMark} from './marks.jsx';
import {MailAttachmentStorageOption} from './MailAttachmentStorageOption.jsx';
import {isDesktopUia} from './mailbox-navigation.mjs';
import {useBackgroundOperation} from './background-modal.jsx';

const errors={mail_encryption_key_lost:'이 PC 계정의 메일 암호화 키를 찾지 못했어요. 원문은 원래 계정에서만 옮길 수 있어요.',mail_encryption_unavailable:'암호화 키를 열지 못해 원문을 옮기지 않았어요. 기존 계정으로 앱을 다시 열어 주세요.',mail_encryption_integrity:'원문 암호화를 확인하지 못했어요. 기존 파일은 유지됩니다.',mail_storage_full:'저장 공간이 부족해요. 기존 위치는 유지됩니다.',mail_storage_failed:'파일을 옮기지 못했어요. 기존 위치는 유지됩니다.',mail_busy:'메일 작업이 끝난 뒤 다시 선택해 주세요.',mail_storage_not_empty:'비어 있는 폴더를 선택해 주세요.',mail_storage_nested:'현재 원본 폴더와 겹치지 않는 위치를 선택해 주세요.',mail_storage_permission:'이 폴더에 저장할 권한이 없어요. 다른 위치를 선택해 주세요.',ENOSPC:'저장 공간이 부족해요. 다른 위치를 선택해 주세요.'};
export function MailStorageSetup({api,status,onClose,onDone}){
 const background=useBackgroundOperation({title:'메일 저장 위치 변경',risk:'위치 이동 중에는 앱을 종료하지 마세요. 기존 원문은 확인 후 정리해요.'});
 const desktop=isDesktopUia(status);
 const [progress,setProgress]=useState(null);
 const [includeAttachments,setIncludeAttachments]=useState(status.includeAttachments!==false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(null),[elapsed,setElapsed]=useState(0),lock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(!busy)return;const start=Date.now();setElapsed(0);const timer=setInterval(()=>setElapsed(Date.now()-start),1000);return()=>clearInterval(timer);},[busy]);
 useEffect(()=>{
  if(!busy)return;let disposed=false,pending=false;
  const refresh=async()=>{if(pending)return;pending=true;try{const value=await api('mail',{action:'storageProgress'});if(!disposed&&value?.moving)setProgress(value.progress);}catch{}finally{pending=false;}};
  void refresh();const timer=setInterval(refresh,400);return()=>{disposed=true;clearInterval(timer);};
 },[busy,api]);
 const stages={scanning:'이동할 파일 확인 중',copying:'파일 복사와 확인 중',committing:'저장 위치 적용 중',cleaning:'이전 위치 정리 중',recovering:'기존 위치 유지 중'};
 const progressLabel=stages[progress?.stage]||'저장 위치 적용 중';
 const percent=progress?.stage==='copying'&&progress.totalBytes>0?Math.floor(progress.bytes/progress.totalBytes*100):progress?.stage==='cleaning'&&progress.total>0?Math.floor(progress.completed/progress.total*100):undefined;
 async function choose(current=false){
  if(lock.current)return;lock.current=true;setProgress(null);setBusy(true);setError(null);
  try{
   const value=await background.run(()=>current?api('mail',{action:'confirmStorage',includeAttachments}):api('chooseMailRawRoot',{includeAttachments}));
   if(alive.current&&!value?.cancelled)onDone(value);
  }catch(cause){if(alive.current)setError(errors[cause.message]||'저장 위치를 적용하지 못했어요. 기존 원문은 유지됩니다.');}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 return <DetailPanel className="deck-dialog nubi-panel nubi-mail-storage-setup" title={<span className="nubi-panel-title"><span className="nubi-panel-title-icon"><FolderMark size={18}/></span>메일 보관 설정</span>} variant="modal" hideHelp busy={busy} onClose={busy?undefined:onClose} footer={<>
  <CxButton disabled={busy} onClick={()=>void choose(true)}>현재 위치 사용</CxButton>
  <CxButton variant="primary" disabled={busy} onClick={()=>void choose()}><FolderMark size={16}/>폴더 선택</CxButton>
 </>}>
  <div className="nubi-mail-storage-content">
   <p className="nubi-mail-storage-intro">여유 공간이 있는 폴더를 선택해 주세요.</p>
   <div className="nubi-mail-storage-location"><FolderMark size={18}/><div><strong>원문 저장 위치</strong><span title={status.rawRoot}>{status.rawRoot}</span></div></div>
   <div className="nubi-mail-storage-policy">
    <div className="nubi-mail-collection-evidence"><Icon name="check" size={18}/><div><strong>{desktop?'화면에서 읽은 원문 보관':'본문과 첨부 내용'}</strong><small>{desktop?'UIA로 읽은 본문과 메타데이터를 암호화해 보관해요. 첨부 원본은 포함하지 않아요.':'보관 여부와 관계없이 위키에 활용해요.'}</small></div></div>
    {!desktop&&<MailAttachmentStorageOption checked={includeAttachments} disabled={busy} onChange={setIncludeAttachments}/>}
   </div>
   {!busy&&<small className="nubi-mail-storage-note"><Icon name="infoCircle" size={16}/><span>새 메일부터 적용해요.{status.counts?.received>0?' 위치를 바꾸면 기존 파일도 옮겨요.':' 선택한 위치에 메일 전용 폴더를 만들어요.'}</span></small>}
  </div>
  {busy&&<section className="nubi-mail-storage-progress" aria-label="저장 위치 이동 진행">
   <div role="status"><span className="status-spinner"/><strong>{progressLabel}</strong><time>{durationLabel(elapsed,{keepSeconds:true})}</time></div>
   <TaskProgressBar backgroundTask={background.id} label={progressLabel} value={percent} estimate={{identity:progress?.stage,completed:progress?.stage==='copying'?progress.bytes:progress?.completed,total:progress?.stage==='copying'?progress.totalBytes:progress?.total}}/>
   <small className="nubi-mail-storage-count">{Number.isFinite(percent)?<><strong>{percent}%</strong><span>{progress.completed.toLocaleString()} / {progress.total.toLocaleString()}개 처리</span></>:progress?.stage==='scanning'?`${(progress.discovered||0).toLocaleString()}개 파일 확인`:'기존 메일은 안전하게 유지됩니다.'}</small>
  </section>}
  {error&&<p role="alert">{error}</p>}
 </DetailPanel>;
}
