import React,{useId,useState} from 'react';
import {CxInput} from '@e2e/cx-design-system';
import {SettingsField,SettingsSection} from './SettingsSection.jsx';
import {formFidelity} from './form-cards-view.mjs';
// Labels edited here are view-only; never included in a request or saved map.
export function FormRegisterCard({registration}){
 const [labels,setLabels]=useState({}),id=useId(),preview=registration.preview||{};
 return <div className="nubi-form-card"><p>{preview.summary||'양식의 칸과 목차를 확인해 주세요.'}</p>
 <p>{formFidelity(preview)}</p>{preview.fillable===false?<p role="status">{preview.notFillable||'저장됨, 채우기 준비 중'}</p>:<SettingsSection icon="file" title="양식의 칸" description="여기서 바꾼 이름은 이 화면에만 표시됩니다. 원본 양식과 저장된 지도는 바뀌지 않습니다.">
 {(preview.slots||[]).map((slot,i)=><SettingsField key={slot.id} id={`${id}-${i}`} label={slot.label||slot.id} description={`${slot.required?'필수':'선택'}${slot.header?.length?' / '+slot.header.join(', '):''}${slot.options?.length?' / 선택 항목: '+slot.options.join(', '):''}`}><CxInput value={labels[slot.id]??slot.label??slot.id} onChange={e=>setLabels(v=>({...v,[slot.id]:e.target.value}))}/></SettingsField>)}
 </SettingsSection>}{preview.sections?.length>0&&<SettingsSection icon="list" title="목차">{preview.sections.map(section=><p key={section.id}>{section.title}{section.needsText?' — 작성할 내용':''}</p>)}</SettingsSection>}
 {preview.notes?.length>0&&<details><summary>작성 안내</summary>{preview.notes.map((note,i)=><p key={i}>{note}</p>)}</details>}{preview.unsure>0&&<p role="status">확인이 필요한 항목 {preview.unsure}개</p>}</div>;
}
