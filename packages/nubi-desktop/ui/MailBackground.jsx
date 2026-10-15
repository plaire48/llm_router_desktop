import React,{useEffect,useRef,useState} from 'react';
import {CxButton,DetailPanel,Icon} from '@e2e/cx-design-system';
import {ResponseTime} from './ResponseTime.jsx';
import {FileKindIcon} from './FileKindIcon.jsx';
import {mailAttentionInfo,mailAttentionRowInfo} from './mail-attention-state.mjs';
import './mail-background.css';

export function MailBackground({api,status,onStatus,onClose,onSettings,onOpenMessage}){
 const [page,setPage]=useState(null),[offset,setOffset]=useState(0),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[notice,setNotice]=useState('');
 const alive=useRef(true),epoch=useRef(0),pending=useRef(false),actionLock=useRef(false),started=useRef(new Date().toISOString());
 async function reload(force=false){
  if(pending.current&&!force)return;pending.current=true;const attempt=++epoch.current;
  try{const value=await api('mail',{action:'attention',offset});const current=value.status||await api('mail',{action:'status'});if(alive.current&&epoch.current===attempt){setPage(value);onStatus({...current,progress:{...current.progress,attention:value.total+(value.retrieval?.count||0)}});setFailure('');if(offset&&offset>=value.total)setOffset(Math.max(0,Math.ceil(value.total/10)-1)*10);}}
  catch{if(alive.current&&epoch.current===attempt)setFailure('메일 상태를 읽지 못했어요. 잠시 후 다시 열어 주세요.');}
  finally{if(epoch.current===attempt){pending.current=false;if(alive.current)setLoading(false);}}
 }
 useEffect(()=>{alive.current=true;void reload(true);const timer=setInterval(()=>{if(!actionLock.current)void reload();},3000);return()=>{alive.current=false;epoch.current++;clearInterval(timer);};},[api,offset]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),2500);return()=>clearTimeout(timer);},[notice]);
 async function act(action,id){
  if(actionLock.current)return;actionLock.current=true;setBusy(true);setFailure('');
  try{await api('mail',{action,...(id?{id}:{})});if(alive.current){await reload(true);setNotice(action==='retryDownloads'?'다음 서버 확인 때 다시 받습니다.':'다시 처리를 요청했어요.');}}
  catch(error){if(alive.current)setFailure(error.message==='mail_busy'?'현재 메일 정리가 끝나면 다시 눌러 주세요.':mailAttentionInfo(error.message).title);}
  finally{actionLock.current=false;if(alive.current)setBusy(false);}
 }
 const serverError=status?.error&&status.error!=='mail_cancelled'?mailAttentionInfo(status.error):null;
 const selectedModel=status?.destination||status?.activeModel;
 const modelAvailable=(status?.catalogs||[]).some(catalog=>catalog.provider===selectedModel?.provider&&catalog.models.some(model=>model.id===selectedModel.model));
 const modelWaiting=status?.progress?.stage==='waiting_model'||!!(status?.connected&&status.autoWiki&&(status.counts?.attention??page?.total)>0&&!modelAvailable);
 const canRetry=!(!status?.connected&&!status?.localCount)&&status.autoWiki&&!modelWaiting&&!status.summarizing&&!status.readingAttachments;
 const messageLabel=row=>row.subject||'제목 없음';
 const openSource=row=>onOpenMessage?.({id:row.id,sourceHash:row.sourceHash});
 const pagination=page?.total>10?<div className="nubi-mail-background-pages"><span>{Math.floor(offset/10)+1} / {Math.ceil(page.total/10)}</span><CxButton className="nubi-icon-button" aria-label="이전 메일" title="이전 메일" disabled={!offset||busy} onClick={()=>setOffset(Math.max(0,offset-10))}><Icon name="chevronLeft" size={16}/></CxButton><CxButton className="nubi-icon-button" aria-label="다음 메일" title="다음 메일" disabled={offset+10>=page.total||busy} onClick={()=>setOffset(offset+10)}><Icon name="chevronRight" size={16}/></CxButton></div>:null;
 return <DetailPanel className="deck-dialog nubi-panel nubi-mail-background" title={<span className="nubi-mail-background-title"><Icon name="mail" size={20}/>메일 백그라운드</span>} variant="modal" onClose={onClose} footer={pagination}>
  <div className="nubi-mail-background-summary" role="status">{notice&&<Icon name="check" size={16}/>}<strong>{notice||(loading&&!page?'상태 확인 중':failure?'상태를 다시 확인해 주세요':!page?'상태를 확인하지 못했어요':page.total||page.retrieval?.count?'확인할 메일이 있어요':serverError?'메일 연결 확인이 필요해요':modelWaiting?'AI 연결이 필요해요':'확인 필요한 메일이 없어요')}</strong>{loading&&!page&&<span className="nubi-mail-background-loading"><span className="status-spinner"/><ResponseTime timing={{startedAt:started.current}} live showIcon={false} label=""/></span>}<CxButton className="nubi-icon-button" aria-label="메일 설정" title="메일 설정" onClick={onSettings}><Icon name="sliders" size={18}/></CxButton></div>
  {failure&&<p className="nubi-mail-background-notice" role="alert"><Icon name="alertCircle" size={16}/><span>{failure}</span></p>}
  {(serverError||modelWaiting||(!status?.connected&&!status?.localCount)||!status?.autoWiki)&&<div className="nubi-mail-background-notice"><Icon name="infoCircle" size={16}/><span>{serverError?.title||(modelWaiting?'정리할 AI 모델을 연결해 주세요.':(!status?.connected&&!status?.localCount)?'메일을 연결하면 정리를 이어갑니다.':'자동 정리가 꺼져 있어요.')}</span><CxButton onClick={onSettings}><Icon name={modelWaiting?'list':'sliders'} size={16}/>{modelWaiting?'모델 확인':'설정'}</CxButton></div>}
  {page?.retrieval?.count>0&&<div className="nubi-mail-background-notice"><Icon name="download" size={16}/><span title={mailAttentionInfo(page.retrieval.errors?.[0]).title}>{mailAttentionInfo(page.retrieval.errors?.[0]).title} ({page.retrieval.count}개)</span>{!page.retrieval.errors?.every(code=>code==='mail_size_limit')&&<CxButton disabled={busy||(!status?.connected&&!status?.localCount)||!status?.autoWiki} onClick={()=>act('retryDownloads')}><Icon name="refresh" size={16}/>다시 받기</CxButton>}</div>}
  <div className="nubi-mail-background-items" aria-label="확인 필요한 메일">
   {(page?.items||[]).map(row=>{const issue=mailAttentionRowInfo(row);return <div key={row.id} className="nubi-mail-background-item">{issue.attachmentsOnly?<FileKindIcon name={issue.filename} size={18}/>:<Icon name="mail" size={18}/>}<div className="nubi-mail-background-copy"><strong title={messageLabel(row)+(row.from?' / '+row.from:'')}>{messageLabel(row)}</strong><span title={issue.detail}>{issue.title}</span></div><div className="nubi-mail-background-actions">{onOpenMessage&&<CxButton className="nubi-icon-button" aria-label={`${messageLabel(row)} 원문 보기`} title="원문 보기" onClick={()=>openSource(row)}><Icon name="file" size={16}/></CxButton>}{issue.action==='settings'?<CxButton onClick={onSettings}><Icon name="sliders" size={16}/>설정</CxButton>:issue.action==='retry'&&<CxButton disabled={busy||!canRetry} onClick={()=>act('retry',row.id)}><Icon name="refresh" size={16}/>{issue.attachmentsOnly?'다시 읽기':'다시 정리'}</CxButton>}</div></div>;})}
  </div>
 </DetailPanel>;
}
