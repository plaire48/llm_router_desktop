import React from 'react';
import {Icon} from '@e2e/cx-design-system';
import './page-numbers.css';
// Numbered pages as in E2E Report's table footer: first, ten back, previous, a window of ten numbers, next, ten
// forward, last, and the position (user request 2026-10-14).
export function PageNumbers({page,totalPages,onPage,disabled=false,label='페이지'}){
 const pages=Math.max(1,totalPages||1),current=Math.min(pages,Math.max(1,page||1));
 if(pages<=1)return null;
 const start=Math.floor((current-1)/10)*10+1,numbers=Array.from({length:Math.min(10,pages-start+1)},(_,index)=>start+index);
 const go=target=>{const next=Math.min(pages,Math.max(1,target));if(next!==current&&!disabled)onPage(next);};
 const button=(name,icon,target,hidden=false)=><button type="button" className="nubi-page-step" aria-label={name} title={name} disabled={disabled||hidden} onClick={()=>go(target)}><Icon name={icon} size={15}/></button>;
 return <nav className="nubi-page-numbers" aria-label={`${label} 이동`}>
  {button('첫 페이지','chevronsLeft',1,current===1)}{pages>10&&button('10페이지 앞으로','arrowLeft',current-10,current<=1)}{button('이전 페이지','chevronLeft',current-1,current===1)}
  {numbers.map(number=><button type="button" key={number} className="nubi-page-number" aria-label={`${number} 페이지`} aria-current={number===current?'page':undefined} disabled={disabled} onClick={()=>go(number)}>{number}</button>)}
  {button('다음 페이지','chevronRight',current+1,current===pages)}{pages>10&&button('10페이지 뒤로','arrowRight',current+10,current>=pages)}{button('마지막 페이지','chevronsRight',pages,current===pages)}
  <span className="nubi-page-position">{current} / {pages}</span>
 </nav>;
}
