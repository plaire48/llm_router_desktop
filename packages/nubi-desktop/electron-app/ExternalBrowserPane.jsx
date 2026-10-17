import React,{useEffect,useRef,useState} from 'react';
import {CxButton,CxInput,Icon} from '@e2e/cx-design-system';
import {AgentMark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import './external-browser.css';
import {NativeBrowserDock} from './BrowserWindowDock.jsx';
export const externalBrowserMessage=code=>({
 dock_browser_missing:'열린 브라우저가 없어요. 웹 주소를 입력하면 기본 브라우저로 열 수 있어요.',browser_automation_unavailable:'브라우저 화면은 가져왔어요. 이 창의 웹 조작 기능은 아직 준비되지 않았어요.',dock_restore_unconfirmed:'원래 창 위치를 확인하지 못했어요. 작업 표시줄에서 브라우저를 확인해 주세요.',dock_restore_required:'창 위치를 복구하지 못했어요. 작업 표시줄에서 브라우저 상태를 확인해 주세요.',dock_window_mismatch:'끌어놓은 창과 연결된 창이 달라요. 이 창의 누비 확장을 먼저 연결해 주세요.',dock_viewport_unavailable:'브라우저 영역을 표시한 뒤 다시 가져와 주세요.',dock_bounds_unconfirmed:'창 크기를 확인하지 못해 원래 위치로 돌려놓았어요. 브라우저 영역을 넓혀 주세요.',dock_cancelled:'브라우저 가져오기를 취소했어요.',dock_preview_interrupted:'누비 창으로 돌아온 뒤 브라우저를 다시 가져와 주세요.',dock_helper_unavailable:'브라우저 도킹 도구를 실행하지 못했어요.',dock_result_unconfirmed:'연결 결과를 확인하지 못했어요. 창 위치를 확인해 주세요.',external_browser_windows_required:'외부 브라우저 연결은 Windows에서 사용할 수 있어요.',external_browser_setup_required:'외부 브라우저 실행 파일을 선택해 주세요.',external_browser_connection_required:'열린 업무 탭에서 누비 연결 확장을 연결해 주세요.',external_browser_result_unconfirmed:'브라우저 응답을 확인하지 못했어요. 실행한 작업의 결과를 확인해 주세요.',external_browser_portal_permission_required:'브라우저의 누비 확장에서 현재 포털의 메일 읽기를 허용해 주세요.',external_browser_launch_failed:'선택한 외부 브라우저를 실행하지 못했어요. 실행 파일을 다시 선택해 주세요.',mail_browser_busy:'메일 수집을 연결 해제한 뒤 브라우저를 변경해 주세요.',browser_desktop_only:'누비 데스크톱에서 브라우저를 연결해 주세요.'
})[code]||'브라우저 연결을 확인하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.';
export function ExternalBrowserPane({api,visible,obscured=false,status,onUpdate,onError}){
 const [url,setUrl]=useState(''),[busy,setBusy]=useState(false),[copied,setCopied]=useState(false),[error,setError]=useState('');
 const mounted=useRef(true),pending=useRef(false);
 useEffect(()=>()=>{mounted.current=false;},[]);
 const act=async work=>{if(pending.current)return;pending.current=true;setBusy(true);setError('');try{await work();if(mounted.current)onUpdate(await api('browserConnection',{action:'status'}));}catch(cause){if(mounted.current)setError(externalBrowserMessage(cause.message));}finally{pending.current=false;if(mounted.current)setBusy(false);}};
 if(['preparing','attaching','docked','detaching'].includes(status?.dock?.phase))return <div className="nubi-external-browser" data-browser-dock-obscured={obscured||undefined} hidden={!visible}><NativeBrowserDock api={api} status={status.dock} onError={cause=>setError(externalBrowserMessage(cause.message))}/>{error&&<p role="alert">{error}</p>}</div>;
 return <section className="nubi-external-browser" hidden={!visible} aria-label="외부 브라우저 연결" aria-busy={busy}>
  <form className="nubi-external-address" onSubmit={event=>{event.preventDefault();void act(()=>api('openWorkspacePage',{url}));}}><CxInput aria-label="외부 브라우저에서 열 주소" placeholder="외부 브라우저에서 열 주소" value={url} onChange={event=>setUrl(event.target.value)}/><CxButton type="submit" disabled={busy||!url.trim()} aria-label="외부 브라우저에서 열기" title="외부 브라우저에서 열기"><Icon name="arrowRight" size={17}/></CxButton></form>
  <div className="nubi-external-browser-content">
   <span className="nubi-external-brand"><AgentMark size={44} mood="idle"/></span>
   <h2>{status?.connected?'브라우저와 연결됐어요':'외부 브라우저와 함께 작업하세요'}</h2>
   <p>{status?.connected?'열린 탭의 로그인 상태로 누비에 작업을 요청하세요.':'사용 중인 브라우저를 바로 가져와요. 주소창과 탭은 그대로 유지해요.'}</p>
   <CxButton disabled={busy||!status?.dock?.supported} onClick={()=>void act(()=>api('browserConnection',{action:'dockBring'}))}><Icon name="arrowLeft" size={16}/>브라우저 가져오기</CxButton>
   <small>{status?.dock?.supported?'창 제목 표시줄을 누비 오른쪽에 끌어놓아도 돼요.':'창 전체 도킹은 Windows 누비 데스크톱에서 사용할 수 있어요.'}</small>
   {status?.connected?<>
    <div className="nubi-external-tab-list" aria-label="연결한 탭">{status.tabs.map(tab=><CxButton key={tab.id} className="nubi-external-tab" onClick={()=>void act(()=>api('browserConnection',{action:'focus',tabId:tab.id}))}><Icon name="link" size={16}/><span title={tab.title}>{tab.title}</span><Icon name="arrowRight" size={15}/></CxButton>)}</div>
    
    <CxButton disabled={busy} onClick={()=>void act(()=>api('browserConnection',{action:'disconnect'}))}>연결 해제</CxButton>
   </>:<>
    <details><summary>웹 자동화 연결</summary><p>Chrome 계열 브라우저의 웹 조작이 필요할 때 연결할 수 있어요. 창 가져오기에는 필요하지 않아요.</p><div className="nubi-external-actions"><CxButton disabled={busy} onClick={()=>void act(async()=>{await api('browserConnection',{action:'copyPair'});setCopied(true);})}><Icon name={copied?'check':'copy01'} size={16}/>{copied?'연결 코드 다시 복사':'연결 코드 복사'}</CxButton></div>
    {copied&&<p className="nubi-external-guide" role="status">브라우저에서 누비 연결 확장을 열어 붙여넣으세요. 코드는 5분 동안 한 번 사용할 수 있어요.</p>}
    <ol><li><CxButton disabled={busy} onClick={()=>void act(()=>api('browserConnection',{action:'extensionFolder'}))}>연결 확장 폴더 열기</CxButton></li><li>외부 브라우저 확장 관리에서 개발자 모드를 켜고 이 폴더를 불러오세요.</li><li>연결할 업무 탭에서 누비 아이콘을 눌러 코드를 붙여넣으세요.</li></ol><p>메일은 포털 탭에서 확장의 메일 읽기를 허용한 뒤 누비 메일에서 연결하세요.</p></details>
   </>}
   <details><summary>브라우저 설정</summary><div className="nubi-external-preferences"><CxButton disabled={busy} onClick={()=>void act(()=>api('browserConnection',{action:'selectExecutable'}))}>{status?.configured?'실행 파일 변경':'다른 브라우저 지정'}</CxButton><CxButton disabled={busy} onClick={()=>void act(()=>api('browserConnection',{action:'mode',mode:'internal'}))}>내부 브라우저 사용</CxButton></div></details>
   {(error||status?.dock?.error)&&<p role="alert" className="nubi-external-error">{error||externalBrowserMessage(status.dock.error)}</p>}
  </div>
 </section>;
}
