import React,{useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {CxInput,CxTextarea,CxButton,Icon} from '@e2e/cx-design-system';
import {DeckConfirmation} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {WorkspaceAction} from './WorkspaceAction.jsx';
import {PersonMark,FolderMark} from './marks.jsx';
import {PageNumbers} from './PageNumbers.jsx';
import {LoadingNote} from './LoadingNote.jsx';
import './memory-panel.css';

export const memoryErrors={memory_changed:'기억이 바뀌었어요. 입력한 내용은 유지했어요. 최신 기억을 다시 선택해 주세요.',memory_missing:'이 기억은 삭제됐거나 현재 공간에서 볼 수 없어요.',memory_text:'비밀번호나 토큰 없이 300자 이내로 입력해 주세요.',memory_reference_limit:'기억은 한 번에 10개까지 참조할 수 있어요.',project_changed:'공간이 바뀌었어요. 현재 공간에서 기억을 다시 열어 주세요.'};
const dateText=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'';};
export function MemoryPanel({api,projectId,onReference,selected=[]}){
 const [data,setData]=useState(null),[query,setQuery]=useState(''),[scope,setScope]=useState('all'),[page,setPage]=useState(1),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[editing,setEditing]=useState(null),[confirm,setConfirm]=useState(null),[error,setError]=useState('');
 const live=useRef(true),revision=useRef(0),lock=useRef(false),panel=useRef(null),pageScroll=useRef(false);
 const parameters={page,pageSize:10,query,scope,...(projectId?{projectId,_projectId:projectId}:{})};
 const load=useCallback(async()=>{
  const request=++revision.current;setLoading(true);
  try{const value=await api('memories',{action:'list',page,pageSize:10,query,scope,...(projectId?{projectId,_projectId:projectId}:{})});if(live.current&&request===revision.current){setData(value);if(value.page!==page)setPage(value.page);}}
  catch(cause){if(live.current&&request===revision.current)setError(memoryErrors[cause.message]||'기억 목록을 읽지 못했어요. 다시 불러와 주세요.');}
  finally{if(live.current&&request===revision.current)setLoading(false);}
 },[api,projectId,page,query,scope]);
 useEffect(()=>{live.current=true;void load();return()=>{live.current=false;revision.current++;};},[load]);
 useLayoutEffect(()=>{if(pageScroll.current&&!loading&&data?.page===page){pageScroll.current=false;panel.current?.closest('.cx-panel-body')?.scrollTo({top:0,behavior:'instant'});panel.current?.querySelector('input')?.focus({preventScroll:true});}},[data,page,loading]);
 async function act(operation,after){
  if(lock.current)return false;lock.current=true;revision.current++;setBusy(true);setLoading(false);setError('');
  try{const value=await operation();if(live.current){if(Array.isArray(value?.items)){setData(value);setPage(value.page);}after?.(value);}return true;}
  catch(cause){if(live.current)setError(memoryErrors[cause.message]||'기억을 바꾸지 못했어요. 입력한 내용은 유지했어요.');return false;}
  finally{lock.current=false;if(live.current)setBusy(false);}
 }
 const mutate=(args,after)=>act(()=>api('memories',{...parameters,...args}),after);
 return <div ref={panel} className="nubi-memory-panel" aria-busy={loading||busy}>
  <div className="nubi-mail-switch-row"><div><strong>자동 기억 사용</strong><small>현재 공간에서 대화 속 선호와 사실을 자동 저장하고 참고해요.</small></div><button type="button" role="switch" aria-label="자동 기억 사용" aria-checked={data?.enabled!==false} className="nubi-ios-switch" disabled={!data||busy} onClick={()=>mutate({action:'setEnabled',enabled:!data.enabled})}><span aria-hidden="true"/></button></div>
  <div className="nubi-memory-tools"><CxInput type="search" aria-label="기억 검색" placeholder="기억 검색" value={query} disabled={!!editing||busy} onChange={event=>{setQuery(event.target.value);setPage(1);setError('');}}/><select className="native-select" aria-label="기억 범위" value={scope} disabled={!!editing||busy} onChange={event=>{setScope(event.target.value);setPage(1);}}><option value="all">모든 기억</option><option value="user">내 기억</option><option value="project">프로젝트 기억</option></select><WorkspaceAction action="refresh" label="기억 다시 불러오기" disabled={busy||!!editing} onClick={()=>{setError('');void load();}}/></div>
  {error&&<p className="nubi-memory-error" role="alert">{error}</p>}
  {!data?<LoadingNote>기억을 불러오는 중</LoadingNote>:<>
   <p className="nubi-muted nubi-memory-count">총 {data.total}개</p>
   {data.items.length?<ul className="nubi-memory-list" aria-label="기억한 내용">{data.items.map(row=><li key={row.id} data-memory-id={row.id}>
    <span className="nubi-memory-scope" title={row.scope==='user'?'내 기억: 다른 프로젝트에서도 쓸 수 있어요.':'이 프로젝트에서 기억한 내용이에요.'} aria-label={row.scope==='user'?'내 기억':'프로젝트 기억'}>{row.scope==='user'?<PersonMark size={16}/>:<FolderMark size={16}/>}</span>
    {editing?.id===row.id?<form className="nubi-memory-edit" onSubmit={event=>{event.preventDefault();void mutate({action:'update',id:row.id,sourceHash:editing.sourceHash,text:editing.text},()=>setEditing(null));}}><CxTextarea aria-label="기억 내용" value={editing.text} maxLength={300} autoFocus disabled={busy} onChange={event=>setEditing({...editing,text:event.target.value})}/><div className="nubi-memory-edit-actions"><small>{editing.text.length} / 300</small><WorkspaceAction action="cancel" label="기억 수정 취소" visibleLabel="취소" disabled={busy} onClick={()=>{setEditing(null);setError('');void load();}}/><WorkspaceAction action="save" label="기억 저장" visibleLabel="저장" type="submit" disabled={busy||!editing.text.trim()}/></div></form>:<>
     <div className="nubi-memory-copy"><p>{row.text}</p><small><span>{row.scope==='user'?'내 기억':'프로젝트'}</span>{dateText(row.updatedAt)&&<time dateTime={row.updatedAt} title={`저장 ${dateText(row.createdAt)} / 수정 ${dateText(row.updatedAt)}`}>{dateText(row.updatedAt)}</time>}<span>{row.origin==='manual'?'직접 관리':'대화에서 저장'}</span></small></div>
     <div className="nubi-memory-actions">{onReference&&<CxButton type="button" className="nubi-icon-button" data-icon-only aria-label="대화에 참조" title={selected.some(item=>item.id===row.id&&item.sourceHash===row.sourceHash)?'이미 연결한 기억':'대화에 참조'} disabled={busy||!!editing||selected.some(item=>item.id===row.id&&item.sourceHash===row.sourceHash)} onClick={()=>void act(()=>onReference(row))}><Icon name={selected.some(item=>item.id===row.id&&item.sourceHash===row.sourceHash)?'check':'plus'} size={16}/></CxButton>}<WorkspaceAction action="edit" label={`${row.text.slice(0,20)} 수정`} title="수정" disabled={busy||!!editing} onClick={()=>{setEditing({id:row.id,text:row.text,sourceHash:row.sourceHash});setError('');}}/><WorkspaceAction action="delete" label={`${row.text.slice(0,20)} 삭제`} title="삭제" disabled={busy||!!editing} onClick={()=>{setConfirm(row);setError('');}}/></div>
    </>}
   </li>)}</ul>:<p className="nubi-muted nubi-memory-empty"><Icon name="lightbulb" size={16}/>{query||scope!=='all'?'검색 조건에 맞는 기억이 없어요.':'아직 기억한 내용이 없어요. 대화에서 선호나 사실을 말하면 여기에 모여요.'}</p>}
   <PageNumbers page={data.page} totalPages={data.pages} label="기억 페이지" disabled={busy||loading||!!editing} onPage={value=>{pageScroll.current=true;setPage(value);}}/>
  </>}
  {confirm&&<DeckConfirmation className="nubi-delete-memory" title="기억을 삭제할까요?" message={<><strong>{confirm.text}</strong>{error&&<p role="alert">{error}</p>}</>} confirmLabel="삭제" confirmIcon="check" showActionLabels busy={busy} onCancel={()=>{setConfirm(null);setError('');}} onConfirm={()=>mutate({action:'delete',id:confirm.id,sourceHash:confirm.sourceHash},()=>setConfirm(null))}/>}
 </div>;
}
export function MemoryNote({note,onForget,onOpen}){
 const count=(note.saved?.length||0)+(note.updated?.length||0)+(note.deleted?.length||0);if(!count)return null;
 return <p className="nubi-memory-note" role="status"><Icon name="lightbulb" size={16}/>{onOpen?<CxButton className="nubi-text-button" onClick={onOpen}>기억 {count}개를 반영했어요.</CxButton>:<span>기억 {count}개를 반영했어요.</span>}{onForget&&<CxButton className="nubi-text-button" onClick={()=>onForget(note.runId)}>되돌리기</CxButton>}</p>;
}
