import {DataResetConfirmation} from './DataResetConfirmation.jsx';
import {MailAttachmentStorageOption} from './MailAttachmentStorageOption.jsx';
import {MailStorageSetup} from './MailStorageSetup.jsx';
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
const errors={mail_attachment_analysis_failed:'첨부를 읽지 못해 수집을 완료하지 않았어요. 다시 시도하거나 첨부 원본 보관을 켜 주세요.',mail_identity_invalid:'본인 메일 주소를 확인해 주세요.',mail_input_invalid:'아이디와 비밀번호를 확인해 주세요.',mail_model_missing:'정리할 모델을 먼저 선택해 주세요.',mail_model_changed:'선택한 모델의 연결을 확인해 주세요.',mail_check_wait:'다음 확인 시간이 되면 새 메일을 가져와요.',mail_busy:'진행 중인 작업이 끝난 뒤 다시 눌러 주세요.',mail_not_connected:'메일 계정을 먼저 연결해 주세요.',mail_source_changed:'보관한 원문이 바뀌었어요. 원문을 확인해 주세요.',mail_summary_failed:'메일을 정리하는 중 모델 응답을 받지 못했어요. 다시 시도해 주세요.',mail_storage_failed:'정리한 내용을 저장하지 못했어요. 저장 공간을 확인한 뒤 다시 시도해 주세요.',mail_file_conflict:'정리한 메일 파일이 바뀌어 저장하지 않았어요. 다시 정리해 주세요.',mail_size_limit:'메일이 너무 커요. 11 MB까지 처리할 수 있어요.',mail_missing:'메일을 찾을 수 없어요. 목록을 새로고침해 주세요.'};
Object.assign(errors,{mail_gmail_app_password_required:'Google이 앱 비밀번호를 요구했어요. 계정 비밀번호 대신 앱 비밀번호를 입력해 주세요.',mail_gmail_web_login_required:'Google에서 웹 로그인을 확인해야 해요. Gmail에 로그인한 뒤 다시 연결해 주세요.',mail_gmail_pop_disabled:'Google이 POP 사용이 꺼져 있다고 응답했어요. Gmail의 POP 설정을 확인해 주세요.',mail_gmail_credentials_invalid:'Google이 주소 또는 앱 비밀번호를 거절했어요. 앱 비밀번호를 발급한 계정과 Gmail 주소가 같은지 확인해 주세요.'});
const modelKey=value=>value?`${value.provider}:${value.model}`:'';
Object.assign(errors,Object.fromEntries(Object.entries(mailConnectionErrors).map(([key,value])=>[key,value.title])));
Object.assign(errors,{mail_storage_permission:'로그인은 확인했지만 개인 메일 폴더 권한을 설정하지 못했어요. PC 보안 정책이나 저장 위치 권한을 확인해 주세요.'});
errors.mail_gmail_app_password_format='Google에서 생성한 16자리 앱 비밀번호를 입력해 주세요. 일반 계정 비밀번호로는 연결할 수 없어요.';
const pickerError=message=>notifyWorkspaceToast(message,{error:true});
const sectionTitle=(icon,text)=><span className="nubi-mail-section-title"><span className="nubi-mail-section-icon" aria-hidden="true"><Icon name={icon} size={18}/></span><strong>{text}</strong></span>;
const storageErrors={mail_busy:'메일을 정리하는 중이에요. 끝난 뒤 다시 바꿔 주세요.',mail_storage_not_empty:'비어 있는 폴더를 골라 주세요.',mail_storage_nested:'지금 위치 안이나 바깥 상위 폴더는 고를 수 없어요.',mail_input_invalid:'폴더를 다시 골라 주세요.'};
function MailStorage({api,status,onStatus,busy=false}){
  const [setup,setSetup]=useState(false),[resetOpen,setResetOpen]=useState(false),[saving,setSaving]=useState(false);
  const lock=useRef(false);
  const storageBusy=busy||saving||!status||status.storageMoving||status.checking||['scanning','importing'].includes(status.localImport?.state);
  async function setAttachments(includeAttachments){
    if(lock.current||storageBusy)return;lock.current=true;setSaving(true);
    try{onStatus?.(await api('mail',{action:'confirmStorage',includeAttachments}));}
    catch(error){notifyWorkspaceToast(storageErrors[error.message]||'보관 설정을 저장하지 못했어요. 다시 시도해 주세요.',{error:true});}
    finally{lock.current=false;setSaving(false);}
  }
  return <><section className="nubi-mail-section nubi-mail-collection" aria-label="수집 범위">
    <header className="nubi-mail-section-heading">{sectionTitle('mail','수집 범위')}</header>
    <div className="nubi-mail-collection-evidence"><Icon name="check" size={18}/><div><strong>본문과 첨부 내용</strong><small>위키 작성과 검색에 함께 활용해요.</small></div></div>
    <MailAttachmentStorageOption checked={status?.includeAttachments!==false} disabled={storageBusy} onChange={value=>void setAttachments(value)}/>
    <div className="nubi-mail-collection-location"><FolderMark size={18}/><div><strong>원문 저장 위치</strong><span title={status?.rawRoot}>{status?.rawRoot||'불러오는 중…'}</span></div>
      <CopyButton label="메일 저장 폴더 경로 복사" resetKey={status?.rawRoot} disabled={!status?.rawRoot} onCopy={()=>api('copyMailStoragePath',{kind:'raw'})}/><ActionButton action="edit" iconOnly label="원본 위치 변경" title="원본 위치 변경" disabled={storageBusy||status?.summarizing||status?.readingAttachments} onClick={()=>setSetup(true)}/>
    </div>
    <details className="nubi-mail-storage"><summary><span className="nubi-mail-field-title"><FolderMark size={16}/>데이터 관리</span><Icon name="chevronDown" size={16}/></summary>
    <small className="nubi-mail-collection-note">보관 설정은 새 메일부터 적용해요. 임시보관함과 스팸함은 자동 정리에서 제외해요.</small>
      <dl aria-label="위키 저장 경로"><div className="nubi-mail-storage-row"><dt>정리한 위키</dt><dd><code>{status?.wikiRoot||'불러오는 중…'}</code><CopyButton label="정리한 위키 경로 복사" resetKey={status?.wikiRoot} disabled={!status?.wikiRoot} onCopy={()=>api('copyMailStoragePath',{kind:'wiki'})}/></dd></div></dl>
      <CxButton disabled={!status||status.storageMoving||status.connecting} onClick={()=>setResetOpen(true)}><Icon name="trash" size={16}/>{status?.resetPending?'초기화 다시 시도':'메일 데이터 초기화'}</CxButton>{status?.resetPending&&<p role="status">초기화가 끝나지 않아 수집을 멈췄어요.</p>}
    </details>
  </section>{resetOpen&&<DataResetConfirmation kind="mail" api={api} onClose={()=>setResetOpen(false)} onDone={value=>{onStatus?.(value);setResetOpen(false);if(!window.nubi?.onHostEvent)window.dispatchEvent(new Event('nubi-mail-reset'));notifyWorkspaceToast('메일 데이터를 초기화했어요. 포털이나 폴더에서 다시 가져올 수 있어요.',{success:true});}}/>}{setup&&<MailStorageSetup api={api} status={status} onClose={()=>setSetup(false)} onDone={value=>{onStatus?.(value);setSetup(false);const leftover=value?.storageProgress?.leftover;leftover?notifyWorkspaceToast(`메일 저장 설정을 적용했어요. 이전 위치에 항목 ${leftover}개가 남아 있어 직접 지워 주세요.`,{error:true}):notifyWorkspaceToast('메일 저장 설정을 적용했어요.',{success:true});}}/>}</>;
}

function MailConnectionProgress({onCancel,cancelling,stage}){
 const [started]=useState(()=>Date.now()),[elapsed,setElapsed]=useState(0);
 const cancel=useRef(null);
 useEffect(()=>{const previous=document.activeElement;cancel.current?.focus({preventScroll:true});return()=>{if(previous?.isConnected)previous.focus({preventScroll:true});};},[]);
 useEffect(()=>{const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-started)/1000)),1000);return()=>clearInterval(timer);},[started]);
 const duration=elapsed>=60?`${Math.floor(elapsed/60)}분 ${elapsed%60}초`:`${elapsed}초`;
 return <div className="nubi-mail-connection-overlay"><div className="nubi-mail-connection-progress" role="status"><div className="nubi-preparing-emblem" aria-hidden="true"><span className="nubi-preparing-orbit"/><AgentMark size={30} mood="still"/></div><div><strong>{stage==='advancing'?'로그인 화면으로 이동 중':stage==='confirmation'?'포털 안내 확인 필요':stage==='verifying'?'메일 연결 확인 중':'포털 로그인 확인 중'}</strong><span className="nubi-mail-login-hint">{stage==='advancing'?'세션 만료 안내를 확인하고 있어요.':stage==='confirmation'?'포털 팝업을 확인한 뒤 로그인해 주세요.':stage==='verifying'?'메일함을 확인하고 있어요.':'열린 포털에서 로그인해 주세요.'}</span><time aria-live="off">{duration}</time></div></div><CxButton ref={cancel} disabled={cancelling} onClick={onCancel}><Icon name="xClose" size={16}/>연결 취소</CxButton></div>;
}
export function MailLibrary({api,openWebPage,provider,onProviderLogin,onProviderAction,providerBusy=false,onConnectionBusy}){
  const [status,setStatus]=useState(null),[busy,setBusy]=useState(false),[chosen,setChosen]=useState('');
  const [modelOpen,setModelOpen]=useState(false),[connectionError,setConnectionError]=useState(null);
  const [settingsRevealed,setSettingsRevealed]=useState(false);
  const [cancelling,setCancelling]=useState(false),[pickingFolder,setPickingFolder]=useState(false);
  const modelSummary=useRef(null);
  const alive=useRef(true),pending=useRef(null),lock=useRef(false),cancelledConnect=useRef(false),importing=useRef(false);
  useEffect(()=>{
    alive.current=true;let reading=false;
    const refresh=async()=>{if(reading)return;reading=true;try{const value=await api('mail',{action:'status',includeMessages:false});if(alive.current){setStatus(value);if(value.portal?.connectionState==='connected'&&!value.error)setConnectionError(null);setChosen(current=>current||modelKey(value.destination||value.activeModel));}}catch{if(alive.current)notifyWorkspaceToast('메일 설정을 읽지 못했어요. 다시 열어 주세요.',{error:true});}finally{reading=false;}};
    void refresh();const timer=setInterval(refresh,3000);
    // The login continues in the host while the panel is closed (the app browser tab opens over it); only an explicit cancel stops it (2026-10-14).
    return()=>{alive.current=false;clearInterval(timer);};
  },[api]);
  const models=(status?.catalogs||[]).flatMap(catalog=>catalog.models.map(item=>({provider:catalog.provider,model:item.id,displayName:item.label||item.id,label:`${labels[catalog.provider]||catalog.provider} / ${item.label||item.id}`})));
  const destination=models.find(item=>modelKey(item)===chosen),autoWiki=status?.autoWiki===true;
  const importingFiles=['scanning','importing'].includes(status?.localImport?.state);
  const connectionBusy=busy||pickingFolder||status?.connecting===true;
  const settingsBusy=connectionBusy||importingFiles||status?.storageMoving===true;
  const [connecting,setConnecting]=useState(false);
  const connectionPending=connecting||status?.connecting===true;
  useEffect(()=>{onConnectionBusy?.(connectionPending);},[connectionPending,onConnectionBusy]);
  useEffect(()=>()=>onConnectionBusy?.(false),[onConnectionBusy]);
  useEffect(()=>{if(status?.connected)setSettingsRevealed(true);},[status?.connected]);
  const showSettings=!!status?.resetPending||settingsRevealed||status?.connected||!!status?.destination||status?.counts?.received>0;
  async function act(operation){
    if(lock.current)return;lock.current=true;setBusy(true);
    try{const value=await operation();if(alive.current){setStatus(value);setConnectionError(null);}return value;}
    catch(error){if(alive.current&&!(error.message==='mail_cancelled'&&cancelledConnect.current)){if(error.message==='mail_cancelled')notifyWorkspaceToast('포털 로그인 요청이 중단됐어요. 다시 연결해 주세요.');else if(Object.hasOwn(mailConnectionErrors,error.message))setConnectionError(error.message);else notifyWorkspaceToast(errors[error.message]||('메일 설정을 완료하지 못했어요.'+(/^mail_[a-z_]+$/.test(error.message)?` (${error.message})`:'')),{error:true});}}
    finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  function connectPortal(){window.dispatchEvent(new Event('nubi-mail-login'));}
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
    const value=await api('mail',{action:'status',includeMessages:false});if(alive.current)setStatus(value);return true;
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
  async function importFolder(){if(importing.current||lock.current||settingsBusy)return;importing.current=true;setPickingFolder(true);try{const value=await api('importMailFolder');if(alive.current&&!value.cancelled){setStatus(value);setConnectionError(null);}}catch(error){if(alive.current)notifyWorkspaceToast(errors[error.message]||('메일 파일을 가져오지 못했어요.'+(/^mail_[a-z_]+$/.test(error.message)?` (${error.message})`:'')),{error:true});}finally{importing.current=false;if(alive.current)setPickingFolder(false);}}
  const fileImport=<MailFileImport collapsed={!!status?.connected} card={!status?.connected} progress={status?.localImport} busy={connectionBusy||!status} onChoose={()=>void importFolder()} onResume={()=>act(()=>api('mail',{action:'resumeImport'}))} onCancel={()=>act(()=>api('mail',{action:'cancelImport'}))}/>;
  const failure=Object.hasOwn(mailConnectionErrors,connectionCode)?mailConnectionErrors[connectionCode]:null;
  const loginExpired=connectionCode==='mail_portal_login';
  return <div className="nubi-mail-library nubi-mail-settings" aria-busy={connectionPending}>
    <div className="nubi-mail-settings-content" inert={connectionPending||undefined}>
    <section className="nubi-mail-section" aria-label="메일 계정 설정">
      {status?.connected&&<header className="nubi-mail-section-heading">{sectionTitle('mail','사내 포털 연결됨')}<span className="nubi-mail-connection-actions">{status.encryption?.state==='on'&&status.encryption?.migration?.state==='completed'&&<span className="nubi-mail-lock" role="img" aria-label="메일 원문과 첨부 암호화 저장" title="메일 원문과 첨부 암호화 저장"><LockMark size={16}/></span>}{status.encryption?.state==='unavailable'&&<span className="nubi-mail-lock" data-state="unavailable" role="img" aria-label="이 PC에서는 암호화 저장을 사용할 수 없어요" title="이 PC에서는 암호화 저장을 사용할 수 없어요"><LockMark size={16}/></span>}<ActionButton action="logout" iconOnly label="메일 로그아웃" title="메일 로그아웃" disabled={settingsBusy} onClick={()=>act(()=>api('mail',{action:'disconnect'}))}/></span></header>}
      {!status?.connected&&<div className="nubi-mail-import-options" role="group" aria-label="메일 가져오는 방법">
        <div className="nubi-mail-import-card nubi-mail-portal-card" data-recommended="true"><div className="nubi-mail-import-heading"><span className="nubi-mail-import-icon" aria-hidden="true"><BrowserMark size={20}/></span><div><strong>{loginExpired?'메일 로그인이 만료됐어요':'사내 포털로 연결'}</strong><small>{loginExpired?'저장한 메일은 유지돼요.':'로그인하면 메일과 결재를 가져와요.'}</small></div></div><div className="nubi-mail-import-card-action"><CxButton variant="primary" className="nubi-mail-connect" disabled={settingsBusy||!status} onClick={connectPortal}><Icon name="logIn" size={18}/><span>{loginExpired?'다시 로그인':'포털 로그인'}</span></CxButton></div></div>
        {fileImport}
      </div>}
      {failure&&<details className="nubi-mail-connection-error" key={connectionCode}>
        <summary><Icon name="alertCircle" size={16}/><strong role="status" title={failure.title}>{loginExpired?'연결 정보':failure.title}</strong><Icon name="chevronDown" size={16}/></summary>
        <p>{failure.detail}</p><div className="nubi-mail-error-code"><code>{connectionCode}</code><CopyButton label="연결 오류 복사" text={mailConnectionDiagnostic(connectionCode,status?.protocol||'pop3')}/></div>
      </details>}
    </section>
    {status?.connected&&status.requiresStorageSetup&&<section className="nubi-mail-section"><p>저장 위치를 정하면 메일을 가져와요.</p><CxButton disabled={settingsBusy} onClick={()=>window.dispatchEvent(new Event('nubi-mail-storage'))}><FolderMark size={16}/>저장 위치 선택</CxButton></section>}
    {status?.connected&&fileImport}
    {showSettings&&<><section className="nubi-mail-section nubi-mail-organize" aria-label="자동 정리 설정"><div className="nubi-mail-switch-row"><div>{sectionTitle('sliders','자동 정리')}<small>받은 메일과 보낸 메일을 AI로 정리해요.</small></div>
      <button type="button" role="switch" aria-label="메일 자동 정리" aria-checked={autoWiki} className="nubi-ios-switch" disabled={settingsBusy||!status} onClick={()=>act(()=>api('mail',{action:'setAutoWiki',enabled:!autoWiki,destination:destination?{provider:destination.provider,model:destination.model}:null}))}><span aria-hidden="true"/></button>
    </div></section>
    {status&&<details className="nubi-mail-model-disclosure" open={modelOpen} onToggle={event=>setModelOpen(event.currentTarget.open)}>
      <summary ref={modelSummary} aria-disabled={settingsBusy} onClick={event=>{if(settingsBusy)event.preventDefault();}} aria-label={`정리할 모델: ${selectedModel?`${labels[selectedModel.provider]} ${modelSummaryLabel}${selectedConnected?'':' 연결 필요'}`:modelSummaryLabel}`}>
        <span className="nubi-mail-model-value">{selectedModel?<ProviderIcon provider={selectedModel.provider}/>:<Icon name="list" size={16}/>}<span>{modelSummaryLabel}</span>{selectedModel&&!selectedConnected&&<small>연결 필요</small>}</span><Icon name="chevronDown" size={16}/>
      </summary>
      <ModelSelection embedded autoRefresh={false} title={<span className="visually-hidden">정리할 모델</span>} data={modelData} initialProvider={status.destination?.provider||provider?.provider||'aipro'} showProviderNames providerLabels={labels} disabled={settingsBusy||providerBusy} loading={providerBusy} onProviderSelect={()=>Promise.resolve(true)} onSelect={selectModel} onRefresh={options=>providerAction('refresh',{provider:options?.provider})} onLogin={onProviderLogin} onLogout={selected=>providerAction('disconnect',{provider:selected})} onCancelLogin={()=>providerAction('cancel')} onError={pickerError}/>
    </details>}
    {status?.connected&&autoWiki&&status.watchPaused&&<CxButton disabled={busy||status.checking} onClick={()=>act(()=>api('mail',{action:'resumeWatch'}))}><Icon name="refresh" size={16}/>수집 재개</CxButton>}
    {(status?.counts.attachmentAttention>0||status?.counts.attention>0)&&<CxButton disabled={busy||!autoWiki||status.readingAttachments||status.summarizing} onClick={()=>act(()=>api('mail',{action:'retry'}))}><Icon name="refresh" size={16}/>읽기와 정리 다시 시도</CxButton>}
    <MailStorage api={api} busy={settingsBusy} status={status} onStatus={setStatus}/></>}
    </div>
    {connectionPending&&<MailConnectionProgress onCancel={cancelConnection} cancelling={cancelling} stage={status?.portal?.loginStage||status?.loginStage}/>}
  </div>;
}
