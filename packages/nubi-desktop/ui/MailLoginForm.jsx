import React,{useEffect,useRef,useState} from 'react';
import {CxButton,CxInput,DetailPanel,Icon} from '@e2e/cx-design-system';
import {mailConnectionErrors} from './mail-connection-error.mjs';
import {durationLabel} from '../runtime/response-timing.mjs';
import {BrowserMark,LockMark} from './marks.jsx';
import './mail-login-form.css';
export function MailLoginForm({api,onClose,checkSession=true,initialError=null}){
 const [stage,setStage]=useState(checkSession?'checking':'ready'),[error,setError]=useState(initialError),[elapsed,setElapsed]=useState(0);
 const form=useRef(null),alive=useRef(true),lock=useRef(false),username=useRef(null);
 useEffect(()=>{alive.current=true;if(checkSession)void api('mail',{action:'portalSession'}).then(value=>{if(!alive.current)return;if(value.connected){onClose();return;}setStage('ready');}).catch(e=>{if(alive.current){setError(e.message);setStage('ready');}});return()=>{alive.current=false;form.current?.reset();};},[]);
 useEffect(()=>{if(stage==='ready')username.current?.focus({preventScroll:true});if(!['checking','submitting','browser'].includes(stage))return;const start=Date.now();setElapsed(0);const timer=setInterval(()=>setElapsed(Date.now()-start),1000);return()=>clearInterval(timer);},[stage]);
 async function submit(event){
  event.preventDefault();if(lock.current||stage!=='ready')return;lock.current=true;setStage('submitting');setError(null);
  const elements=form.current.elements,payload={action:'portalCredentials',username:elements.namedItem('username').value,password:elements.namedItem('password').value};
  elements.namedItem('password').value='';
  try{await api('mail',payload);if(alive.current)onClose();}catch(e){if(alive.current){setError(e.message);setStage('ready');}}finally{payload.username='';payload.password='';lock.current=false;}
 }
 async function cancel(){if(stage==='submitting'||stage==='browser')await api('mail',{action:'cancelConnect'}).catch(()=>{});form.current?.reset();onClose();}
 async function openCompanyPage(){if(lock.current)return;lock.current=true;setStage('browser');setError(null);form.current?.reset();try{await api('mail',{action:'portalLogin'});if(alive.current)onClose();}catch(e){if(alive.current){setError(e.message);setStage('ready');}}finally{lock.current=false;}}
 const busy=stage!=='ready';
 const additional=['mail_portal_additional_auth','mail_portal_login_form','mail_portal_secure_login','mail_portal_sso'].includes(error);
 return <DetailPanel className="deck-dialog nubi-panel nubi-mail-login-dialog" title={<span className="nubi-mail-login-title"><Icon name="mail" size={18}/>메일 로그인</span>} variant="modal" hideHelp onClose={()=>void cancel()}>
  <section className="nubi-mail-login-form" aria-label="사내 메일 로그인">
   {stage==='checking'?<p role="status"><span className="status-spinner"/>로그인 확인 중 <time>{durationLabel(elapsed)}</time></p>:<form ref={form} onSubmit={submit} autoComplete="off">
    <div className="nubi-mail-login-fields"><label htmlFor="nubi-mail-username">아이디</label><CxInput ref={username} id="nubi-mail-username" name="username" autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={320} disabled={busy}/><label htmlFor="nubi-mail-password">비밀번호</label><CxInput id="nubi-mail-password" name="password" type="password" autoComplete="off" required maxLength={4096} disabled={busy}/></div>
    {error&&<p role="alert"><Icon name="alertCircle" size={16}/><span>{mailConnectionErrors[error]?.title||'로그인하지 못했어요. 다시 확인해 주세요.'}</span></p>}
    {additional&&<CxButton onClick={()=>void openCompanyPage()}><BrowserMark size={16}/>앱에서 회사 로그인 화면 열기</CxButton>}
    <div className="nubi-mail-login-actions"><small><LockMark size={14}/>비밀번호는 저장하지 않아요.</small><CxButton type="submit" variant="primary" disabled={busy}>{busy?<><span className="status-spinner"/>{stage==='browser'?'추가 인증 중':'로그인 중'}<time>{durationLabel(elapsed)}</time></>:<><Icon name="logIn" size={16}/>로그인</>}</CxButton></div>
   </form>}
  </section>
 </DetailPanel>;
}
