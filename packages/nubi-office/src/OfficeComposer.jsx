import React, {useEffect, useRef, useState} from 'react';
import {ActionButton,CxButton,Icon} from '@e2e/cx-design-system';
import {NubiComposerInput,NubiComposerBar} from '../../../extensions/aipro-chat/src/NubiSurfaces.jsx';
import {ModelPicker} from '../../../extensions/aipro-chat/src/ChatControls.jsx';
import {TaskDock} from './TaskDock.jsx';
import {PROVIDER_NAMES} from './OfficeDialogs.jsx';
import {suggestCommands} from '../worker/template-match.mjs';

export function OfficeComposer({data,draft='',busy=false,blocked=false,inputRef,run,input,approval,stopping,interactionVisible,onLocate,onSend,onStop,onDraft,modelsOpen,onModels,onRefreshModels,hostName='Excel',onTemplates,templatesOpen=false,templateName,onClearTemplate,skillName,onClearSkill,onResetSkillInput,loadTemplates}) {
  // "/name" lists the registered templates. Choosing one only writes the command; nothing opens until the request is sent.
  const [templates,setTemplates]=useState(null),[active,setActive]=useState(0),[dismissed,setDismissed]=useState('');
  const loading=useRef(false),command=!!loadTemplates&&!busy&&draft.startsWith('/');
  useEffect(()=>{
    if(!command){loading.current=false;setTemplates(null);return;}
    if(loading.current)return;loading.current=true;let alive=true;
    Promise.resolve().then(loadTemplates).then(entries=>{if(alive)setTemplates(Array.isArray(entries)?entries:[]);},()=>{if(alive)setTemplates([]);});
    return()=>{alive=false;loading.current=false;};
  },[command]);
  const suggestions=command&&templates&&dismissed!==draft?suggestCommands(draft,templates)||[]:[],chosen=suggestions[Math.min(active,suggestions.length-1)];
  useEffect(()=>setActive(0),[draft]);
  useEffect(()=>{if(chosen)document.getElementById(`template-suggestion-${chosen.id}`)?.scrollIntoView?.({block:'nearest'});},[chosen?.id]);
  const pick=item=>{onDraft(item.command);requestAnimationFrame(()=>inputRef?.current?.focus());};
  function keyDown(event){
    const composing=event.nativeEvent.isComposing||event.keyCode===229;
    if(suggestions.length&&!composing){
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setActive(index=>(Math.min(index,suggestions.length-1)+(event.key==='ArrowDown'?1:suggestions.length-1))%suggestions.length);return;}
      if(event.key==='Enter'&&!event.shiftKey||event.key==='Tab'&&!event.shiftKey){event.preventDefault();pick(chosen);return;}
      if(event.key==='Escape'){event.preventDefault();setDismissed(draft);return;}
    }
    if(event.key==='Enter'&&!event.shiftKey&&!composing){event.preventDefault();void onSend();}
  }
  return <form id="request-form" className="composer" onSubmit={event=>{event.preventDefault();void onSend();}}>
    {busy && <TaskDock run={run} input={input} approval={approval} stopping={stopping} interactionVisible={interactionVisible} onLocate={onLocate}/>}
    {templateName&&<div className="office-template-chip"><Icon name="file" size={16}/><span>{templateName}</span><ActionButton action="close" label="양식 연결 해제" disabled={blocked} onClick={onClearTemplate}/></div>}
    {skillName&&<div className="office-template-chip"><Icon name="file" size={16}/><span>{skillName}</span><ActionButton action="refresh" label="스킬 입력 다시 받기" disabled={blocked} onClick={onResetSkillInput}/><ActionButton action="close" label="작성 스킬 연결 해제" disabled={blocked} onClick={onClearSkill}/></div>}
    {!!suggestions.length&&<ul id="template-suggestions" className="office-template-suggestions" role="listbox" aria-label="등록한 양식">
      {suggestions.map(item=><li key={item.id} id={`template-suggestion-${item.id}`} role="option" aria-selected={item===chosen} onMouseDown={event=>event.preventDefault()} onClick={()=>pick(item)}><strong>{item.name}</strong>{item.summary&&<span>{item.summary}</span>}</li>)}
    </ul>}
    <div hidden={busy}><NubiComposerInput disabled={busy} inputRef={inputRef} id="request" label={`${hostName} 작업 요청`} placeholder="원하는 문서나 할 일을 알려주세요" title={undefined} maxLength={8000} value={draft} onChange={event=>onDraft(event.target.value)} onKeyDown={keyDown} {...(suggestions.length?{'aria-autocomplete':'list','aria-controls':'template-suggestions','aria-activedescendant':`template-suggestion-${chosen.id}`}:{})}/></div>
    <NubiComposerBar leading={<><ActionButton action="add" className="office-template-add" label={`${hostName} 양식 등록과 관리`} title="양식 등록과 관리" aria-haspopup="dialog" aria-expanded={templatesOpen} disabled={blocked} onClick={onTemplates}/><ModelPicker data={data} providerLabels={PROVIDER_NAMES} disabled={blocked} open={modelsOpen} onOpen={onModels} onRefresh={onRefreshModels}/></>}
      tools={busy ? <CxButton id="stop" aria-label="중지" title="중지" onClick={onStop}><span className="stop-symbol" aria-hidden="true"/></CxButton> : <CxButton id="submit" type="submit" variant="primary" aria-label="전송" title="전송" disabled={blocked||!draft.trim()||!data.settings.modelId}><Icon name="arrowUp" size={20}/></CxButton>}/>
  </form>;
}
