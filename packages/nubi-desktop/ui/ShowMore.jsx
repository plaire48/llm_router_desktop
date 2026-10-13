import React,{useEffect,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
// Long lists inside panels and readers show a first page and grow by one page per press
// (user decision 2026-10-14: paginate or cap with scroll instead of rendering everything).
export function ShowMore({items,step=10,resetKey,children}){
 const [limit,setLimit]=useState(step);
 useEffect(()=>setLimit(step),[step,resetKey]);
 const visible=items.slice(0,limit),remaining=Math.max(0,items.length-visible.length);
 return <>{children(visible)}{remaining>0&&<CxButton className="nubi-show-more" onClick={()=>setLimit(current=>current+step)}><Icon name="chevronDown" size={16}/><span>더 보기</span><small>{remaining}</small></CxButton>}</>;
}
