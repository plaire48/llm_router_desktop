import React,{useId} from 'react';
import {createCalmLiquidPath} from './calm-liquid-path.mjs';

// Evaluate the reference's two quadratic outlines once. Five affine poses
// keep colour distribution stable and let Chromium composite the motion.
const outlines=[
 createCalmLiquidPath(296,280,210,1.1,.95,0,1,.18),
 createCalmLiquidPath(291,290,210,1.05,1,0,7,.17),
];
export function CalmLiquidScene(){
 const id=useId().replace(/:/g,'');
 return <div className="nubi-liquid-scene" aria-hidden="true" data-liquid-poses="5">{outlines.map((d,index)=><div key={index} className={`nubi-liquid-drop nubi-liquid-drop-${index===0?'primary':'secondary'}`}><svg viewBox="0 0 600 600" focusable="false">
  <defs>
   <linearGradient id={`${id}-colour-${index}`} x1="3%" y1="32.9%" x2="97%" y2="67.1%">
    <stop offset="0" className="nubi-liquid-stop-mint"/><stop offset=".2" className="nubi-liquid-stop-aqua"/><stop offset=".4" className="nubi-liquid-stop-sky"/>
    <stop offset=".6" className="nubi-liquid-stop-periwinkle"/><stop offset=".8" className="nubi-liquid-stop-iris"/><stop offset="1" className="nubi-liquid-stop-lavender"/>
   </linearGradient>
   <radialGradient id={`${id}-light-${index}`} cx="35%" cy="18%" r="65%"><stop offset="0" className="nubi-liquid-stop-light"/><stop offset="1" className="nubi-liquid-stop-light" stopOpacity="0"/></radialGradient>
  </defs>
  <path d={d} fill={`url(#${id}-colour-${index})`}/><path d={d} fill={`url(#${id}-light-${index})`} className="nubi-liquid-sheen"/>
 </svg></div>)}</div>;
}
