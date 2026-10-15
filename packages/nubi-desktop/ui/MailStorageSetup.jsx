import {TaskProgressBar} from './TaskProgressBar.jsx';
import React,{useEffect,useRef,useState} from 'react';
import {CxButton,CxCheckbox,DetailPanel} from '@e2e/cx-design-system';
import {durationLabel} from '../runtime/response-timing.mjs';
import './mail-storage-setup.css';
import {FolderMark} from './marks.jsx';

const errors={mail_storage_full:'저장 공간이 부족해요. 기존 위치는 유지됩니다.',mail_storage_failed:'파일을 옮기지 못했어요. 기존 위치는 유지됩니다.',mail_busy:'메일 작업이 끝난 뒤 다시 선택해 주세요.',mail_storage_not_empty:'비어 있는 폴더를 선택해 주세요.',mail_storage_nested:'현재 원본 폴더와 겹치지 않는 위치를 선택해 주세요.',mail_storage_permission:'이 폴더에 저장할 권한이 없어요. 다른 위치를 선택해 주세요.',ENOSPC:'저장 공간이 부족해요. 다른 위치를 선택해 주세요.'};
export function MailStorageSetup({api,status,onClose,onDone}){
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
   const value=await (current?api('mail',{action:'confirmStorage',includeAttachments}):api('chooseMailRawRoot',{includeAttachments}));
   if(alive.current&&!value?.cancelled)onDone(value);
  }catch(cause){if(alive.current)setError(errors[cause.message]||'저장 위치를 적용하지 못했어요. 기존 원문은 유지됩니다.');}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 return <DetailPanel className="deck-dialog nubi-panel nubi-mail-storage-setup" title={<span className="nubi-mail-storage-title"><FolderMark size={18}/>메일 저장 위치</span>} variant="modal" hideHelp busy={busy} onClose={busy?undefined:onClose} footer={<>
  <CxButton disabled={busy} onClick={()=>void choose(true)}>현재 위치 사용</CxButton>
  <CxButton variant="primary" disabled={busy} onClick={()=>void choose()}><FolderMark size={16}/>폴더 선택</CxButton>
 </>}>
  <p className="nubi-mail-storage-intro">메일 원문과 첨부파일은 <strong>저장 공간을 많이 사용할 수 있어요.</strong></p>
  <p className="nubi-mail-storage-hint">여유 공간이 있는 폴더를 정하면 메일을 가져와요.</p>
  <div className="nubi-mail-storage-location"><FolderMark size={18}/><div><strong>현재 저장 위치</strong><span title={status.rawRoot}>{status.rawRoot}</span></div></div>
  <div className="nubi-mail-storage-option"><CxCheckbox label="첨부파일도 저장" checked={includeAttachments} disabled={busy} onChange={event=>setIncludeAttachments(event.target.checked)}/><small>{includeAttachments?'첨부 문서까지 보관해 AI에 물어볼 수 있어요.':'본문과 본문 이미지를 보관해요. 첨부 문서는 저장하지 않아요.'}</small></div>
  {!busy&&<small className="nubi-mail-storage-note">새 메일부터 적용하며 기존 파일은 유지해요.{status.counts?.received>0?' 폴더를 바꾸면 기존 파일도 옮겨요.':' 선택한 위치에 메일 전용 폴더를 만들어요.'}</small>}
  {busy&&<section className="nubi-mail-storage-progress" aria-label="저장 위치 이동 진행">
   <div role="status"><span className="status-spinner"/><strong>{progressLabel}</strong><time>{durationLabel(elapsed,{keepSeconds:true})}</time></div>
   <TaskProgressBar label={progressLabel} value={percent}/>
   <small className="nubi-mail-storage-count">{Number.isFinite(percent)?<><strong>{percent}%</strong><span>{progress.completed.toLocaleString()} / {progress.total.toLocaleString()}개 처리</span></>:progress?.stage==='scanning'?`${(progress.discovered||0).toLocaleString()}개 파일 확인`:'기존 메일은 안전하게 유지됩니다.'}</small>
  </section>}
  {error&&<p role="alert">{error}</p>}
 </DetailPanel>;
}
