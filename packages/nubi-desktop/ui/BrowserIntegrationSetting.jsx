import React,{useEffect,useRef,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {SettingsSection} from './SettingsSection.jsx';
import {SettingToggle} from './SettingToggle.jsx';
import {externalBrowserMessage} from '../electron-app/external-browser-errors.mjs';

export function BrowserIntegrationSetting({api,onUpdate}){
 const native=window.nubi?.desktop===true,[status,setStatus]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),alive=useRef(true),pending=useRef(false),sequence=useRef(0),updated=useRef(onUpdate);updated.current=onUpdate;
 async function load(){const request=++sequence.current;try{const value=await api('browserConnection',{action:'status'});if(alive.current&&request===sequence.current){setStatus(value);setError('');}}catch{if(alive.current&&request===sequence.current)setError('연동 설정을 불러오지 못했어요. 내부 브라우저는 계속 사용할 수 있어요.');}}
 useEffect(()=>{alive.current=true;if(!native)return()=>{alive.current=false;};void load();const close=window.nubi.onHostEvent?.(event=>{if(event.type==='external_browser_changed'&&!pending.current)void load();});return()=>{alive.current=false;sequence.current++;close?.();};},[api,native]);
 async function change(enabled){if(pending.current)return;pending.current=true;setBusy(true);setError('');const request=++sequence.current;try{const value=await api('browserConnection',{action:'mode',mode:enabled?'external':'internal'});if(alive.current&&request===sequence.current){setStatus(value);updated.current?.(value);}}catch(cause){if(alive.current&&request===sequence.current)setError(externalBrowserMessage(cause.message));}finally{pending.current=false;if(alive.current)setBusy(false);}}
 return <SettingsSection icon="link" title="브라우저"><div aria-busy={busy}><SettingToggle label="외부 브라우저 연동" description={native?(status?.targetBrowser==='samsung'?'삼성브라우저의 로그인과 업무 탭을 그대로 사용해요.':'로그인한 탭의 콘텐츠를 누비에서 보고 직접 조작해요.'):'누비 데스크톱에서 변경할 수 있어요.'} checked={status?.mode==='external'} disabled={!native||!status||busy} onChange={change}/></div>{error&&<p role="alert" className="nubi-muted">{error}</p>}{native&&!status&&error&&<CxButton onClick={()=>void load()}><Icon name="refresh" size={16}/>다시 확인</CxButton>}</SettingsSection>;
}
