import React from 'react';
import {ProgressEstimate} from './ProgressEstimate.jsx';
// Same track, fill and reduced-motion treatment as the Wiki progress surface.
// Omit value when work has no reliable denominator; never estimate completion by time.
export function TaskProgressBar({label,value,estimate}){
 const percent=Number.isFinite(value)?Math.max(0,Math.min(100,value)):null;
 return <><div className={`nubi-progress${percent===null?' is-indeterminate':''}`} data-active={percent!==100} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent??undefined} aria-valuetext={percent===null?'처리 중':`${Math.floor(percent)}%`}><span style={percent===null?undefined:{width:`${percent}%`}}/></div>{estimate&&<ProgressEstimate {...estimate}/>}</>;
}
