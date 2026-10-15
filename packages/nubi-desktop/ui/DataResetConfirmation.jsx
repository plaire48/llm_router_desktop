import {wikiDrafts,wikiLastDocuments} from './wiki-drafts.mjs';
import React,{useState,useEffect,useRef} from 'react';
import {DeckConfirmation} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {TaskProgressBar} from './TaskProgressBar.jsx';
import {durationLabel} from '../runtime/response-timing.mjs';

export function DataResetConfirmation({kind,api,onDone,onClose}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[elapsed,setElapsed]=useState(0),[progress,setProgress]=useState(null),lock=useRef(false);
 const mail=kind==='mail';
 useEffect(()=>{if(!busy)return;const start=Date.now();let live=true,pending=false;const timer=setInterval(()=>{
  setElapsed(Date.now()-start);
  if(mail&&!pending){pending=true;void api('mail',{action:'resetProgress'}).then(value=>{if(live)setProgress(value);}).catch(()=>{}).finally(()=>{pending=false;});}
 },500);return()=>{live=false;clearInterval(timer);};},[busy,mail,api]);
 async function reset(){if(lock.current)return;lock.current=true;setBusy(true);setError('');setProgress(null);setElapsed(0);try{
  const result=await api(mail?'mail':'wikiInitialization',{action:'reset',confirmed:true});const resetScope=mail?'personal-mail':result.resetProjectId;if(resetScope){for(const key of wikiDrafts.keys())if(key.startsWith(resetScope+':'))wikiDrafts.delete(key);wikiLastDocuments.delete(resetScope);}onDone(result);
 }catch(cause){setError(cause.message==='mail_reset_wait'?'작업이 아직 종료 중이에요. 잠시 뒤 초기화를 다시 눌러 주세요.':/wiki_busy|agent_busy|mail_busy/.test(cause.message)?'저장이나 진행 중인 작업을 마친 뒤 다시 초기화해 주세요.':mail?'초기화를 마치지 못했어요. 수집을 멈췄으며 다시 초기화할 수 있어요.':'위키를 초기화하지 못했어요. 다시 시도해 주세요.');}finally{setBusy(false);lock.current=false;}}
 const label=progress?.stage==='stopping'?'메일 작업 중지 중':'저장한 데이터 정리 중';
 return <DeckConfirmation title={mail?'메일 데이터를 초기화할까요?':'위키를 다시 만들까요?'} confirmLabel={mail?'초기화':'지우고 다시 만들기'} confirmIcon="trash" showActionLabels busy={busy} onCancel={()=>{if(!busy)onClose();}} onConfirm={()=>void reset()} message={mail?<><strong>이 PC의 메일 원문, 첨부, 메일 위키와 수집 기록을 삭제해요.</strong><br/>직접 수정한 메일 위키도 삭제돼요. 포털 원본과 가져온 원본 폴더는 유지돼요. 이후 포털 연결이나 폴더 선택으로 다시 가져올 수 있어요.</>:<><strong>현재 프로젝트의 openwiki 폴더와 보관한 위키 작업을 삭제해요.</strong><br/>직접 수정한 위키도 삭제돼요. 소스 코드, Git 이력과 대화는 유지하고 연결된 모델로 다시 만들어요.</>}>
  {busy&&<div className="nubi-data-reset-progress"><p role="status">{label} <time>{durationLabel(elapsed,{keepSeconds:true})}</time></p><TaskProgressBar label={label} value={progress?.total?Math.floor(progress.completed/progress.total*100):undefined} estimate={{identity:progress?.stage||'reset',completed:progress?.completed,total:progress?.total}}/></div>}
  {error&&<p role="alert">{error}</p>}
 </DeckConfirmation>;
}
