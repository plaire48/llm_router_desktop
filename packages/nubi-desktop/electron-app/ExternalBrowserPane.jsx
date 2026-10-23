import React,{useEffect,useRef,useState} from 'react';
import {CxButton,CxInput,Icon} from '@e2e/cx-design-system';
import {AgentMark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import './external-browser.css';
import {NativeBrowserDock} from './BrowserWindowDock.jsx';
import {externalBrowserMessage} from './external-browser-errors.mjs';
export {externalBrowserMessage} from './external-browser-errors.mjs';
export function ExternalBrowserPane({api,visible,obscured=false,status,onUpdate,onError,onBeforeBring,allowWindowDock=false}){
 const [url,setUrl]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const mounted=useRef(true),pending=useRef(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const canDock=allowWindowDock&&status?.dock?.supported===true,canSelect=status?.windowsRequired!==true;
 const act=async work=>{if(pending.current)return;pending.current=true;setBusy(true);setError('');setNotice('');try{const result=await work();if(mounted.current){if(result?.opened)setNotice('페이지를 열었어요.');try{onUpdate(await api('browserConnection',{action:'status'}));}catch{setError('연결 상태를 확인하지 못했어요. 브라우저를 확인한 뒤 다시 확인해 주세요.');}}}catch(cause){if(mounted.current)setError(externalBrowserMessage(cause.message));}finally{pending.current=false;if(mounted.current)setBusy(false);}};
 if(['preparing','attaching','docked','detaching'].includes(status?.dock?.phase))return <div className="nubi-external-browser" data-browser-dock-obscured={obscured||undefined} hidden={!visible}><NativeBrowserDock api={api} status={status.dock} onError={cause=>setError(externalBrowserMessage(cause.message))}/>{error&&<p role="alert">{error}</p>}</div>;
 return <section className="nubi-external-browser" data-browser-dock-viewport hidden={!visible} aria-label="외부 브라우저 연결" aria-busy={busy}>
  <form className="nubi-external-address" onSubmit={event=>{event.preventDefault();void act(()=>api('openWorkspacePage',{url}));}}><CxInput aria-label="열 웹 주소" placeholder="열 웹 주소" value={url} onChange={event=>setUrl(event.target.value)}/><CxButton type="submit" disabled={busy||!url.trim()} aria-label="주소 열기" title="주소 열기"><Icon name="arrowRight" size={17}/></CxButton></form>
  <div className="nubi-external-browser-content">
   <span className="nubi-external-brand"><AgentMark size={44} mood={busy||status?.dock?.phase==='connecting'?'working':'idle'}/></span>
   <h2>{status?.connected?'브라우저와 연결됐어요':'외부 브라우저와 함께 작업하세요'}</h2>
   <p>로그인한 업무 탭을 연결하면 오른쪽에 페이지 콘텐츠만 표시해요. 클릭과 입력은 같은 탭에 전달돼요.</p>
   {notice&&<p className="nubi-external-guide" role="status">{notice}</p>}
   {canDock&&<><CxButton disabled={busy} onClick={()=>void act(()=>{onBeforeBring?.();return api('browserConnection',{action:'dockBring'});})}><Icon name="arrowLeft" size={16}/>브라우저 가져오기</CxButton>
   <small>창 제목 표시줄을 누비 오른쪽에 끌어놓아도 돼요.</small></>}
   {status?.connected?<>
    <div className="nubi-external-tab-list" aria-label="연결한 탭">{status.tabs.map(tab=><CxButton key={tab.id} className="nubi-external-tab" onClick={()=>void act(()=>api('browserConnection',{action:'focus',tabId:tab.id}))}><Icon name="link" size={16}/><span title={tab.title}>{tab.title}</span><Icon name="arrowRight" size={15}/></CxButton>)}</div>
    
    <CxButton disabled={busy} onClick={()=>void act(()=>api('browserConnection',{action:'disconnect'}))}>연결 해제</CxButton>
   </>:<>
    <CxButton disabled={busy||status?.dock?.phase==='connecting'} onClick={()=>void act(()=>api('browserMirror',{action:'connect'}))}>{busy||status?.dock?.phase==='connecting'?<span className="status-spinner" aria-hidden="true"/>:<Icon name="link" size={16}/>} {busy||status?.dock?.phase==='connecting'?'브라우저 연결 중':'브라우저 연결'}</CxButton>
    <small>최근 사용한 업무 탭을 연결해요.{window.nubi.platform==='win32'&&<> 창 제목 표시줄을 누비 오른쪽으로 끌어놓아도 돼요.</>}</small>
    <details><summary>처음 사용하시나요?</summary><p>연결 확장을 한 번 설치하면 다음부터 버튼이나 창 드래그로 바로 연결돼요.</p><ol><li><CxButton disabled={busy} onClick={()=>void act(()=>api('browserConnection',{action:'extensionFolder'}))}>연결 확장 폴더 열기</CxButton></li><li>Chrome 또는 Edge의 확장 관리에서 개발자 모드를 켜고 이 폴더를 불러오세요.</li><li>누비로 돌아와 브라우저 연결을 누르세요.</li></ol></details>
   </>}
   <details><summary>브라우저 설정</summary><div className="nubi-external-preferences">{canSelect&&<CxButton disabled={busy} onClick={()=>void act(()=>api('browserConnection',{action:'selectExecutable'}))}>{status?.configured?'실행 파일 변경':'다른 브라우저 지정'}</CxButton>}<CxButton disabled={busy} onClick={()=>void act(()=>api('browserConnection',{action:'mode',mode:'internal'}))}>내부 브라우저 사용</CxButton></div></details>
   <CxButton disabled={busy} onClick={()=>void act(()=>api('browserConnection',{action:'status'}))}><Icon name="refresh" size={16}/>연결 상태 다시 확인</CxButton>
   {(error||status?.dock?.error)&&<p role="alert" className="nubi-external-error">{error||externalBrowserMessage(status.dock.error)}</p>}
  </div>
 </section>;
}
