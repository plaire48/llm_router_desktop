import React,{useCallback,useEffect,useId,useMemo,useRef,useState} from 'react';
import {ActionButton} from '../ActionButton';
import {ProfileIdentity} from '../AccountProfile';
import {DetailPanel} from '../DetailPanel';
import {SearchField} from '../SearchField';
import {Icon} from '../Icon';
import {confirmAction} from '../confirmAction';
import {notifyToast} from '../Toast';
import {useBeforeUnload} from '../useBeforeUnload';
import {useCatalogRefresh} from '../useCatalogRefresh';
import {createWorkspaceClient} from './workspaceClient';
import {WorkspaceIcon} from './WorkspaceCardIcon';
import {WorkspaceFiles} from './WorkspaceFiles';
import {importWorkspaceImage} from './workspaceIcon';
import {importWorkspaceFiles,prepareWorkspaceSite,workspaceSiteHash} from './workspaceSite';
import {buildWorkspaceDocument} from './workspaceSiteDocument';
import {CxSelect} from '../CxSelect';
import {CxTabs} from '../CxTabs';
import {SkillMaintainers} from '../skills/SkillMaintainers';
import {workspaceFields,canCreateWorkspace,canEditWorkspace,canOwnWorkspace,filterWorkspaces,workspaceManagerLogins} from './workspaceModel';
import '../skills/skills.css';
import './workspace.css';

const noop=()=>{};
function WorkspaceForm({item,snapshot,client,user,role,onClose,onSaved,onPendingChange}) {
  const formId=useId(),formRef=useRef(null),lock=useRef(false);
  const [id]=useState(()=>item?.id||crypto.randomUUID());
  const initial=useMemo(()=>({title:item?.title||'',description:item?.description||'',url:item?.url||'',editors:item?.editors||[]}),[item]);
  const [form,setForm]=useState(initial),[base,setBase]=useState({snapshot,item}),[busy,setBusy]=useState(false),[error,setError]=useState(null),[conflict,setConflict]=useState(null),[icon,setIcon]=useState(undefined),[imageBusy,setImageBusy]=useState(false);
  const [site,setSite]=useState(null);
  const [kind,setKind]=useState(item?.kind==='site'?'site':'link');
  const isSite=kind==='site';
  const dirty=JSON.stringify(form)!==JSON.stringify(initial)||icon!==undefined||Boolean(site)||kind!==(item?.kind==='site'?'site':'link');
  const effectiveIcon=icon===undefined?base.item?.icon:icon;
  useBeforeUnload(dirty||busy||imageBusy);
  useEffect(()=>{onPendingChange({dirty,saving:busy||imageBusy});return()=>onPendingChange({dirty:false,saving:false});},[dirty,busy,imageBusy,onPendingChange]);
  const close=async()=>{if(lock.current||imageBusy)return;if(!dirty||await confirmAction({kind:'leave',title:'앱 작성을 취소할까요?',message:'입력한 내용은 저장되지 않습니다.',confirmLabel:'작성 취소',cancelLabel:'계속 작성'}))onClose();};
  const chooseImage=async event=>{
    const file=event.target.files?.[0];event.target.value='';if(!file||lock.current||imageBusy)return;
    setImageBusy(true);setError(null);
    try{setIcon(await importWorkspaceImage(file));}catch(reason){setError(reason);}finally{setImageBusy(false);}
  };
  const chooseFiles=async input=>{
    if(lock.current||imageBusy)return;
    setImageBusy(true);setError(null);
    try{
      const files=await input;if(!files.length)return;
      const uploaded=await importWorkspaceFiles(files),preview=await buildWorkspaceDocument(uploaded.document);
      setSite(uploaded);setForm(current=>({...current,title:current.title||preview.title||uploaded.descriptor.entry.replace(/\.html?$/i,'')}));
    }catch(reason){setError(reason);}finally{setImageBusy(false);}
  };
  const chooseEntry=async event=>{
    setImageBusy(true);setError(null);
    try{const next=await prepareWorkspaceSite({...site.document,entry:event.target.value});await buildWorkspaceDocument(next.document);setSite(next);}catch(reason){setError(reason);}finally{setImageBusy(false);}
  };
  const save=async event=>{
    event.preventDefault();if(lock.current||conflict||imageBusy)return;
    lock.current=true;setBusy(true);setError(null);
    try{const result=await client.save({snapshot:base.snapshot,existing:base.item,id,fields:workspaceFields({...form,kind:isSite?'site':'link'}),editors:form.editors,icon,site:isSite?site:undefined});onSaved(result.snapshot);notifyToast(result.unchanged?'변경 사항이 없습니다.':item?'앱을 수정했습니다.':'앱을 등록했습니다.',{source:'workspace'});}
    catch(reason){setError(reason);if(reason.status===409)setConflict({});if(reason.field)requestAnimationFrame(()=>formRef.current?.elements.namedItem(reason.field)?.focus());}
    finally{lock.current=false;setBusy(false);}
  };
  const compare=async()=>{
    if(lock.current)return;lock.current=true;setBusy(true);setError(null);
    try{const latest=await client.list();setConflict({snapshot:latest,item:latest.document.items.find(entry=>entry.id===id)||null});}
    catch(reason){setError(reason);}
    finally{lock.current=false;setBusy(false);}
  };
  const change=(key,value)=>{setForm(current=>({...current,[key]:value}));if(error?.field===key)setError(null);};
  const missing=Boolean(item&&conflict?.snapshot&&!conflict.item);
  const canApply=conflict?.snapshot&&!missing&&(!conflict.item||canEditWorkspace(conflict.item,user,role));
  return <DetailPanel titleIcon="layoutGrid02" title={item?'앱 수정':'앱 등록'} onClose={close} variant="modal" className="workspace-form-panel" hideHelp busy={busy||imageBusy} initialFocus={`#${formId}-title`} footer={<><ActionButton action="close" label="작성 취소" disabled={busy||imageBusy} onClick={close}/><ActionButton action="save" label={item?'저장':'등록'} type="submit" form={formId} busy={busy} disabled={!dirty||Boolean(conflict)||imageBusy}/></> }>
    {!item&&<CxTabs items={[{key:'link',label:'링크'},{key:'site',label:'파일'}]} active={kind} onChange={setKind} label="등록 방식" idPrefix={`${formId}-kind`} panelId={formId} disabled={busy||imageBusy}/> }
    <form ref={formRef} id={formId} className="workspace-form" role={!item?'tabpanel':undefined} aria-labelledby={!item?`${formId}-kind-${kind}`:undefined} onSubmit={save} noValidate>
      {isSite&&<div className="workspace-files-field"><span>페이지 파일</span><WorkspaceFiles site={site} existing={base.item?.site} client={client} busy={busy||imageBusy} onSelect={chooseFiles}/>{site?.pages.length>1?<label>시작 페이지<CxSelect aria-label="시작 페이지" value={site.document.entry} onChange={chooseEntry} disabled={busy||imageBusy}>{site.pages.map(path=><option key={path} value={path}>{path}</option>)}</CxSelect></label>:(site?.descriptor.entry||base.item?.site?.entry)&&<span className="workspace-file-entry">{site?.descriptor.entry||base.item?.site?.entry}</span>}</div>}
      <label htmlFor={`${formId}-title`}>제목<input className="text-input" id={`${formId}-title`} name="title" value={form.title} maxLength={100} placeholder="예: 사내 AI 도우미" disabled={busy} required aria-invalid={error?.field==='title'||undefined} aria-describedby={error?.field==='title'?`${formId}-error`:undefined} onChange={event=>change('title',event.target.value)}/></label>
      {!isSite&&<label htmlFor={`${formId}-url`}>URL<input className="text-input" id={`${formId}-url`} name="url" type="url" value={form.url} maxLength={2048} placeholder="https://" disabled={busy} required aria-invalid={error?.field==='url'||undefined} aria-describedby={error?.field==='url'?`${formId}-error`:undefined} onChange={event=>change('url',event.target.value)}/></label>}
      <label htmlFor={`${formId}-description`}>내용<textarea className="text-area" id={`${formId}-description`} name="description" rows={4} value={form.description} maxLength={1000} placeholder="사용할 수 있는 기능을 간단히 적어주세요." disabled={busy} required aria-invalid={error?.field==='description'||undefined} aria-describedby={error?.field==='description'?`${formId}-error`:undefined} onChange={event=>change('description',event.target.value)}/></label>
      <details className="workspace-options"><summary><Icon name="sliders" size={18}/><span>추가 설정</span><small>선택</small><Icon name="chevronDown" size={16}/></summary>
      <div className="workspace-image-field"><span id={`${formId}-image-label`}>아이콘 <small>선택</small></span><div><WorkspaceIcon icon={effectiveIcon} client={client}/><label className="workspace-image-upload" title="이미지 선택"><input type="file" accept="image/*,.ico" aria-label="아이콘 이미지 선택" disabled={busy||imageBusy} onChange={chooseImage}/><Icon name="image" size={18}/><span className="visually-hidden">{imageBusy?'준비 중…':'이미지 선택'}</span></label>{effectiveIcon&&<ActionButton action="delete" label="아이콘 삭제" disabled={busy||imageBusy} onClick={()=>setIcon(null)}/>}</div></div>
      <SkillMaintainers fieldName="editors" client={client} value={form.editors} onChange={value=>change('editors',value)} ownerLogin={base.item?.createdBy||user?.login} canEdit={!base.item||canOwnWorkspace(base.item,user,role)} disabled={busy||imageBusy} invalid={error?.field==='editors'} describedBy={error?.field==='editors'?`${formId}-error`:undefined}/>
      </details>
      {error&&<p id={`${formId}-error`} className="workspace-error" role="alert">{error.message}</p>}
      {conflict&&<section className="workspace-conflict" aria-label="최신 앱과 비교">
        <p>입력한 내용은 유지됩니다. 최신 내용을 확인한 뒤 다시 저장하세요.</p>
        <ActionButton action="refresh" iconOnly={false} label="최신 목록 불러오기" disabled={busy} onClick={compare}/>
        {conflict.snapshot&&<>{conflict.item?<dl><dt>최신 제목</dt><dd>{conflict.item.title}</dd><dt>내용</dt><dd>{conflict.item.description}</dd><dt>{conflict.item.kind==='site'?'시작 페이지':'URL'}</dt><dd>{conflict.item.site?.entry||conflict.item.url}</dd><dt>관리자</dt><dd>{workspaceManagerLogins(conflict.item)[0]}</dd></dl>:<p>{missing?'이 앱은 삭제되었습니다. 작성 창을 닫고 목록을 새로고침하세요.':'다른 앱의 변경을 확인했습니다.'}</p>}
          {canApply?<ActionButton action="apply" iconOnly={false} label="최신 내용 확인 완료" onClick={()=>{setForm(current=>({...current,editors:JSON.stringify(current.editors)===JSON.stringify(base.item?.editors||[])?conflict.item?.editors||[]:current.editors}));setBase({snapshot:conflict.snapshot,item:conflict.item});setConflict(null);setError(null);}}/>:!missing&&<p>이 앱을 수정할 권한이 없습니다.</p>}
        </>}
      </section>}
    </form>
  </DetailPanel>;
}

export function LinkWorkspace({client:suppliedClient,user,role,onPendingChange=noop,onOpen}) {
  const client=useMemo(()=>suppliedClient||createWorkspaceClient(),[suppliedClient]);
  const [snapshot,setSnapshot]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[query,setQuery]=useState(''),[dialog,setDialog]=useState(null),[removing,setRemoving]=useState(false);
  const sequence=useRef(0),removeLock=useRef(false),openLock=useRef(false);
  const open=async(event,item)=>{if(!onOpen)return;event.preventDefault();if(openLock.current)return;openLock.current=true;try{await onOpen(item);}catch{setError('앱을 열지 못했어요. 연결을 확인하고 다시 시도해 주세요.');}finally{openLock.current=false;}};
  const load=useCallback(async()=>{
    const id=++sequence.current;setLoading(true);setError('');
    try{const result=await client.list();if(id===sequence.current)setSnapshot(result);}
    catch(reason){if(id===sequence.current)setError(reason.message);}
    finally{if(id===sequence.current)setLoading(false);}
  },[client]);
  useEffect(()=>{load();return()=>{sequence.current++;};},[load]);
  useCatalogRefresh({blocked:loading||removing||Boolean(dialog),onRefresh:async current=>{const id=++sequence.current,value=await client.list();if(current()&&id===sequence.current&&JSON.stringify(value.document)!==JSON.stringify(snapshot?.document))setSnapshot(value);}});
  useEffect(()=>{if(!dialog)onPendingChange({dirty:false,saving:removing});},[dialog,removing,onPendingChange]);
  useEffect(()=>()=>onPendingChange({dirty:false,saving:false}),[onPendingChange]);
  const remove=async item=>{
    if(removeLock.current)return;removeLock.current=true;
    try{
      if(!await confirmAction({kind:'delete',title:'앱을 삭제할까요?',message:`“${item.title}” 앱을 목록에서 삭제합니다. 연결된 서비스는 삭제되지 않습니다.`,confirmLabel:'삭제'}))return;
      setRemoving(true);onPendingChange({dirty:false,saving:true});
      setSnapshot(await client.remove({snapshot,item}));notifyToast('앱을 삭제했습니다.',{source:'workspace'});
    }catch(reason){notifyToast(reason,{source:'workspace',error:true});if(reason.status===409)await load();}
    finally{removeLock.current=false;setRemoving(false);}
  };
  const items=filterWorkspaces(snapshot?.document.items||[],query),canCreate=canCreateWorkspace(user,role),disabled=loading||removing||Boolean(error);
  return <section className="link-workspace" aria-labelledby="workspace-title">
    <header className="workspace-heading"><h1 id="workspace-title">App</h1>{canCreate&&<ActionButton action="edit" label="등록" aria-label="앱 등록" tone="quiet" disabled={disabled||!snapshot} onClick={()=>setDialog({item:null})}/>}</header>
    <div className="workspace-toolbar"><SearchField label="앱 검색" placeholder="검색" value={query} onChange={setQuery}/><span className="visually-hidden" role="status">{items.length}개</span><ActionButton action="refresh" label="앱 목록 새로고침" busy={loading} disabled={removing} onClick={load}/></div>
    {error&&<div className="workspace-load-error" role="alert"><p>{error}</p><ActionButton action="refresh" label="다시 불러오기" iconOnly={false} onClick={load}/></div>}
    <div className="workspace-content" aria-busy={loading}>
      {loading&&!snapshot?<p className="workspace-status" role="status">앱을 불러오는 중…</p>:!error&&!items.length?<div className="workspace-empty"><h2>{query?'검색 결과가 없습니다.':'등록된 앱이 없습니다.'}</h2>{query&&<ActionButton action="clearSearch" label="검색 지우기" iconOnly={false} onClick={()=>setQuery('')}/>}</div>:<ul className="workspace-grid" aria-label="앱 목록">{items.map(item=><li key={item.id} className="workspace-card">
        <a className="workspace-card-link" onClick={event=>void open(event,item)} href={item.kind==='site'?workspaceSiteHash(item.id):item.url} target="_blank" rel="noopener noreferrer" aria-label={`${item.title} 새 탭에서 열기`}><div className="workspace-card-top"><div className="workspace-card-title"><WorkspaceIcon icon={item.icon} client={client}/><h2 title={item.title}>{item.title}</h2></div><Icon name="linkExternal" size={18}/></div><p>{item.description}</p></a>
        <footer className="workspace-card-footer"><div className="workspace-card-managers"><span>관리자</span><div><ProfileIdentity user={{login:workspaceManagerLogins(item)[0]}} resolve/></div></div><div className="workspace-card-actions">{canEditWorkspace(item,user,role)&&<ActionButton action="edit" label={`${item.title} 앱 수정`} disabled={disabled} onClick={()=>setDialog({item})}/>} {canOwnWorkspace(item,user,role)&&<ActionButton action="delete" label={`${item.title} 앱 삭제`} disabled={disabled} onClick={()=>remove(item)}/>}</div></footer>
      </li>)}</ul>}
    </div>
    {dialog&&<WorkspaceForm key={dialog.item?.id||'new'} item={dialog.item} snapshot={snapshot} client={client} user={user} role={role} onClose={()=>setDialog(null)} onSaved={value=>{setSnapshot(value);setDialog(null);setError('');}} onPendingChange={onPendingChange}/>}
  </section>;
}
