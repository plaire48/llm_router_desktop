import {MAILBOX_TABS,mailboxSelection,personalMailFolders} from './mailbox-navigation.mjs';
import {CxSelect} from './WorkspaceSelect.jsx';
import {FolderMark} from './marks.jsx';
import {ApprovalHistory} from './ApprovalHistory.jsx';
import {WorkspaceCatalogTabs} from './WorkspaceCatalogTabs.jsx';
import {AgentMark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import './mail-table.css';
import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {CxButton, Icon} from '@e2e/cx-design-system';
import {WorkspaceAction as ActionButton} from './WorkspaceAction.jsx';
import {MailReader} from './MailReader.jsx';
import {MailKnowledgeSearch} from './MailKnowledgeSearch.jsx';
import {MailTimestamp} from './MailTimestamp.jsx';
import {durationLabel} from '../runtime/response-timing.mjs';
import {mailTableDate} from '../runtime/mail-presentation.mjs';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';
import {LoadingNote} from './LoadingNote.jsx';

export function MailHistory({api,onDocument,onAsk,onAskSearch,onSettings,connectionRef,sourceTarget,onReturn,viewState}){
 const [portalView,setPortalView]=useState(()=>viewState?.current?.portalView==='approvals'?'approvals':'mail');
 const [mailbox,setMailbox]=useState(()=>viewState?.current?.mailbox||'inbox');
 const lastPersonalFolder=useRef(viewState?.current?.personalFolder||mailbox);
 const mailboxTabs=useRef(null);
 const [status,setStatus]=useState(null),[refreshing,setRefreshing]=useState(false),[searchRevision,setSearchRevision]=useState(0);
 const [query,setQuery]=useState(()=>viewState?.current?.query||''),[source,setSource]=useState(null),[loading,setLoading]=useState(false);
 useEffect(()=>{if(!status)return;const next=mailboxSelection(mailbox,status.folders);if(next!==mailbox){setMailbox(next);if(viewState)viewState.current={...viewState.current,mailbox:next,search:undefined};}},[status?.folders,mailbox]);
 useEffect(()=>{if(viewState)viewState.current={...viewState.current,portalView};},[portalView,viewState]);
 const [navigation,setNavigation]=useState(null),pendingNavigation=useRef(null),listRoot=useRef(null);
 const alive=useRef(true),epoch=useRef(0),selection=useRef(0);
 useEffect(()=>{const reset=()=>{closeReader();setQuery('');setNavigation(null);if(viewState)viewState.current={};setSearchRevision(value=>value+1);void api('mail',{action:'status',includeMessages:false}).then(setStatus).catch(()=>{});};window.addEventListener('nubi-mail-reset',reset);return()=>window.removeEventListener('nubi-mail-reset',reset);},[api]);
 const accountKey=status?`${status.accountKey||'local'}:${status.identityRevision||0}`:viewState?.current?.accountKey??null,previousAccount=useRef(accountKey);
 useLayoutEffect(()=>{if(previousAccount.current!==accountKey){previousAccount.current=accountKey;closeReader();setQuery('');setNavigation(null);}if(viewState)viewState.current={...viewState.current,accountKey};},[accountKey]);
 useEffect(()=>{alive.current=true;let pending=false;async function refresh(){if(pending)return;pending=true;const attempt=++epoch.current;try{const current=await api('mail',{action:'status',includeMessages:false});if(alive.current&&attempt===epoch.current)setStatus(current);}catch{if(alive.current)notifyWorkspaceToast('메일 이력을 읽지 못했어요. 연결 상태를 확인해 주세요.',{error:true});}finally{pending=false;}}void refresh();const timer=setInterval(refresh,3000);return()=>{alive.current=false;epoch.current++;selection.current++;clearInterval(timer);};},[api]);
 useEffect(()=>{if(!sourceTarget)return;setPortalView('mail');let live=true;const attempt=++selection.current;let observed=attempt;void (async()=>{try{await api('mail',{action:'evidence',...sourceTarget});if(!live||attempt!==selection.current)return;const opened=await open(sourceTarget.id,sourceTarget.sourceHash);observed=selection.current;if(opened&&sourceTarget.attachmentId&&live)await onDocument?.(sourceTarget.id,sourceTarget.attachmentId,{...sourceTarget,canPresent:()=>live&&alive.current&&observed===selection.current});}catch{if(live&&observed===selection.current)notifyWorkspaceToast('원문이 바뀌었거나 읽을 수 없어요.',{error:true});}})();return()=>{live=false;};},[sourceTarget?.key]);
 useEffect(()=>{if(viewState)viewState.current={...viewState.current,query};},[query,viewState]);
 useEffect(()=>{const saved=viewState?.current?.source;if(saved)void open(saved.id,saved.sourceHash,saved);},[]);
 useEffect(()=>{const target=pendingNavigation.current;if(!target||navigation?.blocked)return;if(navigation?.signature!==target.signature){pendingNavigation.current=null;return;}if(navigation.page!==target.page)return;pendingNavigation.current=null;const rows=navigation.results||[],row=target.edge==='first'?rows[0]:rows.at(-1);if(row)void open(row.sourceId,row.sourceHash,{query:navigation.query,match:row.match});},[navigation]);
 function closeReader(){const trigger=listRoot.current?.querySelector('.nubi-mail-result[aria-pressed="true"]');pendingNavigation.current=null;selection.current++;setLoading(false);setSource(null);if(viewState)viewState.current={...viewState.current,source:null};requestAnimationFrame(()=>(trigger||listRoot.current?.querySelector('.nubi-mail-results'))?.focus({preventScroll:true}));}
 const position=navigation?.results?.findIndex(row=>row.sourceId===source?.id)??-1;
 function adjacent(direction){
  if(navigation?.blocked||position<0||loading)return;
  const row=navigation.results[position+direction];
  if(row){void open(row.sourceId,row.sourceHash,{query:navigation.query,match:row.match});return;}
  const next=navigation.page+direction;if(next<1||next>navigation.totalPages)return;
  pendingNavigation.current={page:next,edge:direction>0?'first':'last',signature:navigation.signature};navigation.movePage(next);
 }
 async function open(id,expectedHash,context={}){
  const attempt=++selection.current;setLoading(true);
  try{
   const value=await api('mail',{action:'read',id,includePresentation:true});if(expectedHash&&value.sourceHash!==expectedHash)throw Error('mail_source_changed');
   if(!alive.current||attempt!==selection.current)return false;
   setSource({...value,match:context.match,searchQuery:context.query||''});
   if(viewState)viewState.current={...viewState.current,source:{id,sourceHash:value.sourceHash,query:context.query||'',match:context.match}};
   const attachment=context.match?.kind==='attachment'&&value.mail.attachments.find(item=>item.id===context.match.attachmentId);
   if(attachment&&['document_read','text_read'].includes(attachment.contentState)&&!context.match.filenameOnly)await onDocument?.(id,attachment.id,{sourceHash:value.sourceHash,attachmentHash:attachment.sha256,...(context.match.page||context.match.slide||context.match.sheet?{location:{...(context.match.page?{page:context.match.page}:{}),...(context.match.slide?{slide:context.match.slide}:{}),...(context.match.sheet?{sheet:context.match.sheet}:{})}}:{}),query:context.query,canPresent:()=>alive.current&&attempt===selection.current});
   return alive.current&&attempt===selection.current;
  }catch{if(alive.current&&attempt===selection.current)notifyWorkspaceToast('원문이 바뀌었거나 읽을 수 없어요.',{error:true});return false;}
  finally{if(alive.current&&attempt===selection.current)setLoading(false);}
 }
 async function reload(){
  if(refreshing)return;setRefreshing(true);
  try{
   let current=await api('mail',{action:'status',includeMessages:false});
   if(current.connected&&!current.checking&&!current.connecting){
    if(!current.nextCheckAt||Date.now()>=Date.parse(current.nextCheckAt))current=await api('mail',{action:'portalSync'});
    else notifyWorkspaceToast(`다음 메일 확인은 ${new Date(current.nextCheckAt).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}이에요.`);
   }
   // Checking the server must not replace the rows the user is reading.
   if(alive.current)setStatus(current);
  }catch(error){if(alive.current)notifyWorkspaceToast(error.message==='mail_check_wait'?'서버 확인 대기 시간이 남아 있어요. 다음 확인 시각에 자동으로 가져옵니다.':'메일을 다시 확인하지 못했어요. 연결 상태를 확인해 주세요.',{error:true});}
  finally{if(alive.current)setRefreshing(false);}
 }
 const checkedAt=status?.progress?.checkedAt||status?.lastCheckedAt;
 const personalFolders=personalMailFolders(status?.folders),personalSelected=personalFolders.some(folder=>'folder:'+folder.id===mailbox);
 useLayoutEffect(()=>{const tabs=mailboxTabs.current,scroll=tabs?.parentElement,active=tabs?.querySelector('[aria-selected="true"]');if(!scroll||!active)return;const box=scroll.getBoundingClientRect(),item=active.getBoundingClientRect();if(item.right>box.right)scroll.scrollLeft+=item.right-box.right+8;else if(item.left<box.left)scroll.scrollLeft-=box.left-item.left+8;},[mailbox,personalFolders.length]);
 function selectMailbox(value){if(value==='personal')value=personalFolders.some(folder=>'folder:'+folder.id===lastPersonalFolder.current)?lastPersonalFolder.current:'folder:'+personalFolders[0].id;if(value.startsWith('folder:'))lastPersonalFolder.current=value;closeReader();setMailbox(value);setQuery('');if(viewState)viewState.current={...viewState.current,mailbox:value,personalFolder:lastPersonalFolder.current,query:'',search:undefined};}
 const revision=JSON.stringify([status?.identityRevision,status?.counts?.received]);
 return <section className="nubi-mail-history" data-layout="table" data-selected={!!source||loading} aria-label="메일 이력">
  <header className="nubi-mail-history-bar">{onReturn&&<ActionButton action="back" label="대화로 돌아가기" onClick={onReturn}/>}<Icon name="mail" size={22}/><h1>메일</h1><span>{status?.counts?.received??0}개</span><ActionButton action="refresh" label="새 메일 확인" disabled={refreshing||status?.checking||status?.connecting} onClick={reload}/>{(refreshing||status?.checking)&&<span className="status-spinner" role="status" aria-label="메일 확인 중"/>}<CxButton ref={connectionRef} className="nubi-mail-connect-link" onClick={onSettings}><Icon name="mail" size={18}/><span>{status?.connected||status?.localCount?'메일 설정':'포털 로그인'}</span></CxButton></header>
  <WorkspaceCatalogTabs wide label="포털 자료" idPrefix="portal-view" active={portalView} onChange={value=>{setPortalView(value);if(value==='approvals')closeReader();}} items={[{key:'mail',label:<><Icon name="mail" size={16}/>메일</>},{key:'approvals',label:<><Icon name="clipboardCheck" size={16}/>결재</>}]}/>
  {portalView==='approvals'?<ApprovalHistory api={api} onSettings={onSettings} status={status} onAsk={onAsk} onAskSearch={onAskSearch} onDocument={onDocument} revision={revision}/>:<>
  <WorkspaceCatalogTabs containerRef={mailboxTabs} wide={false} label="메일함" idPrefix="mailbox" active={personalSelected?'personal':mailbox} onChange={selectMailbox} items={[...MAILBOX_TABS.map(({key,label,icon})=>({key,label:<><Icon name={icon} size={16}/>{label}</>})),...(personalFolders.length?[{key:'personal',label:<><FolderMark size={16}/>개인 폴더</>}]:[])]}/>
  {personalSelected&&<div className="nubi-mail-personal-folder"><FolderMark size={16}/><CxSelect singleLine aria-label="개인 폴더 선택" title={personalFolders.find(folder=>'folder:'+folder.id===mailbox)?.name} value={mailbox} onChange={event=>selectMailbox(event.target.value)}>{personalFolders.map(folder=><option key={folder.id} value={'folder:'+folder.id}>{folder.name||'개인 폴더'}</option>)}</CxSelect></div>}
  <div className="nubi-mail-history-body">
   <div ref={listRoot} className="nubi-mail-history-list"><MailKnowledgeSearch key={`${mailbox}:${accountKey}`} mailbox={mailbox} accountKey={accountKey} api={api} query={query} onQuery={setQuery} lastAppliedAt={status?.progress?.lastAppliedAt} revision={revision} refreshKey={searchRevision} selectedId={source?.id} onOpen={open} onAskSearch={onAskSearch} onAskSelected={onAsk} onResults={setNavigation} viewState={viewState}/></div>
   <article className="nubi-mail-history-detail" aria-label="메일 본문" aria-busy={loading}>
    {(source||loading)&&<div className="nubi-mail-reader-navigation"><ActionButton action="back" label="메일 목록으로" onClick={closeReader}/><span>{position>=0?`${navigation.offset+position+1} / ${navigation.total}`:''}</span><ActionButton action="previousMedia" iconOnly label="이전 메일" disabled={loading||navigation?.blocked||position<0||(position===0&&navigation.page<=1)} onClick={()=>adjacent(-1)}/><ActionButton action="nextMedia" iconOnly label="다음 메일" disabled={loading||navigation?.blocked||position<0||(position===navigation.results.length-1&&navigation.page>=navigation.totalPages)} onClick={()=>adjacent(1)}/></div>}
    {loading?<LoadingNote>메일 읽는 중</LoadingNote>:source?<MailReader key={source.id} source={source} api={api} onDocument={onDocument} onAsk={onAsk} onLocalChange={(id,local)=>{setSource(current=>current?.id===id?{...current,local}:current);setSearchRevision(value=>value+1);}}/>:<div className="nubi-mail-reader-empty"><AgentMark size={64} mood="idle"/><strong>선택된 항목이 없습니다.</strong><p>목록에서 항목을 선택하세요.</p></div>}
   </article>
  </div>
  {(checkedAt||status?.progress?.lastAppliedAt||status?.recentChecks?.length>0)&&<details className="nubi-mail-recent"><summary><Icon name="clock" size={14}/>최근 수집<Icon name="chevronDown" size={12}/></summary>
   <dl className="nubi-mail-recent-times" aria-label="수집 시각">{status?.progress?.lastAppliedAt&&<div><dt><Icon name="check" size={14}/>최근 반영</dt><dd><MailTimestamp at={status.progress.lastAppliedAt} label=""/></dd></div>}{checkedAt&&<div><dt><Icon name="refresh" size={14}/>서버 확인</dt><dd><MailTimestamp at={checkedAt} label=""/></dd></div>}</dl>
   <ol>{(status.recentChecks||[]).map((record,index)=><li key={`${record.at}:${index}`}><Icon name={record.kind==='organized'?'check':record.kind==='error'?'alertCircle':'download'} size={14}/><span><strong>{record.kind==='organized'?`정리 완료 ${record.completed}개${durationLabel(record.durationMs)?` / ${durationLabel(record.durationMs)}`:''}`:record.kind==='error'?'서버 연결 확인 필요':`수신 ${record.received}개${record.pendingServer===null?'':` / 남음 ${record.pendingServer}개`}${record.attention?` / 확인 필요 ${record.attention}개`:''}`}</strong><time dateTime={record.at}>{mailTableDate(record.at)}</time></span></li>)}</ol></details>}
  </>}
 </section>;
}
