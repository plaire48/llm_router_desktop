import React,{useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {CxSelect} from './WorkspaceSelect.jsx';
export const desktopMailErrors={mail_desktop_windows:'Windows에서 Knox Desktop을 실행한 뒤 연결해 주세요.',mail_desktop_not_found:'Knox Desktop 창을 찾지 못했어요. 앱을 실행하고 메일을 열어 주세요.',mail_desktop_source_changed:'연결한 Knox Desktop 창이 바뀌었어요. 읽을 창을 다시 연결해 주세요.',mail_desktop_not_connected:'Knox Desktop 창을 먼저 연결해 주세요.',mail_desktop_timeout:'Knox Desktop 화면 응답이 늦어요. 앱 상태를 확인한 뒤 다시 읽어 주세요.',mail_desktop_uia_reconnect:'기존 파일 연결 대신 Knox Desktop 창을 연결해 주세요. 보관한 메일은 유지됩니다.',mail_desktop_uia_unavailable:'Knox Desktop 화면을 읽지 못했어요. 앱과 누비의 실행 권한을 확인해 주세요.',mail_desktop_uia_body:'메일 제목, 보낸 사람과 본문을 읽지 못했어요. Knox Desktop에서 메일 본문을 열어 주세요.',mail_desktop_uia_ambiguous:'메일 본문을 하나로 구분하지 못했어요. 읽을 메일 창만 열고 다시 확인해 주세요.',mail_desktop_uia_limit:'화면의 읽기 범위를 넘었어요. 메일 상세 창을 열고 다시 읽어 주세요.'};
export function KnoxDesktopMail({source,busy,onConnect,onSync}){
 const [selected,setSelected]=useState(''),connected=source?.connected===true;
 return <section className="nubi-mail-section nubi-mail-import-card" aria-label="Knox Desktop 메일">
  <div className="nubi-mail-import-heading"><span className="nubi-mail-import-icon" aria-hidden="true"><Icon name="mail" size={20}/></span><div><strong>{connected?'Knox Desktop에서 읽기':'Knox Desktop 연결'}</strong><small>Knox Desktop에 열린 메일의 제목, 보낸 사람과 본문을 읽어요.</small></div></div>
  {connected&&<div className="nubi-mail-collection-location"><div><strong>연결한 창</strong><span title={source.label}>{source.label}</span></div></div>}
  {!!source?.profiles?.length&&source.requiresSelection&&<CxSelect aria-label="Knox Desktop 창 선택" value={selected} disabled={busy} onChange={event=>setSelected(event.target.value)} options={[{value:'',label:'읽을 창 선택'},...source.profiles.map(profile=>({value:profile.id,label:profile.label}))]}/>}
  {source?.error&&<p role="status">{desktopMailErrors[source.error]||'Knox Desktop 연결을 확인하지 못했어요. 다시 연결해 주세요.'}</p>}
  {source?.supported===false&&!source.error&&<p role="status">Windows에서 Knox Desktop을 실행한 뒤 연결해 주세요.</p>}
  <div className="nubi-mail-import-card-action">{connected?<CxButton disabled={busy||source.checking} onClick={onSync}><Icon name="refresh" size={16}/>{source.checking?'화면 읽는 중':'열린 메일 읽기'}</CxButton>:<CxButton variant="primary" disabled={busy||source?.supported===false||(source?.requiresSelection&&!selected)} onClick={()=>onConnect(selected||undefined)}><Icon name="link" size={16}/>{source?.requiresSelection?'선택한 창 연결':'Knox Desktop에 연결'}</CxButton>}</div>
  <small>자동 정리가 켜져 있으면 열린 메일을 5분마다 확인해요. 전체 메일함과 첨부 파일을 읽은 것으로 처리하지 않아요.</small>
  {!connected&&source?.rawRoot&&<div className="nubi-mail-collection-location"><div><strong>원문 저장 위치</strong><span title={source.rawRoot}>{source.rawRoot}</span></div></div>}
 </section>;
}
