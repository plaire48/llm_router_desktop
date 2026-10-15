import React,{useEffect,useRef,useState} from 'react';
import {CxButton,DetailPanel} from '@e2e/cx-design-system';
import {durationLabel} from '../runtime/response-timing.mjs';
import './mail-storage-setup.css';
import {FolderMark} from './marks.jsx';

const errors={mail_busy:'메일 작업이 끝난 뒤 다시 선택해 주세요.',mail_storage_not_empty:'비어 있는 폴더를 선택해 주세요.',mail_storage_nested:'현재 원본 폴더와 겹치지 않는 위치를 선택해 주세요.',mail_storage_permission:'이 폴더에 저장할 권한이 없어요. 다른 위치를 선택해 주세요.',ENOSPC:'저장 공간이 부족해요. 다른 위치를 선택해 주세요.'};
export function MailStorageSetup({api,status,onClose,onDone}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(null),[elapsed,setElapsed]=useState(0),lock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(!busy)return;const start=Date.now();setElapsed(0);const timer=setInterval(()=>setElapsed(Date.now()-start),1000);return()=>clearInterval(timer);},[busy]);
 async function choose(current=false){
  if(lock.current)return;lock.current=true;setBusy(true);setError(null);
  try{
   const value=await (current?api('mail',{action:'confirmStorage'}):api('chooseMailRawRoot'));
   if(alive.current&&!value?.cancelled)onDone(value);
  }catch(cause){if(alive.current)setError(errors[cause.message]||'저장 위치를 적용하지 못했어요. 기존 원문은 유지됩니다.');}
  finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 return <DetailPanel title={<span className="deck-dialog nubi-mail-storage-title"><FolderMark size={18}/>메일 저장 위치</span>} variant="modal" className="deck-dialog nubi-panel nubi-mail-storage-setup" hideHelp onClose={busy?undefined:onClose} footer={<>
  <CxButton disabled={busy} onClick={()=>void choose(true)}>현재 위치 사용</CxButton>
  <CxButton variant="primary" disabled={busy} onClick={()=>void choose()}><FolderMark size={16}/>폴더 선택</CxButton>
 </>}>
  <p className="nubi-mail-storage-intro">메일 원문과 첨부파일은 <strong>저장 공간을 많이 사용할 수 있어요.</strong></p>
  <p className="nubi-mail-storage-hint">여유 공간이 있는 폴더를 정하면 메일을 가져와요.</p>
  <div className="nubi-mail-storage-location"><FolderMark size={18}/><div><strong>현재 저장 위치</strong><span title={status.rawRoot}>{status.rawRoot}</span></div></div>
  <small>{status.counts?.received>0?'다른 폴더를 선택하면 기존 원문도 함께 옮겨요.':'선택한 폴더 안에 메일 전용 폴더를 만들어요.'} 저장 위치는 메일 설정에서 바꿀 수 있어요.</small>
  {busy&&<p className="nubi-mail-storage-progress" role="status"><span className="status-spinner"/>저장 위치 적용 중 <time>{durationLabel(elapsed)}</time></p>}
  {error&&<p role="alert">{error}</p>}
 </DetailPanel>;
}
