import React,{useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {CxSelect} from './WorkspaceSelect.jsx';
import {FolderMark} from './marks.jsx';
export const desktopMailErrors={mail_desktop_windows:'Windows의 Knox Desktop Message 저장소를 사용해요. 이 PC에서는 메일 파일 폴더를 선택해 주세요.',mail_desktop_config:'Knox 메일 저장 설정을 읽지 못했어요. Desktop Message의 저장 위치를 확인해 주세요.',mail_desktop_storage:'Knox 메일 저장 위치에 접근하지 못했어요. 연결된 드라이브와 읽기 권한을 확인해 주세요.',mail_desktop_not_found:'PC에 저장된 Knox 메일을 찾지 못했어요. Desktop Message에서 메일을 내려받은 뒤 다시 연결해 주세요.',mail_desktop_source_changed:'연결한 Knox 저장소가 바뀌었어요. 저장 위치를 확인한 뒤 다시 연결해 주세요.',mail_desktop_partial:'일부 파일을 읽지 못했어요. 아래 가져오기 내역에서 확인할 수 있어요.',mail_desktop_not_connected:'Knox 메일 저장소를 먼저 연결해 주세요.',mail_desktop_timeout:'저장소 응답이 늦어요. 연결된 드라이브를 확인한 뒤 다시 연결해 주세요.',mail_storage_nested:'Knox 원본과 누비 보관 위치는 서로 다른 폴더를 선택해 주세요.'};
export function KnoxDesktopMail({source,busy,onConnect,onSync}){
 const [selected,setSelected]=useState('');
 const connected=source?.connected===true;
 return <section className="nubi-mail-section nubi-mail-import-card" aria-label="Knox Desktop 메일">
  <div className="nubi-mail-import-heading"><span className="nubi-mail-import-icon" aria-hidden="true"><Icon name="mail" size={20}/></span><div><strong>{connected?'Knox에 저장된 메일':'Knox Desktop에서 가져오기'}</strong><small>{connected?'이 PC에 저장된 메일의 새 파일과 변경분을 확인해요.':'Desktop Message가 PC에 저장한 메일을 읽어요.'}</small></div></div>
  {connected&&<div className="nubi-mail-collection-location"><div><strong>{source.label}</strong><span title={source.directory}>{source.directory}</span></div></div>}
  {!!source?.profiles?.length&&source.requiresSelection&&<CxSelect aria-label="Knox 메일 저장소 선택" value={selected} disabled={busy} onChange={event=>setSelected(event.target.value)} options={[{value:'',label:'가져올 저장소 선택'},...source.profiles.map(profile=>({value:profile.id,label:profile.label}))]}/>}
  {source?.error&&<p role="status">{desktopMailErrors[source.error]||'메일 저장소를 확인하지 못했어요. 다시 연결해 주세요.'}</p>}
  <div className="nubi-mail-import-card-action">{connected?<CxButton disabled={busy||source.checking} onClick={onSync}><Icon name="refresh" size={16}/>{source.checking?'변경분 확인 중':'새 파일 확인'}</CxButton>:<CxButton variant="primary" disabled={busy||(source?.requiresSelection&&!selected)} onClick={()=>onConnect(selected||undefined)}><FolderMark size={16}/>{source?.requiresSelection?'선택한 저장소 연결':'저장된 메일 연결'}</CxButton>}</div>
  <small>Knox에 내려받은 메일만 포함돼요. 원문과 첨부는 복사하지 않고 Knox에서 읽어요. 원본이 없으면 열 수 없어요.</small>
 </section>;
}
