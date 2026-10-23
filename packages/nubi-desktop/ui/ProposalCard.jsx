import {ConversationDecision} from './ConversationDecisions.jsx';
import {IrreversibleNotice} from './IrreversibleNotice.jsx';
import React,{useState,useRef,useEffect} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {diffLines} from 'diff';
import {FileKindIcon} from './FileKindIcon.jsx';
import {WorkspaceActionMenu} from './WorkspaceActionMenu.jsx';
import {WorkspaceAction} from './WorkspaceAction.jsx';
import {qualityLabel,qualityDescription} from '../runtime/quality-status.mjs';
import './proposal-card.css';
import {LoadingNote} from './LoadingNote.jsx';

export function ProposalCard({proposal:p,api,busy,onCompare,onRebase,onReplan,onCancel,onApply}) {
 const [open,setOpen]=useState(false),[preview,setPreview]=useState(null),[loading,setLoading]=useState(false),[failed,setFailed]=useState(false);
 const form=useRef(null);
 useEffect(()=>{const focus=event=>{if(event.detail===p.id){form.current?.scrollIntoView({block:'center'});form.current?.focus({preventScroll:true});}};document.addEventListener('nubi-open-decision',focus);return()=>document.removeEventListener('nubi-open-decision',focus);},[p.id]);
 async function toggle(){
  setOpen(value=>!value);
  if(open||preview||loading)return;
  setLoading(true);setFailed(false);
  try{const text=await api('proposalText',{proposalId:p.id});
   // Large changes use the dedicated editor instead of blocking the chat render.
   if(text.before.length+text.after.length>80000){setPreview({large:true});return;}
   const parts=diffLines(text.before,text.after,{timeout:50});
   setPreview(parts?{parts:parts.filter(part=>part.added||part.removed)}:{large:true});
  }catch{setFailed(true);}finally{setLoading(false);}
 }
 const name=p.path.split(/[\\/]/).at(-1);
 return <ConversationDecision id={p.id} blocked={busy}><article ref={form} tabIndex={-1} data-decision-id={p.id} className="nubi-proposal-card" aria-label={`${name} 변경 제안`}>
  <header><button className="nubi-proposal-file" title={p.path} aria-expanded={open} onClick={toggle}>
   <FileKindIcon name={p.path} size={20}/><strong>{name}</strong><Icon name={open?'chevronDown':'chevronRight'} size={16}/>
  </button><span className="nubi-proposal-counts" aria-label={p.stats?.state==='counted'?`추가 ${p.stats.added}줄, 삭제 ${p.stats.removed}줄`:undefined}>
   {p.kind==='create'&&<span>새 파일</span>}{p.stats?.state==='counted'&&<><b className="nubi-diff-added">+{p.stats.added}</b><b className="nubi-diff-removed">−{p.stats.removed}</b></>}
  </span></header>
  <p className="nubi-proposal-path" title={p.path}>{p.path}</p>
  {p.reason&&<p className="nubi-proposal-reason">{p.reason}</p>}
  <IrreversibleNotice value={p.irreversible}/>{p.sourceChanged&&<p className="nubi-proposal-stale" role="status"><Icon name="infoCircle" size={16}/><span title={p.mergeConflicted?'같은 부분이 바뀌었어요. AI가 새 제안을 준비해야 해요.':'파일이 바뀌었어요. 현재 내용에 다시 맞춰 주세요.'}>{p.mergeConflicted?'같은 부분이 바뀌었어요. AI가 새 제안을 준비해야 해요.':'파일이 바뀌었어요. 현재 내용에 다시 맞춰 주세요.'}</span></p>}
  {open&&<div className="nubi-proposal-preview" aria-label="변경 내용" aria-busy={loading}>
   {loading?<LoadingNote>변경 내용 불러오는 중</LoadingNote>:failed?<CxButton onClick={()=>{setOpen(false);}}>미리보기를 다시 열어 주세요.</CxButton>:preview?.large?<CxButton onClick={onCompare}>전체 비교에서 확인</CxButton>:preview?.parts.length===0?<p>텍스트 변경이 없어요.</p>:<pre tabIndex={0}>{preview?.parts.map((part,index)=><span key={index} data-change={part.added?'added':'removed'}>{part.value.split('\n').filter((line,i,lines)=>i<lines.length-1||line).map(line=>(part.added?'+ ':'− ')+line+'\n').join('')}</span>)}</pre>}
  </div>}
  <footer><div className="nubi-proposal-secondary"><CxButton disabled={busy} onClick={onCompare}><Icon name="columns" size={16}/>비교</CxButton>
   {p.kind!=='create'&&!p.sourceChanged&&<WorkspaceActionMenu label={`${name} 추가 작업`} inline><WorkspaceAction action="refresh" label="현재 파일에 다시 맞추기" disabled={busy} onClick={onRebase}/></WorkspaceActionMenu>}
   {p.quality?.state==='passed'?<span className="nubi-proposal-check" title="문법 검사 완료. 타입 검사와 실행 테스트는 별도로 확인합니다."><Icon name="check" size={16}/><span className="visually-hidden">문법 검사 완료</span></span>:<span title={qualityDescription(p.quality)} className="nubi-proposal-check">{qualityLabel(p.quality)}</span>}
  </div><div className="nubi-proposal-decisions"><CxButton disabled={busy} onClick={onCancel}><Icon name="xClose" size={16}/>취소</CxButton><CxButton disabled={busy||p.mergeConflicted&&!onReplan} variant="primary" onClick={p.sourceChanged?(p.mergeConflicted?onReplan:onRebase):onApply}><Icon name={p.sourceChanged?'refresh':'check'} size={16}/>{p.sourceChanged?(p.mergeConflicted?'다시 요청':'다시 맞추기'):'반영'}</CxButton></div></footer>
 </article></ConversationDecision>;
}
