import React,{useEffect,useId,useRef,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {DriftLabel} from './DriftLabel.jsx';
import {FileKindIcon} from './FileKindIcon.jsx';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';
import {TaskRevert} from './TaskRevert.jsx';

function Counts({stats}){return stats?.state==='counted'?<span className="nubi-applied-counts" aria-label={`추가 ${stats.added}줄, 삭제 ${stats.removed}줄`}><span>+{stats.added}</span><span>−{stats.removed}</span></span>:null;}
export function AppliedFileChanges({api,taskId,receipts,onOpen}){
  const [open,setOpen]=useState(true),[all,setAll]=useState(false),[packet,setPacket]=useState(null),[loading,setLoading]=useState(false),[failed,setFailed]=useState(false),[opening,setOpening]=useState(null),[retry,setRetry]=useState(0);
  const epoch=useRef(0),listId=useId();
  const revision=receipts.map(row=>row.id+':'+row.afterHash).join('|'),total=new Set(receipts.map(row=>row.path)).size;
  useEffect(()=>{setOpen(true);setAll(false);},[taskId]);
  useEffect(()=>{
    const request=++epoch.current;setPacket(null);setLoading(!!total);setFailed(false);setOpening(null);
    if(total)void api('appliedFileSummary',{taskId}).then(value=>{if(request===epoch.current)setPacket(value);}).catch(()=>{if(request===epoch.current)setFailed(true);}).finally(()=>{if(request===epoch.current)setLoading(false);});
    return()=>{epoch.current++;};
  },[api,taskId,revision,retry]);
  if(!total)return null;
  const files=packet?.files||[],visible=all?files:files.slice(0,3);
  async function show(row){
    if(opening)return;
    const request=epoch.current,canPresent=()=>request===epoch.current;setOpening(row.path);
    try{await onOpen(row,{canPresent});}
    catch{if(canPresent())notifyWorkspaceToast('파일이 바뀌었거나 비교 기록을 열 수 없어요. 목록을 다시 확인해 주세요.',{error:true});}
    finally{if(canPresent())setOpening(null);}
  }
  return <section className="nubi-applied-files" aria-label="변경한 파일">
    <button className="nubi-applied-trigger" aria-expanded={open} aria-controls={listId} onClick={()=>setOpen(value=>!value)}>
      <strong>파일 {total}개 변경됨</strong>{packet?.totals&&<Counts stats={{state:'counted',...packet.totals}}/>}<Icon name={open?'chevronDown':'chevronRight'} size={16}/>
    </button>
    {open&&<div id={listId} className="nubi-applied-list" aria-busy={loading}>
      {loading?<p role="status"><span className="status-spinner"/>변경 확인 중</p>:failed?<CxButton onClick={()=>setRetry(value=>value+1)}><Icon name="refresh" size={16}/>다시 불러오기</CxButton>:visible.map(row=><CxButton key={row.path} className="nubi-applied-row" disabled={!!opening} title={row.path} aria-label={`${row.path} 변경 비교`} onClick={()=>show(row)}>
        <FileKindIcon name={row.path}/><DriftLabel>{row.path}</DriftLabel><Counts stats={row.stats}/>{opening===row.path?<span className="status-spinner" aria-label="비교 준비 중"/>:row.partial?<small>최근 반영</small>:row.state!=='verified'||row.stats?.state!=='counted'?<small>확인 필요</small>:null}
      </CxButton>)}
      {files.length>3&&<CxButton className="nubi-applied-more" aria-expanded={all} onClick={()=>setAll(value=>!value)}><span>{all?'접기':`파일 ${files.length-3}개 더 보기`}</span><Icon name={all?'chevronUp':'chevronRight'} size={16}/></CxButton>}
      {packet?.truncated&&<p>먼저 100개 파일을 표시해요.</p>}
      {!loading&&<TaskRevert api={api} taskId={taskId} revision={revision}/>}
    </div>}
  </section>;
}
