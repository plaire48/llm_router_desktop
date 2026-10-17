import {CxSelect} from './CxSelect';
import { ActionButton, ActionLink } from './ActionButton';
import {useFeedback, ToastNotice} from './Toast';
import React, { lazy, Suspense, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HelpTrigger } from './HelpTrigger';
import {CommunityStatus} from './CommunityStatus';
import HelpPanel from './HelpPanel';
import { rememberInquiryReturn } from './inquiryNavigation';
import { Icon } from './Icon';
import { confirmAction } from './confirmAction';
import { useBeforeUnload } from './useBeforeUnload';
import { SERVICE_DESK_LIMITS, validateServiceDesk } from './serviceDeskModel';
import { getServiceDeskSession, serviceDeskLinks, serviceDeskRequest } from './serviceDeskClient';
import {refreshInquiryNotifications} from './inquiryNotificationRefresh';
import {createTalkMediaClient} from './talkMedia';
import {createTalkClient} from './talkClient';
import {SERVICE_DESK_ATTACHMENT_CONFIG,SERVICE_DESK_CONFIG} from './config';
import {talkHtmlToMarkdown,markdownToTalkHtml} from './talkRichText';
import {loadGithubJson} from './githubJsonRead';
import {getGithubSession} from './session';
import inquiryTypesDocument from './data/masters/inquiry-types.json';
import {inquiryTypeOptions} from './inquiryTypes';
import {createInquiryAssignmentClient} from './inquiryAssignment';
import {InquiryRecipients} from './InquiryRecipients';
import './service-desk.css';
import './community.css';
const TalkEditor=lazy(()=>import('./TalkEditor'));
const loadInquiryTypes=async()=>{const definition={path:'data/masters/inquiry-types.json',bundled:inquiryTypesDocument};const remote=await loadGithubJson({...getGithubSession(),path:definition.path});return inquiryTypeOptions(remote?.document||definition.bundled);};

// Nubi: a host page that already shows the 문의 title offers its header row here; the inquiry controls (sidebar toggle,
// back, help, actions) then sit in that one row instead of a second header (user request 2026-10-14).
import {InquiryHeaderSlot} from './InquiryHeaderSlot.js';
export {InquiryHeaderSlot} from './InquiryHeaderSlot.js';
export function InquiryPage({children, actions, onClose, busy, composing=false, sidebar, sidebarId, sidebarCollapsed=false, onToggleSidebar, showList=false}) {
  const [help,setHelp]=useState(false), heading=useRef(null), id=useId(), slot=useContext(InquiryHeaderSlot);
  useEffect(()=>{heading.current?.focus();},[]);
  // Keep collapse and expand in the same header position so the control never jumps between rows.
  const controls=<>{sidebar&&onToggleSidebar&&<ActionButton className="inquiry-sidebar-toggle" action={sidebarCollapsed?'showSidebar':'hideSidebar'} label={sidebarCollapsed?'문의 내역 펼치기':'문의 내역 접기'} aria-expanded={!sidebarCollapsed} aria-controls={sidebarId} onClick={onToggleSidebar}/>} {onClose&&<ActionButton action="back" aria-label="문의 목록" onClick={onClose} disabled={busy}/>}</>;
  if(slot)return <section className={`service-desk-page is-slotted${composing?' is-composing':''}${sidebar?' has-inquiry-sidebar':''}${sidebarCollapsed?' is-inquiry-sidebar-collapsed':''}${showList?' is-inquiry-list':''}`} aria-label="문의">
    {createPortal(<div className="service-desk-slot-controls">{controls}<HelpTrigger onClick={()=>setHelp(true)}/><div className="service-desk-page-actions">{actions}</div></div>,slot)}
    {sidebar?<div className="inquiry-columns">{sidebar}<div className="service-desk-page-body">{children}</div></div>:<div className="service-desk-page-body">{children}</div>}
    {help&&<HelpPanel initialTopic="support" onClose={()=>setHelp(false)}/>}
  </section>;
  return <section className={`service-desk-page${composing?' is-composing':''}${sidebar?' has-inquiry-sidebar':''}${sidebarCollapsed?' is-inquiry-sidebar-collapsed':''}${showList?' is-inquiry-list':''}`} aria-labelledby={id}>
    <header className="service-desk-page-header">
      <div className="service-desk-page-title">{sidebar&&onToggleSidebar&&<ActionButton className="inquiry-sidebar-toggle" action={sidebarCollapsed?'showSidebar':'hideSidebar'} label={sidebarCollapsed?'문의 내역 펼치기':'문의 내역 접기'} aria-expanded={!sidebarCollapsed} aria-controls={sidebarId} onClick={onToggleSidebar}/>} {onClose&&<ActionButton action="back" aria-label="문의 목록" onClick={onClose} disabled={busy}/>}<h1 id={id} ref={heading} tabIndex={-1}>문의</h1><HelpTrigger onClick={()=>setHelp(true)}/></div>
      <div className="service-desk-page-actions">{actions}</div>
    </header>
    {sidebar?<div className="inquiry-columns">{sidebar}<div className="service-desk-page-body">{children}</div></div>:<div className="service-desk-page-body">{children}</div>}
    {help&&<HelpPanel initialTopic="support" onClose={()=>setHelp(false)}/>}
  </section>;
}

export function ServiceDesk({ page, session = getServiceDeskSession(), onClose, onPendingChange, onSaved, request = serviceDeskRequest, media, loadTypes = loadInquiryTypes, pageLayout={}, assignmentClient, editing=null }) {
  if(!session) return <InquiryPage {...pageLayout} onClose={onClose}><div className="service-desk-login"><span className="service-desk-login-icon"><Icon name="githubMark" size={28}/></span><h2>문의하려면 로그인하세요</h2><ActionButton action="login" className="cx-button--primary" onClick={()=>{rememberInquiryReturn();window.location.hash='login';}}/></div></InquiryPage>;
  let links;
  try { links = serviceDeskLinks(session); }
  catch { return <InquiryPage {...pageLayout} onClose={onClose}><ToastNotice error message="문의 저장소 설정을 확인할 수 없습니다. 담당자에게 알려주세요."/></InquiryPage>; }
  return <ServiceDeskForm page={page} session={session} onClose={onClose} onPendingChange={onPendingChange} onSaved={onSaved} request={request} suppliedMedia={media} loadTypes={loadTypes} links={links} pageLayout={pageLayout} assignmentClient={assignmentClient} editing={editing}/>;
}

function ServiceDeskForm({ page, session, onClose, onPendingChange, onSaved, request, suppliedMedia, loadTypes, links, pageLayout, assignmentClient, editing }) {
  const [,notify] = useFeedback();
  const id = useId(), formId = `${id}-form`;
  const [draft, setDraft] = useState({ type: editing?.type||'', title: editing?.title||'', description: editing?.body||'', page:editing?.source||page });
  const [types,setTypes]=useState([]),[typesLoading,setTypesLoading]=useState(true),[typesError,setTypesError]=useState(''),[typesRevision,setTypesRevision]=useState(0);
  const [media]=useState(()=>suppliedMedia||createTalkMediaClient({session,config:SERVICE_DESK_ATTACHMENT_CONFIG,namespace:'inquiry'}));
  const [people]=useState(()=>createTalkClient({session,config:SERVICE_DESK_CONFIG}));
  const [assignment]=useState(()=>assignmentClient||createInquiryAssignmentClient({session})),[recipients,setRecipients]=useState([]);
  const [uploadId]=useState(()=>crypto.randomUUID());
  const [preparing,setPreparing]=useState(false),[phase,setPhase]=useState('');
  const editor=useRef(null);
  const [errors, setErrors] = useState({}), [failure, setFailure] = useState(null);
  const [busy, setBusy] = useState(false), [receipt, setReceipt] = useState(null), [copied, setCopied] = useState(false);
  const sending = useRef(false), attempt = useRef(null), form = useRef(null), alive = useRef(true), result = useRef(null);
  const dirty = !receipt && (editing?draft.title!==editing.title||draft.description!==editing.body||draft.type!==editing.type:Boolean(draft.title || draft.description || recipients.length));
  const leaveMessage=failure?.uncertain?'반영 여부를 확인하지 못했습니다.\n내 문의에서 확인한 뒤 다시 작성하세요.':'작성한 내용은 저장되지 않습니다.';
  useBeforeUnload(dirty || busy || preparing);
  useEffect(()=>{let active=true;setTypesLoading(true);setTypesError('');loadTypes().then(options=>{if(!active)return;const values=editing?.type&&!options.some(item=>item.label===editing.type)?[{id:'current-inquiry-type',label:editing.type},...options]:options;setTypes(values);setDraft(value=>({...value,type:values.some(item=>item.label===value.type)?value.type:values[0]?.label||''}));}).catch(error=>{if(active)setTypesError(error.message);}).finally(()=>{if(active)setTypesLoading(false);});return()=>{active=false;};},[loadTypes,typesRevision,editing?.type]);
  useEffect(()=>{onPendingChange?.({dirty,saving:busy||preparing,leaveMessage});},[dirty,busy,preparing,leaveMessage,onPendingChange]);
  useEffect(()=>()=>onPendingChange?.({dirty:false,saving:false}),[onPendingChange]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { if (receipt) result.current?.focus(); }, [receipt, failure]);
  const close = async () => {
    if (sending.current || preparing) return;
    if (!dirty || await confirmAction({ kind: 'leave', title: '작성 중인 문의에서 나갈까요?', message:leaveMessage, confirmLabel: '나가기', cancelLabel: '계속 작성' })) onClose();
  };
  const edit = (key, value) => { setDraft(previous => ({ ...previous, [key]: value })); setErrors(previous => ({ ...previous, [key]: undefined })); setFailure(null); };
  const submit = async event => {
    event.preventDefault(); if (sending.current || preparing || typesLoading || typesError || !types.length) return;
    const payload={...draft,description:editing&&draft.description===editing.body?editing.body:talkHtmlToMarkdown(editor.current?.getHtml()||''),assignees:recipients.map(user=>user.login)};
    const typeNames=types.map(item=>item.label);
    const checked = validateServiceDesk(payload,typeNames);
    if(!editing&&!recipients.length){checked.errors.assignees='담당자를 선택하세요.';checked.valid=false;}
    setErrors(checked.errors);
    if (!checked.valid) { requestAnimationFrame(() => checked.errors.title?form.current?.querySelector('input[aria-invalid="true"]')?.focus():checked.errors.assignees?form.current?.querySelector('.inquiry-recipient-trigger')?.focus():editor.current?.focus()); return; }
    const fingerprint = JSON.stringify(checked.value);
    if (!attempt.current || attempt.current.fingerprint !== fingerprint) attempt.current = { fingerprint, id: crypto.randomUUID(), uncertain: false };
    sending.current = true; setBusy(true); setPhase(editing?'저장 중…':'접수 중…'); setFailure(null);
    try {
      if(!attempt.current.uncertain)attempt.current.payload=checked.value;
      setPhase(editing?'저장 중…':'접수 중…');
      const data = await request({ session, payload: attempt.current.payload, requestId: attempt.current.id, verifyOnly: attempt.current.uncertain, types:typeNames, assignmentClient:assignment });
      if (alive.current) {
        setReceipt(data);
        refreshInquiryNotifications();
        notify(editing?'문의를 수정했습니다.':data.assignment?.missing?.length?'문의는 접수됐지만 일부 담당자가 배정되지 않았습니다. 문의 상세에서 배정을 확인하세요.':'문의 접수와 담당자 배정을 완료했습니다.',Boolean(data.assignment?.missing?.length));
        onSaved?.(data);
      }
    } catch (error) {
      attempt.current.uncertain ||= Boolean(error.uncertain);
      if (alive.current) { setFailure({ message: error.message, uncertain: attempt.current.uncertain, status: error.status }); if (error.fields) setErrors(error.fields); }
    } finally { sending.current = false; if (alive.current) setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(receipt ? `#${receipt.number}` : attempt.current.id); setCopied(true); notify(receipt?'접수 번호를 복사했습니다.':'문의 코드를 복사했습니다.'); }
    catch { setCopied(false); notify('복사하지 못했습니다. 번호를 직접 선택해 복사하세요.',true); }
  };
  const locked = busy || failure?.uncertain;
  return <InquiryPage {...pageLayout} onClose={close} busy={busy||preparing} composing={!receipt} actions={<>

    {receipt ? <ActionLink action="openExternal" label="문의 확인" href={receipt.url} target="_blank" rel="noopener noreferrer"/> : <ActionButton action="save" type="submit" form={formId} label={busy ? phase : failure?.uncertain ? editing?'결과 확인':'접수 확인' : editing?'저장':'접수'} busy={busy} disabled={preparing||typesLoading||Boolean(typesError)||!types.length||(editing&&!dirty)}/>}
  </>}>
    {receipt ? <section className="service-desk-success" ref={result} tabIndex={-1} aria-label={editing?"수정 완료":"접수 완료"}>
      <span className="service-desk-success-icon"><Icon name="check" size={28}/></span><h3>{editing?'수정했습니다':'접수했습니다'}</h3>

      <dl className="service-desk-receipt"><div><dt>접수 번호</dt><dd><strong>#{receipt.number}</strong><ActionButton action="copy" success={copied} aria-label="접수 번호 복사" title={copied?'복사 완료':'접수 번호 복사'} onClick={copy}/></dd></div><div><dt>제목</dt><dd>{draft.title.trim()}</dd></div><div><dt>접수 일시</dt><dd>{new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(receipt.createdAt))}</dd></div></dl>

      <ActionLink action="notifications" label="알림 설정" className="service-desk-notifications" href={links.notifications} target="_blank" rel="noopener noreferrer"/>

    </section> : <>
      <form id={formId} ref={form} className="service-desk-form" onSubmit={submit} noValidate>
        <div className="service-desk-fields">
          <div className="service-desk-field service-desk-title-field">
            <label className="visually-hidden" htmlFor={`${id}-title`}>제목</label>
            <input id={`${id}-title`} className="text-input community-compose-title" value={draft.title} disabled={locked} maxLength={SERVICE_DESK_LIMITS.title} onChange={event => edit('title', event.target.value)} placeholder="제목을 입력하세요" aria-invalid={Boolean(errors.title)} aria-describedby={errors.title ? `${id}-title-error` : undefined} required/>
            {errors.title && <p className="service-desk-field-error" id={`${id}-title-error`}>{errors.title}</p>}
          </div>
          <div className="service-desk-field service-desk-type-field">
            <label className="visually-hidden" htmlFor={`${id}-type`}>유형</label>
            <CxSelect id={`${id}-type`} className="native-select" disabled={locked||typesLoading||Boolean(typesError)} value={draft.type} onChange={event => edit('type', event.target.value)}>{!types.length&&<option value="">{typesLoading?'불러오는 중…':'사용 중인 유형 없음'}</option>}{types.map(type => <option key={type.id} value={type.label}>{type.label}</option>)}</CxSelect>
            {typesError&&<p className="service-desk-field-error" role="alert">{typesError}<ActionButton action="refresh" label="다시 불러오기" onClick={()=>setTypesRevision(value=>value+1)}/></p>}
            {errors.type&&<p className="service-desk-field-error">{errors.type}</p>}
          </div>
          {!editing&&<InquiryRecipients client={assignment} value={recipients} disabled={locked} error={errors.assignees} onChange={value=>{setRecipients(value);setErrors(previous=>({...previous,assignees:undefined}));setFailure(null);}}/>}
        </div>
        <Suspense fallback={<CommunityStatus loading label="편집기를 불러오는 중…" className="service-desk-editor-loading"/>}><TalkEditor ref={editor} invalid={Boolean(errors.description)} describedBy={errors.description?`${id}-description-error`:undefined} initialValue={editing?markdownToTalkHtml(editing.body):''} bodyLabel="문의 내용" placeholder="발생한 문제나 궁금한 내용을 적으세요." maxLength={SERVICE_DESK_LIMITS.description} onChange={html=>edit('description',talkHtmlToMarkdown(html))} onBusy={setPreparing} upload={file=>media.upload(file,uploadId)} loadMedia={url=>media.storedPath(url)?media.load(url):Promise.resolve(null)} mentionItems={people.mentionItems} profile={people.profile} media={media} disabled={locked}/></Suspense>
        <div className="community-editor-status"><span>{draft.description.length.toLocaleString('ko-KR')} / {SERVICE_DESK_LIMITS.description.toLocaleString('ko-KR')}</span></div>
        {errors.description && <p className="service-desk-field-error" id={`${id}-description-error`}>{errors.description}</p>}
      </form>
      {failure && <><ToastNotice error message={failure.message}/>{failure.uncertain && <div className="service-desk-request-code"><span>문의 코드</span><code>{attempt.current?.id}</code><ActionButton action="copy" success={copied} aria-label="문의 코드 복사" title={copied?'복사 완료':'문의 코드 복사'} onClick={copy}/></div>}</>}
    </>}
  </InquiryPage>;
}
