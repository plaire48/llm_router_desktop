import React from 'react';
import {Icon} from '@e2e/cx-design-system';
export function OfficeCompareButton({active,onChange,disabled}){
 const end=()=>onChange(false);
 return <button type="button" className="nubi-office-icon-button" aria-label="원본 잠깐 보기" title="누르는 동안 원본 보기" aria-pressed={active} disabled={disabled} onPointerDown={e=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);onChange(true);}} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end} onBlur={end} onKeyDown={e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();onChange(true);}if(e.key==='Escape')end();}} onKeyUp={e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();end();}}}><Icon name="eye" size={17}/></button>;
}
export function ChangedText({before='',after='',changed}){
 if(!changed||before===after)return after;let start=0,end=0;const a=Array.from(before),b=Array.from(after);while(start<Math.min(a.length,b.length)&&a[start]===b[start])start++;while(end<Math.min(a.length,b.length)-start&&a[a.length-end-1]===b[b.length-end-1])end++;
 return <>{b.slice(0,start).join('')}<mark className="nubi-office-changed-text">{b.slice(start,b.length-end||undefined).join('')}</mark>{end?b.slice(-end).join(''):''}</>;
}
