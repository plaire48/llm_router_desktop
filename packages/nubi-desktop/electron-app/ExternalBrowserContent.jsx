import React,{useEffect,useRef,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {AgentMark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import {externalBrowserMessage} from './external-browser-errors.mjs';
import {mirrorButton,mirrorModifiers,mirrorPoint} from './browser-mirror-input.mjs';
import './external-browser.css';

export function ExternalBrowserContent({api,status,visible,obscured=false,onSettings}){
 const canvas=useRef(null),surface=useRef(null),keyboard=useRef(null),session=useRef(null),frame=useRef(null),generation=useRef(0),pending=useRef(Promise.resolve()),composing=useRef(false),skipInput=useRef(''),click=useRef({count:0});
 const [phase,setPhase]=useState('connecting'),[error,setError]=useState(''),[preedit,setPreedit]=useState(''),[retry,setRetry]=useState(0),[displayed,setDisplayed]=useState(false);
 const tab=status.tabs?.find(value=>value.id===status.active)||status.tabs?.[0];
 const settings=useRef(onSettings);settings.current=onSettings;
 const blocked=()=>document.hidden||!!surface.current?.closest('[hidden],[inert]')||document.documentElement.hasAttribute('data-project-switching')||document.body.hasAttribute('data-nubi-opening')||[...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].some(node=>node.getClientRects().length&&!node.closest('[hidden],[aria-hidden="true"],[inert]'));
 const fail=cause=>{setError(externalBrowserMessage(cause.message));setPhase('error');};
 const call=(action,extra={})=>{
  const binding=session.current;if(!binding)return Promise.resolve();
  const work=async()=>{if(session.current!==binding||blocked())return;return api('browserMirror',{action,...binding,...extra});};
  const task=pending.current.then(work);pending.current=task.catch(cause=>{if(session.current===binding)fail(cause);});return task;
 };
 const input=value=>{void call('input',{input:value}).catch(()=>{});};
 useEffect(()=>{
  let closed=false,active=null,painting=false,lastFrame=0,resizeTimer=0,lastSize='';
  const mine=++generation.current;
  const clear=()=>{frame.current=null;setDisplayed(false);const ctx=canvas.current?.getContext('2d');if(ctx){ctx.clearRect(0,0,canvas.current.width,canvas.current.height);delete canvas.current.dataset.documentId;}};
  const stop=()=>{const old=active;active=null;session.current=null;clear();if(old)void api('browserMirror',{action:'stop',...old}).catch(()=>{});};
  const start=async()=>{
   if(closed||active||!visible||obscured||blocked()||!tab)return;
   const binding={streamId:crypto.randomUUID(),tabId:tab.id,documentId:tab.documentId};active=binding;session.current=binding;lastFrame=0;pending.current=Promise.resolve();setPhase('connecting');setError('');
   const rect=surface.current.getBoundingClientRect(),width=Math.max(100,Math.round(rect.width)),height=Math.max(100,Math.round(rect.height));lastSize=width+':'+height;
   try{await api('browserMirror',{action:'start',...binding,width,height});if(closed||active!==binding)void api('browserMirror',{action:'stop',...binding}).catch(()=>{});}
   catch(cause){if(!closed&&active===binding)fail(cause);}
  };
  const close=window.nubi.onBrowserMirror?.(async event=>{
   if(event.type==='settings'){settings.current?.();return;}
   const binding=active;if(!binding||event.streamId!==binding.streamId)return;
   if(event.type==='stopped'){clear();setPhase('stopped');return;}
   if(event.type==='error'){clear();fail(Error(event.error));return;}
   if(event.type!=='frame'||event.documentId!==binding.documentId||event.sequence<=lastFrame)return;
   lastFrame=event.sequence;
   if(painting)return;
   painting=true;let bitmap;
   try{
    const binary=atob(event.data),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    bitmap=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'}));
    if(closed||active!==binding||generation.current!==mine||blocked())return;
    const node=canvas.current;if(!node)return;
    if(node.width!==bitmap.width||node.height!==bitmap.height){node.width=bitmap.width;node.height=bitmap.height;}
    node.getContext('2d',{alpha:false}).drawImage(bitmap,0,0);node.dataset.documentId=event.documentId;frame.current={viewport:event.viewport,sequence:event.sequence};setDisplayed(true);setPhase('ready');
   }catch{if(!closed&&active===binding)fail(Error('browser_mirror_frame'));}
   finally{bitmap?.close();painting=false;if(active===binding)void api('browserMirror',{action:'ack',...binding,sequence:event.sequence}).catch(()=>{});}
  });
  const guard=()=>{if(blocked()||!visible||obscured)stop();else void start();};
  const changes=new MutationObserver(guard);changes.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','inert','aria-hidden','aria-modal','role','data-nubi-opening']});changes.observe(document.documentElement,{attributes:true,attributeFilter:['data-project-switching']});
  const size=new ResizeObserver(()=>{const rect=surface.current.getBoundingClientRect(),key=Math.max(100,Math.round(rect.width))+':'+Math.max(100,Math.round(rect.height));if(key===lastSize)return;clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(closed)return;stop();void start();},150);});size.observe(surface.current);
  document.addEventListener('visibilitychange',guard);void start();
  return()=>{closed=true;generation.current++;clearTimeout(resizeTimer);size.disconnect();changes.disconnect();document.removeEventListener('visibilitychange',guard);close?.();stop();};
 },[api,tab?.id,tab?.documentId,visible,obscured,retry]);
 useEffect(()=>{
  const node=surface.current;let scheduled=0,wheel=null,move=null;
  const flush=()=>{scheduled=0;if(wheel){input(wheel);wheel=null;}if(move){input(move);move=null;}};
  const wheelEvent=event=>{
   if(!frame.current||blocked())return;const point=mirrorPoint(canvas.current.getBoundingClientRect(),frame.current.viewport,event.clientX,event.clientY);if(!point)return;
   event.preventDefault();const unit=event.deltaMode===1?16:event.deltaMode===2?frame.current.viewport.height:1;
   wheel={kind:'wheel',...point,deltaX:Math.max(-10000,Math.min(10000,(wheel?.deltaX||0)+event.deltaX*unit)),deltaY:Math.max(-10000,Math.min(10000,(wheel?.deltaY||0)+event.deltaY*unit)),modifiers:mirrorModifiers(event)};if(!scheduled)scheduled=requestAnimationFrame(flush);
  };
  const moveEvent=event=>{if(!frame.current||blocked())return;const point=mirrorPoint(canvas.current.getBoundingClientRect(),frame.current.viewport,event.clientX,event.clientY);if(!point)return;move={kind:'mouse',type:'mouseMoved',...point,button:event.buttons&1?'left':'none',buttons:event.buttons,modifiers:mirrorModifiers(event)};if(!scheduled)scheduled=requestAnimationFrame(flush);};
  node.addEventListener('wheel',wheelEvent,{passive:false});node.addEventListener('pointermove',moveEvent);
  return()=>{cancelAnimationFrame(scheduled);node.removeEventListener('wheel',wheelEvent);node.removeEventListener('pointermove',moveEvent);};
 },[api,tab?.id,tab?.documentId]);
 const pointer=(event,type)=>{
  if(!frame.current||blocked()||event.button===2)return;
  const point=mirrorPoint(canvas.current.getBoundingClientRect(),frame.current.viewport,event.clientX,event.clientY)||(type==='mouseReleased'?click.current.point:null);if(!point)return;
  event.preventDefault();if(type==='mousePressed'){const previous=click.current,now=performance.now();click.current={point,time:now,button:event.button,count:previous.button===event.button&&now-previous.time<400&&Math.hypot((previous.point?.x||0)-point.x,(previous.point?.y||0)-point.y)<5?previous.count%3+1:1};keyboard.current?.focus({preventScroll:true});event.currentTarget.setPointerCapture(event.pointerId);}
  if(type==='mouseReleased'&&event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  input({kind:'mouse',type,...point,button:mirrorButton(event.button),buttons:event.buttons,clickCount:click.current.count||1,modifiers:mirrorModifiers(event)});
 };
 const context=event=>{event.preventDefault();if(!frame.current||blocked())return;const point=mirrorPoint(canvas.current.getBoundingClientRect(),frame.current.viewport,event.clientX,event.clientY);if(!point)return;void call('contextMenu',{input:{kind:'context',...point,modifiers:mirrorModifiers(event)},menuX:event.clientX,menuY:event.clientY}).catch(()=>{});};
 const key=(event,type)=>{
  if(!frame.current||composing.current||event.nativeEvent.isComposing||['Process','Dead','Unidentified'].includes(event.key))return;
  if((event.metaKey||event.ctrlKey)&&!event.altKey&&['c','x','v'].includes(event.key.toLowerCase())){event.preventDefault();if(type==='rawKeyDown')void call(({c:'copy',x:'cut',v:'paste'})[event.key.toLowerCase()]).catch(()=>{});return;}
  const printable=event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey;
  if(!printable||type==='keyUp')event.preventDefault();
  input({kind:'key',type,key:event.key,code:event.code,keyCode:event.keyCode,modifiers:mirrorModifiers(event),repeat:event.repeat});
 };
 const text=event=>{if(composing.current||event.nativeEvent.isComposing)return;const value=event.currentTarget.value;event.currentTarget.value='';if(skipInput.current&&skipInput.current===value){skipInput.current='';return;}skipInput.current='';if(value)input({kind:'text',text:value});};
 return <section ref={surface} className="nubi-external-content" data-browser-dock-viewport data-mirror-phase={phase} hidden={!visible} aria-label="연결한 브라우저 콘텐츠" onPointerDown={event=>pointer(event,'mousePressed')} onPointerUp={event=>pointer(event,'mouseReleased')} onPointerCancel={()=>input({kind:'reset'})} onContextMenu={context}>
  <canvas ref={canvas} className="nubi-external-canvas" data-content-ready={displayed||undefined} aria-label={tab?.title||'외부 웹페이지'} style={{visibility:displayed?'visible':'hidden'}}/>
  <textarea ref={keyboard} className="nubi-external-keyboard" aria-label="외부 페이지 키보드 입력" autoComplete="off" autoCorrect="off" spellCheck={false} onKeyDown={event=>key(event,'rawKeyDown')} onKeyUp={event=>key(event,'keyUp')} onInput={text} onBlur={()=>{setPreedit('');input({kind:'reset'});}} onCompositionStart={()=>{composing.current=true;skipInput.current='';}} onCompositionUpdate={event=>setPreedit(event.data)} onCompositionEnd={event=>{composing.current=false;setPreedit('');skipInput.current=event.data;event.currentTarget.value='';if(event.data)input({kind:'text',text:event.data});}}/>
  {preedit&&<span className="nubi-external-preedit" role="status">{preedit}</span>}
  {phase!=='ready'&&<div className="nubi-external-content-state" data-mirror-arrival={phase==='connecting'||undefined}>
   <span className="nubi-browser-arrival-mark"><AgentMark size={40} mood={phase==='connecting'?'working':phase==='error'?'error':'still'}/></span>
   {phase==='connecting'&&<span className="status-spinner" aria-hidden="true"/>}
   <p role="status">{phase==='connecting'?'브라우저 화면을 연결하고 있어요.':phase==='protected'?'로그인은 원래 브라우저에서 완료해 주세요.':error||'브라우저 화면 연결이 멈췄어요.'}</p>
   {phase!=='connecting'&&<div className="nubi-external-actions"><CxButton onClick={event=>{event.stopPropagation();void api('browserConnection',{action:'focus',tabId:tab?.id}).catch(fail);}}><Icon name="arrowRight" size={16}/>브라우저에서 열기</CxButton><CxButton onClick={event=>{event.stopPropagation();setRetry(value=>value+1);}}>다시 연결</CxButton><CxButton onClick={event=>{event.stopPropagation();onSettings?.();}}>연결 설정</CxButton></div>}
  </div>}
 </section>;
}
