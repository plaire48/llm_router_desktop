import {useProgressiveList} from './useProgressiveList.js';
import React,{useState,useDeferredValue,useMemo,useId} from 'react';
import {CxButton,CxInput,DetailPanel} from '@e2e/cx-design-system';
import {PanelTitle,SettingsSection,SettingsField} from './SettingsSection.jsx';
import './wiki-scope.css';
// Counts are nonnegative integers; avoid first-use locale initialization on modal open.
const count=value=>String(value).replace(/\B(?=(\d{3})+(?!\d))/g,',');
export function WikiScopeSheet({job,onSelect,onClose}){
 const [selected,setSelected]=useState(()=>new Set(job.scopePlan.selected)),[query,setQuery]=useState(''),[limit,setLimit]=useState(60),[busy,setBusy]=useState(false),[error,setError]=useState(''),id=useId(),search=useDeferredValue(query);
 const rows=useMemo(()=>job.scopePlan.folders.filter(row=>row.path.toLowerCase().includes(search.toLowerCase())),[job.scopePlan.folders,search]);
 const shell=useProgressiveList({id:job.id,end:1,firstEnd:0,batchSize:1}),ready=shell.indices.has(0);
 const admission=useProgressiveList({id:rows,end:ready?Math.min(rows.length,limit):0,firstEnd:ready?Math.min(rows.length,4):0,batchSize:8});
 async function confirm(){if(busy||!selected.size)return;setBusy(true);setError('');try{await onSelect([...selected]);}catch{setError('선택을 반영하지 못했어요. 현재 프로젝트를 확인해 주세요.');setBusy(false);}}
 return <DetailPanel variant="modal" className="deck-dialog nubi-panel nubi-wiki-scope-dialog" title={<PanelTitle icon="layers">먼저 정리할 폴더</PanelTitle>} busy={busy} onClose={onClose} footer={<CxButton variant="primary" disabled={busy||!selected.size||!ready} onClick={()=>void confirm()}>선택한 폴더부터 시작</CxButton>}><div className="nubi-wiki-scope-content" aria-busy={!ready}>{ready&&<SettingsSection icon="layers" title="분석 범위" description="선택한 폴더부터 정리하고 나머지는 이어서 보강합니다."><p role="status">파일 {count(job.scopePlan.total)}개 / 선택한 폴더 {count(selected.size)}개</p><SettingsField id={id} label="폴더 찾기"><CxInput value={query} onChange={event=>{setQuery(event.target.value);setLimit(60);}}/></SettingsField><div className="nubi-wiki-scope-list" aria-label="분석할 폴더" aria-busy={admission.loading} data-admission={admission.loading?'pending':'complete'}>{rows.slice(0,limit).filter((_,index)=>admission.indices.has(index)).map(row=><label key={row.path} className="nubi-wiki-scope-row"><input type="checkbox" checked={selected.has(row.path)} onChange={event=>{const checked=event.target.checked;setSelected(before=>{const next=new Set(before);checked?next.add(row.path):next.delete(row.path);return next;});}}/><span title={row.path}>{row.path==='.'?'프로젝트 최상위':row.path}</span><small>파일 {count(row.files)}개</small></label>)}</div>{rows.length>limit&&<CxButton onClick={()=>setLimit(value=>value+60)}>폴더 더 보기</CxButton>}{!rows.length&&<p>일치하는 폴더가 없어요.</p>}{error&&<p role="alert">{error}</p>}</SettingsSection>}</div></DetailPanel>;
}
