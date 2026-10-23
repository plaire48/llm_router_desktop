import React,{useLayoutEffect,useRef} from 'react';
import {ProgressEstimate} from './ProgressEstimate.jsx';
import {bindModalProgress,updateModalProgress} from './background-modal.jsx';
// One track for pages, startup and body-portalled dialogs. Pending activity is
// an unnumbered visual fill, never a time-derived completion percentage.
export function TaskProgressBar({label,value,max=100,valueText,active=true,className='',estimate,backgroundTask,queue=true}){
 const node=useRef(null);
 const maximum=Number.isFinite(max)&&max>0?max:100;
 const current=Number.isFinite(value)?Math.max(0,Math.min(maximum,value)):null;
 const percent=current===null?null:current/maximum*100;
 const phase=estimate?.identity||label;
 useLayoutEffect(()=>queue?bindModalProgress(node.current,{id:backgroundTask,label,value,max:maximum,phase,active}):undefined,[backgroundTask,queue,active]);
 useLayoutEffect(()=>{if(queue)updateModalProgress(node.current,{label,value:current,max:maximum,phase});},[label,current,maximum,phase,queue]);
 return <><div ref={node} className={`nubi-progress${percent===null?' is-indeterminate':''}${className?' '+className:''}`} data-active={active&&percent!==100} data-progress-mode={percent===null?'pending':'measured'} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={current??undefined} aria-valuetext={valueText||(percent===null?'진행률 확인 중':`${Math.floor(percent)}%`)}><span style={percent===null?undefined:{transform:`scaleX(${percent/100})`}}/></div>{estimate&&<ProgressEstimate active={active} {...estimate}/>}</>;
}
