import React,{useEffect,useRef,useState} from 'react';
import {CxButton,CxInput,Icon} from '@e2e/cx-design-system';
import {mailConnectionErrors} from './mail-connection-error.mjs';
import './mail-login-form.css';
export function MailLoginForm({api,onClose,checkSession=true,initialError=null}){
 const [stage,setStage]=useState(checkSession?'checking':'ready'),[error,setError]=useState(initialError);
 const form=useRef(null),alive=useRef(true),lock=useRef(false);
 useEffect(()=>{alive.current=true;if(checkSession)void api('mail',{action:'portalSession'}).then(value=>{if(!alive.current)return;if(value.connected){onClose();return;}setStage('ready');}).catch(e=>{if(alive.current){setError(e.message);setStage('ready');}});return()=>{alive.current=false;form.current?.reset();};},[]);
 async function submit(event){
  event.preventDefault();if(lock.current||stage!=='ready')return;lock.current=true;setStage('submitting');setError(null);
  const elements=form.current.elements,payload={action:'portalCredentials',username:elements.namedItem('username').value,password:elements.namedItem('password').value};
  elements.namedItem('password').value='';
  try{await api('mail',payload);if(alive.current)onClose();}catch(e){if(alive.current){setError(e.message);setStage('ready');}}finally{payload.username='';payload.password='';lock.current=false;}
 }
 async function cancel(){if(stage==='submitting')await api('mail',{action:'cancelConnect'}).catch(()=>{});form.current?.reset();onClose();}
 return <section className="nubi-mail-login-form" aria-label="사내 메일 로그인"><header><Icon name="mail" size={18}/><strong>사내 메일 로그인</strong><CxButton aria-label="로그인 닫기" title="로그인 닫기" onClick={()=>void cancel()}><Icon name="xClose" size={16}/></CxButton></header>
  {stage==='checking'?<p role="status"><span className="status-spinner"/>기존 로그인 확인 중</p>:<form ref={form} onSubmit={submit} autoComplete="off">
   <div className="nubi-mail-login-fields"><label>아이디<CxInput name="username" autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={320} disabled={stage==='submitting'}/></label><label>비밀번호<CxInput name="password" type="password" autoComplete="off" required maxLength={4096} disabled={stage==='submitting'}/></label></div>
   {error&&<p role="alert">{mailConnectionErrors[error]?.title||'로그인을 완료하지 못했어요. 연결 상태를 확인해 주세요.'}</p>}
   <footer><small>AI와 대화 기록에 전달하지 않아요.</small><CxButton type="submit" variant="primary" disabled={stage==='submitting'}>{stage==='submitting'?<><span className="status-spinner"/>로그인 중</>:<><Icon name="logIn" size={16}/>로그인</>}</CxButton></footer>
  </form>}
 </section>;
}
