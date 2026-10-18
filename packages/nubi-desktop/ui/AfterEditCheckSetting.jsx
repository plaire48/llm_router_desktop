import React,{useEffect,useState} from 'react';
import {CxButton,CxInput,CxSelect} from '@e2e/cx-design-system';

export function AfterEditCheckSetting({setting,profiles=[],defaultShell='',disabled=false,onSave}){
 const [script,setScript]=useState(setting?.script||''),[profile,setProfile]=useState(setting?.profile||defaultShell),[saving,setSaving]=useState(false);
 useEffect(()=>{setScript(setting?.script||'');setProfile(setting?.profile||defaultShell);},[setting?.script,setting?.profile,defaultShell]);
 const changed=script.trim()!==(setting?.script||'')||!!script.trim()&&profile!==setting?.profile;
 const valid=script.length<=16000&&(!script.trim()||profile===defaultShell&&profiles.some(p=>p.id===profile));
 return <form className="nubi-settings-field" onSubmit={async event=>{event.preventDefault();if(!changed||!valid||disabled||saving)return;setSaving(true);try{await onSave({profile,script});}finally{setSaving(false);}}}>
  <label htmlFor="nubi-after-edit-script">편집 뒤 자동 검사</label>
  <CxSelect aria-label="편집 뒤 검사 셸" value={profile} disabled={disabled||saving} onChange={event=>setProfile(event.target.value)}>{profiles.map(p=><option key={p.id} value={p.id} disabled={p.id!==defaultShell}>{p.label}</option>)}</CxSelect>
  <CxInput id="nubi-after-edit-script" value={script} disabled={disabled||saving} maxLength={16000} placeholder="예: npm test" onChange={event=>setScript(event.target.value)} aria-describedby="nubi-after-edit-help"/>
  <small id="nubi-after-edit-help" className="nubi-muted">반영 뒤 기본 터미널에서 실행해요. 기존 승인 설정을 따르며, 비워서 저장하면 꺼져요.</small>
  <CxButton type="submit" disabled={!changed||!valid||disabled||saving}>{saving?'저장 중':'저장'}</CxButton>
 </form>;
}
