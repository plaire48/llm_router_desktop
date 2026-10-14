import React,{useEffect,useRef,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {DeckConfirmation} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {WorkspaceAction} from './WorkspaceAction.jsx';
import {PersonMark,FolderMark} from './marks.jsx';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';
import './memory-panel.css';
import {ShowMore} from './ShowMore.jsx';
import {LoadingNote} from './LoadingNote.jsx';

// What the agent remembers from this person's words: a switch, the list, and a trash can per line (confirmed).
export function MemoryPanel({api}){
 const [data,setData]=useState(null),[busy,setBusy]=useState(false),[confirm,setConfirm]=useState(null),live=useRef(true);
 const load=async()=>{try{const value=await api('memories',{action:'list'});if(live.current)setData(value);}catch{if(live.current)notifyWorkspaceToast('기억 목록을 읽지 못했어요.',{error:true});}};
 useEffect(()=>{live.current=true;void load();return()=>{live.current=false;};},[api]);
 const act=async args=>{if(busy)return;setBusy(true);try{const value=await api('memories',args);if(live.current)setData(value);}catch{if(live.current)notifyWorkspaceToast('기억을 바꾸지 못했어요. 다시 시도해 주세요.',{error:true});}finally{if(live.current)setBusy(false);}};
 if(!data)return <LoadingNote>기억을 불러오는 중</LoadingNote>;
 const enabled=data.enabled!==false;
 return <div className="nubi-memory-panel">
  <div className="nubi-mail-switch-row"><div><strong>기억 사용</strong><small>대화에서 말한 선호와 사실을 이 PC에만 저장해요. 비밀번호와 토큰은 저장하지 않아요.</small></div>
   <button type="button" role="switch" aria-label="기억 사용" aria-checked={enabled} className="nubi-ios-switch" disabled={busy} onClick={()=>act({action:'setEnabled',enabled:!enabled})}><span aria-hidden="true"/></button></div>
  {data.items.length?<ShowMore items={data.items} step={10}>{rows=><ul className="nubi-memory-list" aria-label="기억한 내용">{rows.map(row=><li key={row.id}><span className="nubi-memory-scope" title={row.scope==='user'?'내 기억: 모든 프로젝트에서 씀':'프로젝트 기억: 이 프로젝트에서만 씀'} aria-label={row.scope==='user'?'내 기억':'프로젝트 기억'}>{row.scope==='user'?<PersonMark size={16}/>:<FolderMark size={16}/>}</span><span className="nubi-memory-text">{row.text}</span><WorkspaceAction action="delete" iconOnly label={`${row.text.slice(0,20)} 삭제`} title="삭제" disabled={busy} onClick={()=>setConfirm(row)}/></li>)}</ul>}</ShowMore>
  :<p className="nubi-muted nubi-memory-empty"><Icon name="lightbulb" size={16}/>아직 기억한 내용이 없어요. 대화에서 선호나 사실을 말하면 여기에 쌓여요.</p>}
  {confirm&&<DeckConfirmation className="nubi-delete-memory" title="기억을 삭제할까요?" message={<><strong>{confirm.text}</strong></>} confirmLabel="삭제" confirmIcon="check" showActionLabels busy={busy} onCancel={()=>setConfirm(null)} onConfirm={async()=>{await act({action:'delete',id:confirm.id});setConfirm(null);}}/>}
 </div>;
}
// One line under the answer that produced a memory, with undo.
export function MemoryNote({note,onForget}){
 const lines=[...note.saved.map(row=>row.text),...note.updated.map(row=>row.text)];
 if(!lines.length&&!note.deleted?.length)return null;
 return <p className="nubi-memory-note" role="status"><Icon name="lightbulb" size={14}/><span>{lines.length?`기억했어요: ${lines.join(' / ')}`:'기억 하나를 지웠어요.'}</span>{onForget&&lines.length>0&&<CxButton className="nubi-text-button" onClick={()=>onForget(note.runId)}>되돌리기</CxButton>}</p>;
}
