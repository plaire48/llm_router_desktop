import React,{useState} from 'react';
import {PageNumbers} from './PageNumbers.jsx';

const pageSize=10;
export function useSkillPagination(items,key){
  const [position,setPosition]=useState({key,page:1});
  const pages=Math.max(1,Math.ceil(items.length/pageSize));
  const page=position.key===key?Math.min(position.page,pages):1;
  // Clamp the saved position too, so removing the final row cannot resurrect
  // an out-of-range page when the catalog grows again.
  if(position.key!==key||position.page!==page)setPosition({key,page});
  const start=(page-1)*pageSize;
  return {page,pages,total:items.length,start,items:items.slice(start,start+pageSize),go:next=>setPosition({key,page:Math.max(1,Math.min(pages,next))})};
}
// The numbered pager of E2E Report (user request 2026-10-14), shared with the mail and wiki lists.
export function SkillPagination({pagination:p,label,busy}){
  if(p.pages<=1)return null;
  return <PageNumbers page={p.page} totalPages={p.pages} disabled={busy} label={label} onPage={next=>p.go(next)}/>;
}
