import React,{useEffect,useId,useState} from 'react';
import {CxButton,CxInput,CxSelect,CxTextarea,DetailPanel,Icon} from '@e2e/cx-design-system';
import {DeckConfirmation} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {SettingToggle} from './SettingToggle.jsx';
import {WorkspaceAction} from './WorkspaceAction.jsx';
import './routine-settings.css';
const days=['일','월','화','수','목','금','토'];
const failure=error=>({routine_previous_project_missing:'이전 실행의 프로젝트를 다시 열고 질문과 승인 상태를 확인해 주세요.',routine_changed:'루틴이 변경됐어요. 내용을 확인하고 다시 실행해 주세요.',routine_busy:'이전 실행의 질문이나 승인을 먼저 확인해 주세요.',routine_not_ready:'모델 연결과 프로젝트의 실행 상태를 확인해 주세요.',project_missing:'대상 프로젝트를 다시 선택해 주세요.',routine_invalid:'이름, 프로젝트, 시각과 요청을 확인해 주세요.'}[error?.message]||'루틴을 처리하지 못했어요. 다시 시도해 주세요.');
export function RoutineSettings({api,projectId,onClose,onStarted}){
 const [data,setData]=useState(null),[editing,setEditing]=useState(null),[removing,setRemoving]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');const id=useId();
 useEffect(()=>{let live=true;const read=()=>api('listRoutines').then(value=>{if(live)setData(value);},()=>{if(live)setError('루틴 목록을 읽지 못했어요.');});void read();const timer=setInterval(read,5000);return()=>{live=false;clearInterval(timer);};},[api]);
 async function act(operation){if(busy)return;setBusy(true);setError('');try{await operation();setData(await api('listRoutines'));}catch(e){setError(failure(e));}finally{setBusy(false);}}
 const field=(key,value)=>setEditing(current=>({...current,[key]:value}));
 if(removing)return <DeckConfirmation className="nubi-danger-confirmation" title="루틴을 삭제할까요?" confirmLabel="삭제" busy={busy} onCancel={()=>setRemoving(null)} onConfirm={()=>act(async()=>{await api('deleteRoutine',{id:removing.id,confirmed:true});setRemoving(null);})}><p>{removing.name}의 예약을 삭제합니다. 기존 대화는 남아 있어요.</p>{error&&<p role="alert">{error}</p>}</DeckConfirmation>;
 return <DetailPanel className="deck-dialog nubi-panel nubi-routine-settings" title={editing?'루틴 설정':'루틴'} variant="modal" busy={busy} onClose={onClose}>
  {error&&<p role="alert">{error}</p>}
  {editing?<form onSubmit={event=>{event.preventDefault();void act(async()=>{await api('saveRoutine',editing);setEditing(null);});}}>
   <label htmlFor={id+'name'}>이름</label><CxInput id={id+'name'} required maxLength={80} value={editing.name} disabled={busy} onChange={e=>field('name',e.target.value)}/>
   <label htmlFor={id+'project'}>프로젝트</label><CxSelect id={id+'project'} required disabled={busy} value={editing.projectId} onChange={e=>field('projectId',e.target.value)}><option value="">프로젝트 선택</option>{data?.projects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</CxSelect>
   <div className="nubi-routine-schedule"><div><label htmlFor={id+'kind'}>주기</label><CxSelect id={id+'kind'} value={editing.schedule.kind} disabled={busy} onChange={e=>field('schedule',{...editing.schedule,kind:e.target.value,weekday:editing.schedule.weekday??1})}><option value="daily">매일</option><option value="weekly">매주</option></CxSelect></div>{editing.schedule.kind==='weekly'&&<div><label htmlFor={id+'day'}>요일</label><CxSelect id={id+'day'} disabled={busy} value={editing.schedule.weekday} onChange={e=>field('schedule',{...editing.schedule,weekday:Number(e.target.value)})}>{days.map((day,index)=><option key={day} value={index}>{day}요일</option>)}</CxSelect></div>}<div><label htmlFor={id+'time'}>시각</label><CxInput id={id+'time'} type="time" required disabled={busy} value={editing.schedule.time} onChange={e=>field('schedule',{...editing.schedule,time:e.target.value})}/></div></div>
   <label htmlFor={id+'request'}>요청</label><CxTextarea id={id+'request'} required maxLength={16000} disabled={busy} value={editing.request} onChange={e=>field('request',e.target.value)}/>
   <SettingToggle label="예약 실행" checked={editing.enabled} disabled={busy} onChange={value=>field('enabled',value)}/>
   <p className="nubi-muted">이 PC의 시각을 사용합니다. 앱을 닫아 놓쳤던 예약은 다음 시작 때 한 번 실행해요. 질문과 승인은 대화에서 확인합니다.</p>
   <div className="nubi-routine-actions"><CxButton disabled={busy} onClick={()=>setEditing(null)}>취소</CxButton><CxButton type="submit" variant="primary" disabled={busy||!editing.projectId}>저장</CxButton></div>
  </form>:<>
   <CxButton disabled={busy||!data?.projects.length} onClick={()=>{setError('');setEditing({name:'',projectId:data.projects.some(p=>p.id===projectId)?projectId:data.projects[0]?.id||'',request:'',schedule:{kind:'daily',time:'09:00'},enabled:true});}}><Icon name="plus" size={18}/>루틴 추가</CxButton>
   {!data?<p role="status">루틴을 불러오고 있어요.</p>:!data.items.length?<p className="nubi-muted">{data.projects.length?'반복할 작업과 시각을 정해 주세요.':'프로젝트를 추가하면 루틴을 만들 수 있어요.'}</p>:<ul className="nubi-routine-list">{data.items.map(row=><li key={row.id}>
    <SettingToggle label={row.name} checked={row.enabled} disabled={busy} onChange={enabled=>act(()=>api('saveRoutine',{...row,enabled}))}/>
    <p className="nubi-muted">{data.projects.find(p=>p.id===row.projectId)?.name||'프로젝트 확인 필요'} / {row.schedule.kind==='weekly'?`매주 ${days[row.schedule.weekday]}요일`:'매일'} {row.schedule.time}</p>
    {row.lastError&&<p role="status">{failure({message:row.lastError})}</p>}
    <div className="nubi-routine-actions"><CxButton disabled={busy} onClick={()=>act(async()=>{const result=await api('runRoutineNow',{id:row.id});await onStarted?.(result);})}><Icon name="play" size={18}/>지금 실행</CxButton><WorkspaceAction action="edit" iconOnly label={`${row.name} 수정`} disabled={busy} onClick={()=>setEditing({...row})}/><WorkspaceAction action="delete" iconOnly label={`${row.name} 삭제`} disabled={busy} onClick={()=>setRemoving(row)}/></div>
   </li>)}</ul>}
  </>}
 </DetailPanel>;
}
