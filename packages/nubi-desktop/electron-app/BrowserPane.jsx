import {BrowserTeachControl} from '../ui/BrowserTeachControl.jsx';
import {networkMessage} from './browser-network-error.cjs';
import {BrowserAuthNotice} from './BrowserAuthNotice.jsx';
import {CopyButton} from '../../../extensions/aipro-chat/src/CopyButton.jsx';
import React,{useEffect,useLayoutEffect,useRef,useState,useImperativeHandle} from 'react';
import {CxButton, CxInput, Icon} from '@e2e/cx-design-system';
import {BrowserMark,StopMark} from '../ui/marks.jsx';
import {ExternalBrowserPane,externalBrowserMessage} from './ExternalBrowserPane.jsx';
const hasOpenDialog=()=>document.documentElement.hasAttribute('data-project-switching')||document.body.hasAttribute('data-nubi-opening')||[...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].some(node=>node.getClientRects().length&&!node.closest('[hidden],[aria-hidden="true"],[inert]'));
export function BrowserPane({api,projectId,visible,obscured=false,onError,onState,controller}) {
 const [configuration,setConfiguration]=useState(window.nubi.desktop===true?null:{mode:'internal',showInternal:true}),inner=useRef(null),owner=useRef(0),alive=useRef(true);
 const refresh=async()=>{const current=++owner.current;try{const next=await api('browserConnection',{action:'status'});if(alive.current&&current===owner.current)setConfiguration(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);}catch(error){if(alive.current&&current===owner.current)onError(Error(externalBrowserMessage(error.message)));}};
 useEffect(()=>{if(window.nubi.desktop!==true)return;alive.current=true;void refresh();const close=window.nubi.onHostEvent?.(event=>{if(['external_browser_changed','external_browser_opened','external_browser_open_failed','browser_dock_changed'].includes(event.type)){void refresh();if(event.type==='external_browser_open_failed')onError(Error(externalBrowserMessage(event.error)));}}),browserClose=window.nubi.onBrowserEvent?.(()=>void refresh());return()=>{alive.current=false;owner.current++;close?.();browserClose?.();};},[api]);
 const [teachOpen,setTeachOpen]=useState(false);
 const external=configuration?.mode==='external'&&!configuration.showInternal;
 useEffect(()=>{if(external)onState?.(configuration);},[configuration,external]);
 useImperativeHandle(controller,()=>({action:async(action,args={})=>{if(!external)return inner.current?.action(action,args);try{const value=await api('browser',{action,...args});onState?.(value);void refresh();}catch(error){onError(Error(externalBrowserMessage(error.message)));}}}),[api,external]);
 const content=external?<ExternalBrowserPane api={api} visible={visible} obscured={obscured||teachOpen} status={configuration} onUpdate={setConfiguration} onError={onError}/>:!configuration?<section className="desktop-browser-empty" hidden={!visible} role="status">브라우저 연결 확인 중</section>:<InternalBrowserPane api={api} visible={visible} obscured={obscured||teachOpen} onError={onError} onState={onState} controller={inner}/>;
 return <div className="nubi-browser-host" hidden={!visible}><BrowserTeachControl api={api} projectId={projectId} visible={visible} onObscured={setTeachOpen}/>{content}</div>;
}
function InternalBrowserPane({api,visible,obscured=false,onError,onState,controller}) {
 const [state,setState]=useState({tabs:[],active:null}),[url,setUrl]=useState(''),[find,setFind]=useState(false),[query,setQuery]=useState('');
 const viewport=useRef(null),addressInput=useRef(null),findInput=useRef(null),editing=useRef(false),errors=useRef(onError),sequence=useRef(0),urlRef=useRef('');errors.current=onError;
 const native=window.nubi.desktop===true,current=state.tabs.find(tab=>tab.id===state.active);
 const update=value=>{setState(previous=>JSON.stringify(previous)===JSON.stringify(value)?previous:value);onState?.(value);const selected=value.tabs.find(tab=>tab.id===value.active);if(!selected){urlRef.current='';editing.current=false;setUrl('');}else if(!editing.current||selected.id!==urlRef.current){urlRef.current=selected.id;setUrl(selected.url==='about:blank'?'':selected.url);}};
 async function action(action,args={}){try{const request=++sequence.current;const value=await api('browser',{action,...args});if(request===sequence.current)update(value);}catch(error){errors.current(error);}}
 useImperativeHandle(controller,()=>({action}),[api]);
 useEffect(()=>window.nubi.onBrowserEvent?.(event=>{if(['opened','changed','closed'].includes(event.type)&&event.state)update(event.state);if(event.type==='focus'){if(event.field==='find')setFind(true);else addressInput.current?.focus();}}),[api]);
 useEffect(()=>{if(find&&visible)findInput.current?.focus();},[find,visible]);
 useEffect(()=>{
  if(!visible||!native)return;
  const key=event=>{
   if(hasOpenDialog())return;
   if(event.key==='Escape'&&find){event.preventDefault();event.stopPropagation();setFind(false);void action('find',{text:''});return;}
   if(!(event.ctrlKey||event.metaKey)||event.altKey)return;
   const value=event.key.toLowerCase();if(!['l','f','r','t','w'].includes(value))return;event.preventDefault();event.stopPropagation();
   if(value==='l')addressInput.current?.focus();else if(value==='f')setFind(true);else void action(({r:'reload',t:'new',w:'close'})[value]);
  };
  window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);
 },[visible,native,find,api]);
 useEffect(()=>{if(!native)return;let alive=true;const request=sequence.current;void api('browser',{action:'status'}).then(value=>{if(alive&&request===sequence.current)update(value);},error=>{if(alive)errors.current(error);});return()=>{alive=false;};},[api,native]);
 useLayoutEffect(()=>{
  if(!native)return;
  const hide=()=>void api('browser',{action:'layout',visible:false}).catch(()=>{});
  // Hidden tabs retain their page/session but do no document-wide layout work.
  if(!visible||obscured||!current||current.url==='about:blank'&&!current.popup){hide();return;}
  const node=viewport.current;let last='',frame=0;
  const updateBounds=()=>{
   frame=0;
   if(document.hidden||hasOpenDialog()||document.querySelector('.desktop-shell[data-pane-resizing="true"]')){if(last!=='hidden'){last='hidden';hide();}return;}
   const rect=node.getBoundingClientRect(),handle=document.querySelector('.desktop-pane-resize')?.getBoundingClientRect(),inset=handle&&handle.width>0&&handle.right>rect.left&&handle.left<rect.left+handle.width?Math.max(0,handle.right-rect.left):0;
   const bounds={x:rect.left+inset,y:rect.top,width:Math.max(0,rect.width-inset),height:rect.height};
   const show=!!node.getClientRects().length,key=JSON.stringify({bounds,show});
   if(key===last)return;last=key;void api('browser',{action:'layout',bounds,visible:show}).catch(()=>{});
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(updateBounds);};
  const guard=()=>{
   // Native web contents must disappear immediately behind a modal, not after a frame.
   if(document.hidden||hasOpenDialog()){cancelAnimationFrame(frame);frame=0;updateBounds();}
   else schedule();
  };
  updateBounds();const size=new ResizeObserver(schedule);size.observe(node);
  const changes=new MutationObserver(guard);changes.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-modal','role','hidden','aria-hidden','inert','data-pane-resizing','data-nubi-opening']});
  changes.observe(document.documentElement,{attributes:true,attributeFilter:['data-project-switching']});
  document.addEventListener('visibilitychange',guard);window.addEventListener('resize',schedule);
  return()=>{cancelAnimationFrame(frame);size.disconnect();changes.disconnect();document.removeEventListener('visibilitychange',guard);window.removeEventListener('resize',schedule);hide();};
 },[api,native,visible,obscured,current?.id,current?.url,current?.popup,current?.authFlow?.failure,find]);
 useEffect(()=>{if(!native||!find)return;const timer=setTimeout(()=>void action('find',{text:query}),200);return()=>clearTimeout(timer);},[query,find,native]);
 if(!native)return <section className="desktop-browser-empty" hidden={!visible}><BrowserMark size={30}/><p>Electron 앱에서 인터넷 브라우저를 사용할 수 있어요.</p></section>;
 const menu=(event,kind)=>void action('menu',{kind,x:event.clientX,y:event.clientY});
 return <section className="desktop-browser" hidden={!visible} aria-label="인터넷 브라우저">
  <form className="desktop-browser-toolbar" onSubmit={event=>{event.preventDefault();editing.current=false;void action('navigate',{url});}}><CxButton type="button" aria-label="뒤로" title="뒤로" disabled={!current?.back} onClick={()=>void action('back')}><Icon name="arrowLeft" size={16}/></CxButton><CxButton type="button" aria-label="앞으로" title="앞으로" disabled={!current?.forward} onClick={()=>void action('forward')}><Icon name="arrowRight" size={16}/></CxButton><CxButton type="button" aria-label={current?.loading?'불러오기 중지':'새로고침'} title={current?.loading?'중지':'새로고침'} onClick={()=>void action(current?.loading?'stop':'reload')}>{current?.loading?<StopMark size={16}/>:<Icon name="refresh" size={16}/>}</CxButton><div className="desktop-browser-address"><BrowserMark size={15}/><CxInput ref={addressInput} aria-label="인터넷 주소 또는 검색어" placeholder="주소 또는 검색어 입력" value={url} onFocus={event=>{editing.current=true;event.target.select();}} onBlur={()=>{editing.current=false;}} onChange={event=>setUrl(event.target.value)}/></div><CxButton type="button" aria-label="페이지에서 찾기" title="페이지에서 찾기" aria-pressed={find} onClick={()=>{setFind(value=>!value);if(find)void action('find',{text:''});}}><Icon name="search" size={16}/></CxButton><CxButton type="button" aria-label="다운로드" title="다운로드" onClick={event=>menu(event,'downloads')}><Icon name="download" size={16}/></CxButton><CxButton type="button" aria-label="브라우저 메뉴" title="브라우저 메뉴" onClick={event=>menu(event,'main')}><Icon name="moreHorizontal" size={16}/></CxButton></form>
  {find&&<div className="desktop-browser-find"><CxInput ref={findInput} aria-label="페이지에서 찾을 텍스트" placeholder="페이지에서 찾기" value={query} onChange={event=>setQuery(event.target.value)}/><small>{state.find?`${state.find.active}/${state.find.matches}`:''}</small><CxButton aria-label="이전 검색 결과" title="이전 검색 결과" onClick={()=>void action('find',{text:query,forward:false})}><Icon name="chevronUp" size={14}/></CxButton><CxButton aria-label="다음 검색 결과" title="다음 검색 결과" onClick={()=>void action('find',{text:query})}><Icon name="chevronDown" size={14}/></CxButton></div>}
  {current?.mailLoginStage&&!current?.authFlow?.failure&&<div className="desktop-browser-login-guide" role="status"><Icon name={current.mailLoginStage==='login'?'logIn':'infoCircle'} size={16}/><span title={current.mailLoginStage==='advancing'?'세션 만료 안내를 확인하고 로그인 화면으로 이동하고 있어요.':current.mailLoginStage==='expired'?'세션이 만료됐어요. 포털 안내의 확인을 누른 뒤 다시 로그인해 주세요.':current.mailLoginStage==='confirmation'?'포털 팝업의 내용을 확인하고 직접 선택해 주세요.':'열린 포털에서 로그인해 주세요. 완료되면 자동으로 연결해요.'}>{current.mailLoginStage==='advancing'?'로그인 화면으로 이동 중':current.mailLoginStage==='expired'?<><strong>세션 만료</strong> 확인을 누르고 다시 로그인해 주세요.</>:current.mailLoginStage==='confirmation'?'포털 팝업을 확인해 주세요.':'열린 포털에서 로그인해 주세요.'}</span></div>}
 {current?.loginCode&&<div className="desktop-browser-login-code"><span>회사 로그인 코드</span><strong>{current.loginCode}</strong><CopyButton label="로그인 코드 복사" resetKey={current.loginCode} onCopy={()=>api('ghesAccount',{operation:'copy'})}/></div>}
  <BrowserAuthNotice flow={current?.authFlow} canReturn={current?.authReturn} onReturn={()=>void action('authReturn')} onCopy={()=>api('browser',{action:'authCopyDiagnostic',id:current.id})}/>
  <CxButton className="nubi-browser-external-switch" title="외부 브라우저" onClick={()=>void api('browserConnection',{action:'mode',mode:'external'}).catch(error=>errors.current(Error(externalBrowserMessage(error.message))))}>외부 브라우저</CxButton>
  <div ref={viewport} className="desktop-browser-viewport">{(!current||current.url==='about:blank'&&!current.popup)&&<div className="desktop-browser-empty"><BrowserMark size={32}/><p>어떤 페이지를 열어볼까요?</p></div>}{current?.error&&<div className="desktop-browser-load-error" role="alert"><BrowserMark size={30}/><strong>페이지를 열지 못했어요</strong><p>{networkMessage(current.networkFailure)||({browser_connection_refused:'개발 서버에 연결하지 못했어요. 터미널에서 서버 실행과 포트를 확인한 뒤 다시 불러와 주세요.',browser_dns_failed:'서버 주소를 찾지 못했어요. 사내망이나 VPN 연결을 확인해 주세요.',browser_offline:'네트워크 연결을 확인해 주세요.',browser_timeout:'서버 응답이 늦어지고 있어요. 잠시 후 다시 시도해 주세요.',browser_certificate_failed:'서버 인증서를 확인하지 못했어요. 사내 인증서와 접속 환경을 확인해 주세요.',browser_process_gone:'이 웹페이지의 실행이 중단됐어요. 다시 불러올 수 있습니다.'})[current.error]||'주소와 네트워크 연결을 확인한 뒤 다시 시도해 주세요.'}</p>{current.networkFailure&&<details className="desktop-browser-network-detail"><summary>연결 오류 상세</summary><div className="desktop-browser-auth-code"><code title={current.networkFailure.netError}>{current.networkFailure.netError||current.error}{Number.isInteger(current.networkFailure.netCode)?` (${current.networkFailure.netCode})`:''}</code><CopyButton label="연결 진단 복사" resetKey={current.networkFailure} onCopy={()=>api('browser',{action:'networkCopyDiagnostic',id:current.id})}/></div><p>{({opening:'새 페이지 요청',saml:'SAML 요청',post:'POST 요청',redirect:'리다이렉트',return:'다음 페이지 요청',page:'페이지 응답'})[current.networkFailure.stage]}</p></details>}<CxButton onClick={()=>void action('reload')}><Icon name="refresh" size={16}/>다시 불러오기</CxButton></div>}</div>
 </section>;
}
