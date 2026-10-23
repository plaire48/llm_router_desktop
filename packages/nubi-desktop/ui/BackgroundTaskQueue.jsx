import React,{useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from '@e2e/cx-design-system';
import {backgroundTasks,taskIsActive} from './background-task-queue.mjs';
import {TaskProgressBar} from './TaskProgressBar.jsx';
import {durationLabel} from '../runtime/response-timing.mjs';
import {useFilterPosition} from './useFilterPosition.js';
import {motionDuration} from './motion-policy.mjs';
import {progressEstimateLabel,compactProgressEstimateLabel} from './remaining-time.mjs';
import './background-task-queue.css';
export const useBackgroundTasks=()=>useSyncExternalStore(backgroundTasks.subscribe,backgroundTasks.getSnapshot,backgroundTasks.getSnapshot);
const labels={queued:'대기 중',running:'진행 중',waiting:'확인 대기',completed:'완료',failed:'실패',cancelled:'중지됨',interrupted:'중단됨'};
export function BackgroundTaskQueue(){
 const rows=useBackgroundTasks(),[open,setOpen]=useState(false),[present,setPresent]=useState(false),[history,setHistory]=useState(false),[page,setPage]=useState(0),[now,setNow]=useState(Date.now),trigger=useRef(null),popup=useRef(null);
 const position=useFilterPosition(present,trigger,popup,{width:360,align:'start',focusPopup:true,onOutside:()=>setOpen(false)});
 const live=rows.filter(row=>taskIsActive(row.state)),attention=rows.filter(row=>['failed','waiting','interrupted'].includes(row.state));
 const finished=rows.filter(row=>!taskIsActive(row.state)),current=rows.filter(row=>taskIsActive(row.state)||['failed','interrupted'].includes(row.state));
 const source=[...(history?finished:current)].reverse(),pages=Math.max(1,Math.ceil(source.length/3)),currentPage=Math.min(page,pages-1),visible=source.slice(currentPage*3,currentPage*3+3);
 useEffect(()=>{if(page!==currentPage)setPage(currentPage);},[page,currentPage]);
 useEffect(()=>{if(!open||!live.length)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[open,live.length]);
 useEffect(()=>{if(open||!present)return;const timer=setTimeout(()=>setPresent(false),motionDuration('exit',popup.current));return()=>clearTimeout(timer);},[open,present]);
 useEffect(()=>{if(!open)return;const escape=event=>{if(event.key==='Escape'){event.preventDefault();setOpen(false);trigger.current?.focus({preventScroll:true});}};document.addEventListener('keydown',escape);return()=>document.removeEventListener('keydown',escape);},[open]);
 const close=()=>{setOpen(false);requestAnimationFrame(()=>trigger.current?.focus({preventScroll:true}));};
 const reveal=id=>{close();requestAnimationFrame(()=>backgroundTasks.open(id));};
 if(!rows.length)return null;
 return <><button ref={trigger} type="button" className="nubi-task-queue-trigger" aria-label={`백그라운드 작업 ${live.length}개 진행${attention.length?`, 확인 ${attention.length}개`:''}`} title="백그라운드 작업" aria-haspopup="dialog" aria-expanded={open} onClick={()=>{if(!open){setHistory(false);setPage(0);}setPresent(true);setOpen(value=>!value);}}><Icon name="list" size={16}/>{attention.length>0&&<i aria-hidden="true"/>}</button>
 {present&&createPortal(<section ref={popup} className="nubi-background-tasks-popup" role="dialog" tabIndex={-1} aria-label="백그라운드 작업" aria-hidden={!open||undefined} inert={!open||undefined} data-leaving={!open||undefined} style={position}>
  <ol className="nubi-background-task-list" aria-label={history?'완료 기록':'작업 목록'}>{visible.map(row=>{
   const active=taskIsActive(row.state),running=row.state==='running'||row.state==='queued',percent=row.state==='completed'?100:row.value===null?null:Math.floor(row.value/row.max*100);
   const text=running||row.state==='waiting'?(row.label||`${labels[row.state]} ${row.title}`):`${labels[row.state]} ${row.title}`;
   const detail=[row.title,labels[row.state],row.label,durationLabel(Math.max(0,(row.finishedAt||now)-row.startedAt),{keepSeconds:true}),row.risk].filter(Boolean).join('\n');
   const icon=<Icon name={row.state==='completed'?'check':row.state==='failed'?'alertCircle':'clock'} size={14}/>;
   const estimate=backgroundTasks.estimate(row.id,now),remaining=compactProgressEstimateLabel(estimate),remainingDetail=estimate.state==='estimated'?progressEstimateLabel(estimate):estimate.state==='finishing'?'마무리 확인 중':'시간 계산 중';
   return <li key={row.id} data-task-state={row.state} data-task-title={row.title} title={detail}>
    <div className="nubi-background-task-status">{row.canOpen?<button type="button" className="nubi-background-task-open" aria-label={`${row.title} 작업 열기`} title={detail} onClick={()=>reveal(row.id)}>{icon}<span>{text}</span></button>:<span className="nubi-background-task-open">{icon}<span>{text}</span></span>}
    </div>
    <div className="nubi-background-task-meter"><TaskProgressBar queue={false} label={`${row.title} 진행률`} value={row.state==='completed'?100:row.value??undefined} max={row.state==='completed'?100:row.max} active={running}/></div>
    <output aria-label="진행률">{percent===null?'—':`${percent}%`}</output><time data-estimate-state={running?estimate.state:undefined} aria-label={running?`남은 시간 ${remainingDetail}`:'남은 시간 해당 없음'} title={running?`${remainingDetail}\n현재 단계에서 실제 처리한 양과 속도로 추정해요.`:undefined}>{running?remaining:'—'}</time>
    {active&&row.canCancel?<button type="button" className="nubi-background-task-control" aria-label={`${row.title} 중지`} title="중지" onClick={()=>backgroundTasks.cancel(row.id)}><Icon name="xClose" size={14}/></button>:!active?<button type="button" className="nubi-background-task-control" aria-label={`${row.title} 기록 닫기`} title="기록 닫기" onClick={()=>backgroundTasks.dismiss(row.id)}><Icon name="xClose" size={14}/></button>:null}
   </li>;
  })}</ol>
  {!visible.length&&<p className="nubi-background-task-empty">{history?'완료 기록 없음':'진행 중인 작업 없음'}</p>}
  {(finished.length>0||pages>1)&&<nav className="nubi-background-task-navigation" aria-label="작업 목록 이동">
   {finished.length>0&&<button type="button" className="nubi-background-task-control" aria-label={history?'진행 작업 보기':'완료 기록 보기'} title={history?'진행 작업 보기':'완료 기록 보기'} aria-pressed={history} onClick={()=>{setHistory(value=>!value);setPage(0);}}><Icon name={history?'list':'clockRewind'} size={14}/></button>}
   {pages>1&&<span className="nubi-background-task-pagination"><button type="button" className="nubi-background-task-control" aria-label="이전 작업 3개" title="이전 작업 3개" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}><Icon name="chevronLeft" size={14}/></button><span aria-live="polite">{currentPage+1}/{pages}</span><button type="button" className="nubi-background-task-control" aria-label="다음 작업 3개" title="다음 작업 3개" disabled={currentPage===pages-1} onClick={()=>setPage(currentPage+1)}><Icon name="chevronRight" size={14}/></button></span>}
  </nav>}
 </section>,document.body)}</>;
}
