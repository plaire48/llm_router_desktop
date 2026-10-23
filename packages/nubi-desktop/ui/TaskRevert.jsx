// Revert the task's file changes to a checkpoint and undo that revert (opencode session revert, 2026-10-23). The
// checkpoints are taken just before each applied edit, new file and command; reverting keeps the current files so it
// can be undone. Existing parts only: the applied-files row button and the deck confirmation.
import React,{useEffect,useRef,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {DeckConfirmation} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';
import './task-revert.css';

const REASONS={before_edit:'수정 적용 전',before_new_file:'새 파일 만들기 전',before_command:'명령 실행 전'};
const time=value=>{try{return new Date(value).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});}catch{return '';}};
export const checkpointLabel=row=>`${REASONS[row.reason]||'변경 전'} ${time(row.createdAt)}`.trim();

export function TaskRevert({api,taskId,revision}){
  const [data,setData]=useState(null),[choosing,setChoosing]=useState(false),[selected,setSelected]=useState(null),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
  const epoch=useRef(0);
  useEffect(()=>{
    const request=++epoch.current;setData(null);
    void api('checkpoints',{taskId}).then(value=>{if(request===epoch.current)setData(value);}).catch(()=>{});
    return()=>{epoch.current++;};
  },[api,taskId,revision,reload]);
  const items=data?.items||[];
  if(!data||!items.length&&!data.revert)return null;
  async function act(method,args,message){
    setBusy(true);
    try{const result=await api(method,{taskId,...args});notifyWorkspaceToast(message(result.files.length));setChoosing(false);}
    catch(error){notifyWorkspaceToast(error?.message==='agent_busy'?'작업이 끝난 뒤에 되돌릴 수 있어요.':'되돌리지 못했어요. 파일 상태를 확인해 주세요.',{error:true});}
    finally{setBusy(false);setReload(value=>value+1);}
  }
  if(data.revert)return <CxButton className="nubi-applied-more" disabled={busy} onClick={()=>act('undoRevert',{},count=>`되돌리기를 취소했어요. 파일 ${count}개를 다시 바꿨어요.`)}><span>되돌리기 취소</span><Icon name="undo" size={16}/></CxButton>;
  const oldest=items.at(-1)?.id;
  return <>
    <CxButton className="nubi-applied-more" disabled={busy} onClick={()=>{setSelected(oldest);setChoosing(true);}}><span>변경 전으로 되돌리기</span><Icon name="clockRewind" size={16}/></CxButton>
    {choosing&&<DeckConfirmation title="변경 전으로 되돌리기" confirmLabel="되돌리기" showActionLabels busy={busy} onCancel={()=>setChoosing(false)} onConfirm={()=>act('revertCheckpoint',{checkpointId:selected},count=>`파일 ${count}개를 되돌렸어요.`)}
      message={<>고른 시점 뒤에 바뀐 파일을 모두 그때로 되돌려요.<br/>직접 고친 내용도 함께 되돌아가요. 되돌린 뒤에 취소할 수 있어요.</>}>
      <div role="radiogroup" aria-label="되돌릴 시점" className="nubi-revert-points">{items.map(row=><label key={row.id}><input type="radio" name={'checkpoint-'+taskId} checked={selected===row.id} onChange={()=>setSelected(row.id)}/><span>{checkpointLabel(row)}</span></label>)}</div>
    </DeckConfirmation>}
  </>;
}
