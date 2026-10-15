import React,{useEffect,useRef,useState} from 'react';
import {CxButton,DetailPanel,Icon} from '@e2e/cx-design-system';
import {mailConnectionErrors} from './mail-connection-error.mjs';
import {durationLabel} from '../runtime/response-timing.mjs';
import {openMailBrowserLogin} from './mail-browser-login.mjs';
import './mail-login-form.css';
// This component only checks the session or reports an error. Credentials belong to the portal page.
export function MailLoginForm({api,onClose}){
 const [stage,setStage]=useState('checking'),[error,setError]=useState(null),[elapsed,setElapsed]=useState(0);
 const alive=useRef(true),pending=useRef(null),close=useRef(onClose);close.current=onClose;
 function begin(){
  if(pending.current)return pending.current;
  setStage('checking');setError(null);
  const operation=openMailBrowserLogin(api,{isActive:()=>alive.current,onBrowserOpen:()=>new Promise(resolve=>{
   if(alive.current)setStage('browser');requestAnimationFrame(()=>resolve());
  })});pending.current=operation;
  void operation.then(()=>{if(alive.current)close.current();},e=>{if(!alive.current)return;if(e.message==='mail_cancelled')close.current();else{setError(e.message);setStage('error');}}).finally(()=>{if(pending.current===operation)pending.current=null;});
  return operation;
 }
 useEffect(()=>{alive.current=true;begin();return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(stage!=='checking')return;const start=Date.now();setElapsed(0);const timer=setInterval(()=>setElapsed(Date.now()-start),1000);return()=>clearInterval(timer);},[stage]);
 async function cancel(){alive.current=false;await api('mail',{action:'cancelConnect'}).catch(()=>{});close.current();}
 // Remove the overlay before the original portal tab opens, so the person can type directly in that page.
 if(stage==='browser')return null;
 return <DetailPanel className="deck-dialog nubi-panel nubi-mail-login-dialog" title={<span className="nubi-mail-login-title"><Icon name="mail" size={18}/>메일 연결</span>} variant="modal" hideHelp onClose={()=>void cancel()}>
  <section className="nubi-mail-login-form" aria-label="메일 연결">
   {stage==='checking'?<p role="status"><span className="status-spinner"/>로그인 확인 중 <time>{durationLabel(elapsed)}</time></p>:<>
    <p role="alert"><Icon name="alertCircle" size={16}/><span>{mailConnectionErrors[error]?.title||'로그인 화면을 열지 못했어요. 다시 시도해 주세요.'}</span></p>
    <CxButton variant="primary" onClick={()=>void begin()}><Icon name="logIn" size={16}/>다시 로그인</CxButton>
   </>}
  </section>
 </DetailPanel>;
}
