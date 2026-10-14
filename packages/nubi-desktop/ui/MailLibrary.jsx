import {MailFileImport} from './MailFileImport.jsx';
import {DESKTOP_PROVIDER_LABELS} from './provider-labels.mjs';
import {CopyButton} from '../../../extensions/aipro-chat/src/CopyButton.jsx';
import React,{useEffect,useRef,useState} from 'react';
import {CxButton, CxInput, Icon} from '@e2e/cx-design-system';
import {CxSelect} from './WorkspaceSelect.jsx';
import {WorkspaceAction as ActionButton} from './WorkspaceAction.jsx';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';
import {BrowserMark,PersonMark,FolderMark,LockMark} from './marks.jsx';
import {ModelSelection,ProviderIcon} from '../../../extensions/aipro-chat/src/ChatControls.jsx';
import {mailConnectionErrors,mailConnectionDiagnostic} from './mail-connection-error.mjs';
import {AgentMark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import './nubi-preparing.css';
import './mail-body.css';
const labels=DESKTOP_PROVIDER_LABELS;
const errors={mail_identity_invalid:'본인 메일 주소를 확인해 주세요.',mail_input_invalid:'아이디와 비밀번호를 확인해 주세요.',mail_model_missing:'정리할 모델을 먼저 선택해 주세요.',mail_model_changed:'선택한 모델의 연결을 확인해 주세요.',mail_check_wait:'다음 확인 시간이 되면 새 메일을 가져와요.',mail_busy:'진행 중인 작업이 끝난 뒤 다시 눌러 주세요.',mail_not_connected:'메일 계정을 먼저 연결해 주세요.',mail_source_changed:'보관한 원문이 바뀌었어요. 원문을 확인해 주세요.',mail_summary_failed:'메일을 정리하는 중 모델 응답을 받지 못했어요. 다시 시도해 주세요.',mail_storage_failed:'정리한 내용을 저장하지 못했어요. 저장 공간을 확인한 뒤 다시 시도해 주세요.',mail_file_conflict:'정리한 메일 파일이 바뀌어 저장하지 않았어요. 다시 정리해 주세요.',mail_size_limit:'메일이 너무 커요. 11 MB까지 처리할 수 있어요.',mail_missing:'메일을 찾을 수 없어요. 목록을 새로고침해 주세요.'};
Object.assign(errors,{mail_gmail_app_password_required:'Google이 앱 비밀번호를 요구했어요. 계정 비밀번호 대신 앱 비밀번호를 입력해 주세요.',mail_gmail_web_login_required:'Google에서 웹 로그인을 확인해야 해요. Gmail에 로그인한 뒤 다시 연결해 주세요.',mail_gmail_pop_disabled:'Google이 POP 사용이 꺼져 있다고 응답했어요. Gmail의 POP 설정을 확인해 주세요.',mail_gmail_credentials_invalid:'Google이 주소 또는 앱 비밀번호를 거절했어요. 앱 비밀번호를 발급한 계정과 Gmail 주소가 같은지 확인해 주세요.'});
const modelKey=value=>value?`${value.provider}:${value.model}`:'';
Object.assign(errors,{mail_storage_permission:'로그인은 확인했지만 개인 메일 폴더 권한을 설정하지 못했어요. PC 보안 정책이나 저장 위치 권한을 확인해 주세요.'});
errors.mail_gmail_app_password_format='Google에서 생성한 16자리 앱 비밀번호를 입력해 주세요. 일반 계정 비밀번호로는 연결할 수 없어요.';
const pickerError=message=>notifyWorkspaceToast(message,{error:true});
const sectionTitle=(icon,text)=><span className="nubi-mail-section-title"><span className="nubi-mail-section-icon" aria-hidden="true"><Icon name={icon} size={18}/></span><strong>{text}</strong></span>;
function MailStorage({api,status}){
  const paths=[{kind:'raw',label:'메일과 첨부 원본',path:status?.rawRoot},{kind:'wiki',label:'정리한 위키',path:status?.wikiRoot}];
  return <details className="nubi-mail-storage">
    <summary><span className="nubi-mail-field-title"><FolderMark size={16}/>저장 위치</span><Icon name="chevronDown" size={16}/></summary>
    <dl aria-label="메일 저장 경로">{paths.map(item=><div className="nubi-mail-storage-row" key={item.kind}>
      <dt>{item.label}</dt><dd><code>{item.path||(status?'경로를 확인하지 못했어요.':'불러오는 중…')}</code>
        <CopyButton label={`${item.label} 경로 복사`} resetKey={item.path} disabled={!item.path} onCopy={()=>api('copyMailStoragePath',{kind:item.kind})}/>
      </dd>
    </div>)}</dl>
  </details>;
}
function MailConnectionProgress({onCancel,cancelling}){
 const [started]=useState(()=>Date.now()),[elapsed,setElapsed]=useState(0);
 const cancel=useRef(null);
 useEffect(()=>{const previous=document.activeElement;cancel.current?.focus({preventScroll:true});return()=>{if(previous?.isConnected)previous.focus({preventScroll:true});};},[]);
 useEffect(()=>{const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-started)/1000)),1000);return()=>clearInterval(timer);},[started]);
 const duration=elapsed>=60?`${Math.floor(elapsed/60)}분 ${elapsed%60}초`:`${elapsed}초`;
 return <div className="nubi-mail-connection-overlay"><div className="nubi-mail-connection-progress" role="status"><div className="nubi-preparing-emblem" aria-hidden="true"><span className="nubi-preparing-orbit"/><AgentMark size={30} mood="still"/></div><div><strong>포털 로그인 확인 중</strong><time aria-live="off">진행 {duration}</time></div></div><CxButton ref={cancel} disabled={cancelling} onClick={onCancel}><Icon name="xClose" size={16}/>연결 취소</CxButton></div>;
}
export function MailLibrary({api,openWebPage,provider,onProviderLogin,onProviderAction,providerBusy=false,onConnectionBusy}){
  const [status,setStatus]=useState(null),[busy,setBusy]=useState(false),[chosen,setChosen]=useState('');
  const [modelOpen,setModelOpen]=useState(false),[connectionError,setConnectionError]=useState(null);
  const [settingsRevealed,setSettingsRevealed]=useState(false);
  const [cancelling,setCancelling]=useState(false);
  const modelSummary=useRef(null);
  const alive=useRef(true),pending=useRef(null),lock=useRef(false),cancelledConnect=useRef(false),importing=useRef(false);
  useEffect(()=>{
    alive.current=true;let reading=false;
    const refresh=async()=>{if(reading)return;reading=true;try{const value=await api('mail',{action:'status'});if(alive.current){setStatus(value);setChosen(current=>current||modelKey(value.destination||value.activeModel));}}catch{if(alive.current)notifyWorkspaceToast('메일 설정을 읽지 못했어요. 다시 열어 주세요.',{error:true});}finally{reading=false;}};
    void refresh();const timer=setInterval(refresh,3000);
    // The login continues in the host while the panel is closed (the app browser tab opens over it); only an explicit cancel stops it (2026-10-14).
    return()=>{alive.current=false;clearInterval(timer);};
  },[api]);
  const models=(status?.catalogs||[]).flatMap(catalog=>catalog.models.map(item=>({provider:catalog.provider,model:item.id,displayName:item.label||item.id,label:`${labels[catalog.provider]||catalog.provider} / ${item.label||item.id}`})));
  const destination=models.find(item=>modelKey(item)===chosen),autoWiki=status?.autoWiki===true;
  const connectionBusy=busy||status?.connecting===true;
  const [connecting,setConnecting]=useState(false);
  const connectionPending=connecting||status?.connecting===true;
  useEffect(()=>{onConnectionBusy?.(connectionPending);},[connectionPending,onConnectionBusy]);
  useEffect(()=>()=>onConnectionBusy?.(false),[onConnectionBusy]);
  useEffect(()=>{if(status?.connected)setSettingsRevealed(true);},[status?.connected]);
  const showSettings=settingsRevealed||status?.connected||!!status?.destination||status?.counts?.received>0;
  async function act(operation){
    if(lock.current)return;lock.current=true;setBusy(true);
    try{const value=await operation();if(alive.current){setStatus(value);setConnectionError(null);}return value;}
    catch(error){if(alive.current&&!(error.message==='mail_cancelled'&&cancelledConnect.current)){if(error.message==='mail_cancelled')notifyWorkspaceToast('포털 로그인 요청이 중단됐어요. 다시 연결해 주세요.');else if(Object.hasOwn(mailConnectionErrors,error.message))setConnectionError(error.message);else notifyWorkspaceToast(errors[error.message]||('메일 설정을 완료하지 못했어요.'+(/^mail_[a-z_]+$/.test(error.message)?` (${error.message})`:'')),{error:true});}}
    finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  async function connectPortal(){
    if(connectionBusy)return;setConnecting(true);onConnectionBusy?.(true);setConnectionError(null);cancelledConnect.current=false;
    try{pending.current=crypto.randomUUID();const value=await api('mail',{action:'portalLogin',requestId:pending.current,destination:destination?{provider:destination.provider,model:destination.model}:null});if(alive.current){setStatus(value);setConnectionError(null);}}
    catch(error){if(alive.current&&!(error.message==='mail_cancelled'&&cancelledConnect.current)){if(error.message==='mail_cancelled')notifyWorkspaceToast('포털 로그인 요청이 중단됐어요. 다시 연결해 주세요.');else if(Object.hasOwn(mailConnectionErrors,error.message))setConnectionError(error.message);else notifyWorkspaceToast(errors[error.message]||('메일 설정을 완료하지 못했어요.'+(/^mail_[a-z_]+$/.test(error.message)?` (${error.message})`:'')),{error:true});}}
    finally{pending.current=null;if(alive.current)setConnecting(false);}
  }
  async function cancelConnection(){
    if(cancelling)return;setCancelling(true);
    cancelledConnect.current=true;
    try{const value=await api('mail',{action:'cancelConnect',requestId:pending.current});if(alive.current){setStatus(value);}}
    catch{if(alive.current)notifyWorkspaceToast('연결 취소를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.',{error:true});}
    finally{if(alive.current)setCancelling(false);}
  }
  async function selectModel(name,selectedProvider){
    const item=models.find(item=>item.provider===selectedProvider&&item.model===name);if(!item)return false;
    const value=await act(()=>api('mail',{action:'setModel',destination:{provider:item.provider,model:item.model}}));
    if(value&&alive.current){setChosen(modelKey(item));setModelOpen(false);requestAnimationFrame(()=>modelSummary.current?.focus({preventScroll:true}));}return !!value;
  }
  async function providerAction(action,input={}){
    if(!onProviderAction)return false;
    const result=await onProviderAction(action,input);
    if(result===false)return false;
    const value=await api('mail',{action:'status'});if(alive.current)setStatus(value);return true;
  }
  const modelData={activeProvider:provider?.provider||'aipro',settings:{modelId:''},catalog:{models:[]},
    catalogs:Object.fromEntries((status?.catalogs||[]).map(catalog=>[catalog.provider,{models:catalog.models.map(item=>({...item,name:item.id,displayName:item.label||item.id}))}])),
    selectedModels:status?.destination?{[status.destination.provider]:status.destination.model}:{},
    connections:Object.fromEntries((provider?.providers||[]).map(item=>[item.id,{present:item.connected}])),
    pending:provider?.pending?{provider:provider.pending,phase:provider.pendingPhase||'waiting'}:null,
    report:{provider:provider?.provider,error:provider?.loginError}};
  const selectedModel=status?.destination||destination;
  const selectedCatalogModel=models.find(item=>modelKey(item)===modelKey(selectedModel));
  const selectedConnected=selectedModel&&provider?.providers?.some(item=>item.id===selectedModel.provider&&item.connected);
  const modelSummaryLabel=selectedModel?selectedCatalogModel?.displayName||selectedModel.model:'모델 선택';
  const connectionCode=connectionBusy?null:connectionError||status?.error;
  // The import runs in the worker with its own progress and stop; the dialog must not lock for its duration.
  async function importFolder(){if(importing.current)return;importing.current=true;try{const value=await api('importMailFolder');if(alive.current&&!value.cancelled){setStatus(value);setConnectionError(null);}}catch(error){if(alive.current)notifyWorkspaceToast(errors[error.message]||('메일 파일을 가져오지 못했어요.'+(/^mail_[a-z_]+$/.test(error.message)?` (${error.message})`:'')),{error:true});}finally{importing.current=false;}}
  const fileImport=<MailFileImport card={!status?.connected} progress={status?.localImport} busy={!status} onChoose={()=>void importFolder()} onCancel={()=>act(()=>api('mail',{action:'cancelImport'}))}/>;
  const failure=Object.hasOwn(mailConnectionErrors,connectionCode)?mailConnectionErrors[connectionCode]:null;
  return <div className="nubi-mail-library nubi-mail-settings" aria-busy={connectionPending}>
    <div className="nubi-mail-settings-content" inert={connectionPending||undefined}>
    <section className="nubi-mail-section" aria-label="메일 계정 설정">
      {status?.connected&&<header className="nubi-mail-section-heading">{sectionTitle('mail','사내 포털 연결됨')}{status.encryption?.state==='on'&&<span className="nubi-mail-lock" role="img" aria-label="메일 위키 암호화 저장 켜짐" title="메일 위키 암호화 저장 켜짐"><LockMark size={16}/></span>}{status.encryption?.state==='unavailable'&&<span className="nubi-mail-lock" data-state="unavailable" role="img" aria-label="이 PC에서는 암호화 저장을 사용할 수 없어요" title="이 PC에서는 암호화 저장을 사용할 수 없어요"><LockMark size={16}/></span>}<ActionButton action="logout" iconOnly label="메일 로그아웃" title="메일 로그아웃" disabled={busy} onClick={()=>act(()=>api('mail',{action:'disconnect'}))}/></header>}
      {!status?.connected&&<div className="nubi-mail-import-options" role="group" aria-label="메일 가져오는 방법">
        <div className="nubi-mail-import-card" data-recommended="true"><div className="nubi-mail-import-heading"><span className="nubi-mail-import-icon" aria-hidden="true"><BrowserMark size={22}/></span><div><strong>사내 포털로 연결<span className="nubi-mail-import-badge">추천</span></strong><small>로그인 한 번으로 새 메일과 결재를 자동으로 가져와요.</small></div></div><div className="nubi-mail-import-card-action"><CxButton variant="primary" className="nubi-mail-connect" disabled={connectionBusy||!status} onClick={connectPortal}><Icon name="logIn" size={18}/><span>포털 로그인</span></CxButton></div></div>
        {fileImport}
      </div>}
      {failure&&<details className="nubi-mail-connection-error" key={connectionCode}>
        <summary><Icon name="alertCircle" size={16}/><strong role="status" title={failure.title}>{failure.title}</strong><Icon name="chevronDown" size={16}/></summary>
        <p>{failure.detail}</p><div className="nubi-mail-error-code"><code>{connectionCode}</code><CopyButton label="연결 오류 복사" text={mailConnectionDiagnostic(connectionCode,status?.protocol||'pop3')}/></div>
      </details>}
    </section>
    {status?.connected&&fileImport}
    {showSettings&&<><section className="nubi-mail-section nubi-mail-organize" aria-label="자동 정리 설정"><div className="nubi-mail-switch-row"><div>{sectionTitle('sliders','자동 정리')}<small>받은 메일과 보낸 메일을 AI로 정리해요.</small></div>
      <button type="button" role="switch" aria-label="메일 자동 정리" aria-checked={autoWiki} className="nubi-ios-switch" disabled={connectionBusy||!status} onClick={()=>act(()=>api('mail',{action:'setAutoWiki',enabled:!autoWiki,destination:destination?{provider:destination.provider,model:destination.model}:null}))}><span aria-hidden="true"/></button>
    </div><details className="nubi-mail-help"><summary>수집 범위</summary><p>메일함은 포털에서 가져와요. 임시보관함과 스팸함은 자동 AI 정리에서 제외해요.</p></details></section>
    {status&&<details className="nubi-mail-model-disclosure" open={modelOpen} onToggle={event=>setModelOpen(event.currentTarget.open)}>
      <summary ref={modelSummary} aria-label={`정리할 모델: ${selectedModel?`${labels[selectedModel.provider]} ${modelSummaryLabel}${selectedConnected?'':' 연결 필요'}`:modelSummaryLabel}`}>
        <span className="nubi-mail-model-value">{selectedModel?<ProviderIcon provider={selectedModel.provider}/>:<Icon name="list" size={16}/>}<span>{modelSummaryLabel}</span>{selectedModel&&!selectedConnected&&<small>연결 필요</small>}</span><Icon name="chevronDown" size={16}/>
      </summary>
      <ModelSelection embedded autoRefresh={false} title={<span className="visually-hidden">정리할 모델</span>} data={modelData} initialProvider={status.destination?.provider||provider?.provider||'aipro'} showProviderNames providerLabels={labels} disabled={busy||providerBusy} loading={providerBusy} onProviderSelect={()=>Promise.resolve(true)} onSelect={selectModel} onRefresh={options=>providerAction('refresh',{provider:options?.provider})} onLogin={onProviderLogin} onLogout={selected=>providerAction('disconnect',{provider:selected})} onCancelLogin={()=>providerAction('cancel')} onError={pickerError}/>
    </details>}
    {status?.connected&&autoWiki&&status.watchPaused&&<CxButton disabled={busy||status.checking} onClick={()=>act(()=>api('mail',{action:'resumeWatch'}))}><Icon name="refresh" size={16}/>수집 재개</CxButton>}
    {(status?.counts.attachmentAttention>0||status?.counts.attention>0)&&<CxButton disabled={busy||!autoWiki||status.readingAttachments||status.summarizing} onClick={()=>act(()=>api('mail',{action:'retry'}))}><Icon name="refresh" size={16}/>읽기와 정리 다시 시도</CxButton>}
    <MailStorage api={api} status={status}/></>}
    </div>
    {connectionPending&&<MailConnectionProgress onCancel={cancelConnection} cancelling={cancelling}/>}
  </div>;
}
