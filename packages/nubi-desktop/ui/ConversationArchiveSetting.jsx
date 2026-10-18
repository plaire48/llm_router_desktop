import React,{useEffect,useState} from 'react';
import {SettingsSection,SettingsField} from './SettingsSection.jsx';
import {CxInput,CxButton} from '@e2e/cx-design-system';
export function ConversationArchiveSetting({days=30,onSave}){
 const [value,setValue]=useState(String(days)),[saving,setSaving]=useState(false);
 useEffect(()=>setValue(String(days)),[days]);
 const number=Number(value),valid=value.trim()!==''&&Number.isSafeInteger(number)&&number>=0;
 return <form className="nubi-settings-field" onSubmit={async event=>{event.preventDefault();if(!valid||saving)return;setSaving(true);try{await onSave(number);}finally{setSaving(false);}}}>
  <SettingsSection icon="clockRewind" title="대화 보관"><SettingsField id="nubi-auto-archive" label="사용하지 않은 기간(일)">
  <CxInput aria-label="대화 자동 보관" id="nubi-auto-archive" type="number" min="0" step="1" value={value} disabled={saving} onChange={event=>setValue(event.target.value)} aria-describedby="nubi-auto-archive-help"/></SettingsField>
  <small id="nubi-auto-archive-help" className="nubi-muted">{days===0?'자동 보관을 사용하지 않아요.':`${days}일 동안 쓰지 않은 대화를 보관함으로 옮겨요. 삭제하지 않아요.`} 0을 입력하면 꺼져요.</small>
  <div className="nubi-settings-actions"><CxButton type="submit" disabled={!valid||saving||number===days}>{saving?'저장 중':'저장'}</CxButton></div></SettingsSection>
 </form>;
}
