import React,{useEffect,useRef,useState} from 'react';
import {CxButton,DetailPanel,Icon} from '@e2e/cx-design-system';
import {mailConnectionErrors} from './mail-connection-error.mjs';
import {durationLabel} from '../runtime/response-timing.mjs';
import {openMailBrowserLogin} from './mail-browser-login.mjs';
import {TaskProgressBar} from './TaskProgressBar.jsx';
import {useBackgroundOperation} from './background-modal.jsx';
import './mail-login-form.css';
// This component only checks the session or reports an error. Credentials belong to the portal page.
export function MailLoginForm({api,onClose}){
 const [stage,setStage]=useState('checking'),[error,setError]=useState(null),[elapsed,setElapsed]=useState(0);
 const alive=useRef(true),pending=useRef(null),close=useRef(onClose);close.current=onClose;
 const background=useBackgroundOperation({title:'메일 연결',cancel:()=>void cancel()});
 function begin(){
  if(pending.current)return pending.current;
  setStage('checking');setError(null);
  const operation=background.run(()=>openMailBrowserLogin(api,{isActive:()=>alive.current,onBrowserOpen:()=>new Promise(resolve=>{
   if(alive.current)setStage('browser');background.update({state:'waiting',label:'브라우저에서 로그인 대기'});requestAnimationFrame(()=>resolve());
  })}));pending.current=operation;
  void operation.then(()=>{if(alive.current)close.current();},e=>{if(!alive.current)return;if(e.message==='mail_cancelled')close.current();else{setError(e.message);setStage('error');}}).finally(()=>{if(pending.current===operation)pending.current=null;});
  return operation;
 }
 useEffect(()=>{alive.current=true;begin();return()=>{alive.current=false;};},[]);
 useEffect(()=>{if(stage!=='checking')return;const start=Date.now();setElapsed(0);const timer=setInterval(()=>setElapsed(Date.now()-start),1000);return()=>clearInterval(timer);},[stage]);
 async function cancel(){const wasAlive=alive.current;alive.current=false;await api('mail',{action:'cancelConnect'}).catch(()=>{});if(wasAlive)close.current();}
 // The parked portal stays mounted while the original browser owns login.
 return <DetailPanel className="deck-dialog nubi-panel nubi-mail-login-dialog" title={<span className="nubi-panel-title"><Icon name="mail" size={18}/>메일 연결</span>} variant="modal" hideHelp onClose={()=>void cancel()} footer={stage==='error'?<>
  <CxButton onClick={()=>void cancel()}>닫기</CxButton>
  <CxButton variant="primary" onClick={()=>void begin()}><Icon name="logIn" size={16}/>다시 로그인</CxButton>
 </>:undefined}>
  <section className="nubi-mail-login-form" aria-label="메일 연결">
   {stage==='checking'?<>
    <div className="nubi-mail-login-message" role="status"><span className="status-spinner"/><strong>로그인 확인 중</strong><time>{durationLabel(elapsed,{keepSeconds:true})}</time></div>
    <TaskProgressBar queue={!!background.id} backgroundTask={background.id} label="메일 로그인 확인"/>
   </>:stage==='browser'?<p role="status">브라우저에서 로그인을 마쳐 주세요.</p>:<div className="nubi-mail-login-message" role="alert"><Icon name="alertCircle" size={16}/><strong>{mailConnectionErrors[error]?.title||'로그인 화면을 열지 못했어요.'}</strong></div>}
  </section>
 </DetailPanel>;
}
