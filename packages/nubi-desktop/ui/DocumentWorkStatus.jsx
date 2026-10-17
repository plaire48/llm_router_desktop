import React from 'react';
import {Icon} from '@e2e/cx-design-system';
import {documentWorkStatuses} from './document-work-status.mjs';
import './document-work-status.css';
export function DocumentWorkStatus({task}){
 const rows=documentWorkStatuses(task),comparisons=task?.documentComparisons||[];
 if(!rows.length&&!comparisons.length)return null;
 return <section className="nubi-document-work-status" aria-label="문서 작업 결과">
  {rows.map((row,i)=><div key={i} data-attention={row.attention||undefined}><Icon name="file" size={16}/><span><strong>{row.title}</strong><span>{row.status} / {row.save}</span></span></div>)}
  {!!comparisons.length&&<details><summary>문서 수치 대조 {comparisons.length}건{comparisons.some(c=>c.status==='mismatch')?' / 불일치 있음':''}</summary><p>기록된 범위의 숫자만 대조했습니다. 단위와 의미는 별도 확인이 필요합니다.</p>{comparisons.map((c,i)=><div key={i}><strong>{c.label}: {c.status==='matched'?'수치 일치':'수치 불일치'}</strong><ul>{c.references.map((r,j)=><li key={j}>{r.title}: {r.literal} <small>문자 {r.start+1}–{r.end}</small></li>)}</ul></div>)}</details>}
 </section>;
}
