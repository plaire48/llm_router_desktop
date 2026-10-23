import React,{useEffect,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {AgentMark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
export const dockObscured=()=>document.hidden||!!document.querySelector('[data-browser-dock-obscured="true"]')||document.documentElement.hasAttribute('data-project-switching')||document.body.hasAttribute('data-nubi-opening')||!!document.querySelector('.desktop-shell[data-pane-resizing="true"]')||[...document.querySelectorAll('[role="dialog"],[aria-modal="true"],[role="menu"],[data-overlay-open="true"]')].some(n=>n.getClientRects().length&&!n.closest('[hidden],[aria-hidden="true"],[inert]'));
// OS window drag comes from WinEvent, never from an HTML link/file drop.
export function BrowserDockIntake({api,enabled=true}){
 const [hover,setHover]=useState(false);
 const [hintBounds,setHintBounds]=useState(null);
 useEffect(()=>{
  if(!enabled||window.nubi.desktop!==true||window.nubi.platform!=='win32')return;let frame=0,last='',active=true,busy=false,again=false;
  const send=async()=>{
   frame=0;if(!active)return;if(busy){again=true;return;}
   const node=document.querySelector('[data-browser-dock-viewport]'),rect=node?.getBoundingClientRect(),exact=!!node&&!!node.getClientRects().length;
   const blocked=dockObscured(),width=Math.min(520,Math.max(320,window.innerWidth*.4));
   const handle=document.querySelector('.desktop-pane-resize')?.getBoundingClientRect(),inset=exact&&handle&&handle.right>rect.left&&handle.left<rect.left+handle.width?Math.max(0,handle.right-rect.left):0;
   const bounds=exact?{x:rect.left+inset,y:rect.top,width:Math.max(0,rect.width-inset),height:rect.height}:{x:Math.max(0,window.innerWidth-width-16),y:104,width:Math.min(width,window.innerWidth-32),height:Math.max(0,window.innerHeight-136)};
   // Use the same measured viewport as the native layout, including a pane
   // that appeared after hover began. No second layout observer is needed.
   if(exact){const next={left:bounds.x+8,top:bounds.y+8,width:Math.max(0,bounds.width-16),height:Math.max(0,bounds.height-16),right:'auto',bottom:'auto'};setHintBounds(previous=>previous&&['left','top','width','height'].every(key=>previous[key]===next[key])?previous:next);}
   const value={action:'dockLayout',bounds,exact,armed:!blocked,visible:exact&&!blocked,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches};
   const encoded=JSON.stringify(value);if(encoded===last)return;last=encoded;busy=true;
   try{await api('browserConnection',value);}catch{last='';}finally{busy=false;if(again){again=false;schedule();}}
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(send);};
  const guard=()=>{if(dockObscured()){cancelAnimationFrame(frame);frame=0;void send();}else schedule();};
  const observer=new MutationObserver(guard);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','aria-hidden','inert','role','aria-modal','data-pane-resizing','data-nubi-opening','data-pane','data-open','data-browser-dock-obscured','class']});observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-project-switching']});
  const size=new ResizeObserver(schedule);size.observe(document.body);
  const media=matchMedia('(prefers-reduced-motion: reduce)');media.addEventListener('change',schedule);
  const close=window.nubi.onHostEvent?.(event=>{if(event.type==='browser_dock_hover')setHover(event.entered);if(['browser_dock_changed','external_browser_changed','external_browser_opened'].includes(event.type)){last='';schedule();if(event.type==='browser_dock_changed')setHover(false);}});
  window.addEventListener('resize',schedule);document.addEventListener('visibilitychange',guard);document.addEventListener('scroll',schedule,true);schedule();
  return()=>{active=false;cancelAnimationFrame(frame);observer.disconnect();size.disconnect();close?.();window.removeEventListener('resize',schedule);document.removeEventListener('visibilitychange',guard);document.removeEventListener('scroll',schedule,true);media.removeEventListener('change',schedule);void api('browserConnection',{action:'dockLayout',bounds:{x:0,y:0,width:0,height:0},visible:false,armed:false}).catch(()=>{});};
 },[api,enabled]);
 return hover?<div className="nubi-browser-drop-hint" data-magnetic="true" style={hintBounds||undefined} role="status"><AgentMark size={24} mood="idle"/><span>놓아서 이 창의 탭 연결하기</span></div>:null;
}
export function NativeBrowserDock({api,status,onError}){
 const phase=status?.phase||'idle',busy=['preparing','attaching'].includes(phase);
 const act=action=>void api('browserConnection',{action}).catch(onError);
 useEffect(()=>{if(!busy)return;const key=event=>{if(event.key==='Escape'){event.preventDefault();act('dockCancel');}};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);},[busy,api]);
 return <section className="nubi-native-browser" data-dock-phase={phase} aria-label="연결한 브라우저 창">
  <header className="nubi-native-browser-bar"><span><AgentMark size={20}/>{phase==='docked'?(status.browserName||'브라우저 창'):phase==='preparing'?'창 확인 중':'브라우저 가져오는 중'}</span><CxButton title={busy?'가져오기 취소 (Esc)':'원래 위치로 꺼내기'} aria-label={busy?'가져오기 취소':'원래 위치로 꺼내기'} onClick={()=>act(busy?'dockCancel':'dockDetach')}><Icon name={busy?'xClose':'arrowRight'} size={16}/>{busy?'취소':'꺼내기'}</CxButton></header>
  <div data-browser-dock-viewport className="nubi-native-browser-viewport">
   {phase!=='docked'&&<div key={status.requestId+phase} className="nubi-browser-arrival" role="status"><span className="nubi-browser-arrival-mark"><AgentMark size={40}/></span><strong>{phase==='preparing'?'열린 브라우저를 확인하고 있어요':'브라우저가 들어오고 있어요'}</strong></div>}
  </div>
 </section>;
}
