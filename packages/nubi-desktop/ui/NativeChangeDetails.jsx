import {Icon} from '@e2e/cx-design-system';
import React,{useState} from 'react';
import './native-change-details.css';
export function NativeChangeDetails({rows=[]}){
 const [open,setOpen]=useState(false);if(!rows.length)return null;
 return <div className="nubi-office-change-details"><button type="button" aria-label={`변경 내역 ${rows.length}개`} title="변경 내역" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><Icon name="layers" size={16}/><span>{rows.length}</span><Icon name={open?'chevronUp':'chevronDown'} size={15}/></button>{open&&<div aria-label="변경 내역">{rows.map((row,i)=><div key={i}><strong>{row.title}</strong><div><span>이전</span><p>{row.before??'빈 내용'}</p></div><div><span>수정</span><p>{row.after??'빈 내용'}</p></div></div>)}</div>}</div>;
}
