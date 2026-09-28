import React,{useEffect,useRef,useState} from 'react';
import {ActionButton,CxButton,CxField,CxInput,CxNotice,CxTextarea,DetailPanel,Icon} from '@e2e/cx-design-system';
import {DeckDisclosure,DeckEmpty} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {documentSkill} from '../worker/document-skill.mjs';
import {catalogMutation} from './template-catalog.js';
import {rpc} from './bridge.js';
import {useFormFeedback} from './form-feedback.js';
import {errorText} from './errors.js';

export function OfficeSkills({host,hostName,onUse,onImported,onClose,call=rpc}){
  const [entries,setEntries]=useState([]),[editor,setEditor]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[recent,setRecent]=useState(null),[unreadable,setUnreadable]=useState(0),[remove,setRemove]=useState(null),[manifests,setManifests]=useState({});
  const feedback=useFormFeedback();
  const alive=useRef(true),locked=useRef(false);
  async function load(){const result=await call('document_skill_list');if(result.host!==host||!Array.isArray(result.entries)||result.entries.length>50||!Number.isInteger(result.unreadable)||result.unreadable<0)throw new Error('document_skill_invalid');const list=result.entries.map(s=>documentSkill(s,host));if(new Set(list.map(s=>s.id)).size!==list.length)throw new Error('document_skill_invalid');if(alive.current){setEntries(list);setUnreadable(result.unreadable);}return list;}
  async function perform(fn){if(locked.current)return;locked.current=true;setBusy(true);setError('');try{await fn();}catch(cause){if(alive.current)setError(errorText(cause.message,host));}finally{locked.current=false;if(alive.current)setBusy(false);}}
  useEffect(()=>{alive.current=true;void perform(load);return()=>{alive.current=false;};},[host]);
  const change=(key,value)=>setEditor(e=>({...e,[key]:value}));
  function edit(skill){feedback.reset();setError('');setRemove(null);setEditor(structuredClone(skill));}
  async function upload(kind){
    const result=await catalogMutation('document_skill_import',{kind},{call});
    if(result.cancelled===true)return;
    const skill=documentSkill(result,host);if(!skill.package)throw new Error('document_skill_invalid');
    const saved=(await load()).find(entry=>entry.id===skill.id);
    if(!saved||saved.revision!==skill.revision||saved.package?.sha256!==skill.package.sha256)throw new Error('document_skill_unavailable');
    onImported?.(saved);
    if(alive.current)setRecent(saved.name);
  }
  async function showFiles(skill){
    const result=await call('document_skill_manifest',{skillId:skill.id,revision:skill.revision});
    if(JSON.stringify(documentSkill(result.skill,host))!==JSON.stringify(skill)||!Array.isArray(result.files)||result.files.length!==skill.package.fileCount||result.files.some(f=>typeof f.path!=='string'||f.path.length>160))throw new Error('document_skill_changed');
    if(alive.current)setManifests(current=>({...current,[skill.id]:result.files}));
  }
  async function save(){
    const candidate=documentSkill(editor,host);
    const result=await catalogMutation('document_skill_save',{skill:candidate},{call});
    if(JSON.stringify(documentSkill(result,host))!==JSON.stringify(candidate))throw new Error('document_skill_unavailable');
    setEditor(null);await load();
  }
  return <DetailPanel title={`${hostName} 작성 스킬`} variant="modal" className="deck-dialog office-template-dialog office-skills-dialog" hideHelp busy={busy} onClose={()=>{if(!locked.current)onClose();}} footer={<span className="context-note">이 Windows 계정에 보호 저장됩니다.</span>}>
    {error&&<CxNotice tone="danger">{error}</CxNotice>}
    {recent&&!error&&<CxNotice tone="success">{recent} 등록 완료. 다음 요청에 사용합니다.</CxNotice>}
    {unreadable>0&&<CxNotice tone="warning">읽지 못한 스킬이 {unreadable}개 있습니다.</CxNotice>}
    {editor?<form className="office-skill-editor" noValidate onSubmit={e=>{e.preventDefault();if(feedback.validate(e.currentTarget))void perform(save);}}>
      <CxField label="스킬 이름 (필수)" id="skill-name" error={feedback.errors['skill-name']}><CxInput id="skill-name" required autoFocus value={editor.name} maxLength={100} disabled={busy} {...feedback.input(e=>change('name',e.target.value))}/></CxField>
      <CxField label="문서 형식과 작성 규칙 (필수)" id="skill-rules" error={feedback.errors['skill-rules']}><CxTextarea id="skill-rules" required rows={5} maxLength={8000} value={editor.instructions} disabled={busy} placeholder="예: 요약, 현황, 문제점, 다음 계획 순서로 작성. 금액은 천 원 단위." {...feedback.input(e=>change('instructions',e.target.value))}/></CxField>
      <p className="context-note">필요한 정보는 누비가 확인하고, 부족한 내용만 질문합니다.</p>
      {!!editor.questions.length&&<DeckDisclosure title="기존 확인 항목" icon="list"><ul>{editor.questions.map((q,i)=><li key={i}>{q.question}</li>)}</ul></DeckDisclosure>}
      <div className="office-dialog-actions"><ActionButton action="cancel" label="스킬 편집 취소" disabled={busy} onClick={()=>setEditor(null)}/><CxButton variant="primary" type="submit" disabled={busy}>규칙 저장</CxButton></div>
    </form>:<>
      <div className="office-template-toolbar"><CxButton variant="primary" disabled={busy||entries.length>=50} onClick={()=>void perform(()=>upload('zip'))}>ZIP 등록</CxButton><CxButton disabled={busy||entries.length>=50} onClick={()=>void perform(()=>upload('folder'))}>폴더 등록</CxButton><ActionButton action="refresh" iconOnly label="스킬 목록 새로고침" disabled={busy} onClick={()=>void perform(load)}/></div>
      <p className="context-note">SKILL.md가 있는 ZIP이나 폴더를 고르면 자동 등록하고 다음 요청에 연결합니다.</p>
      <DeckDisclosure title="등록 범위" icon="file"><p>스킬 하나당 파일 256개, 총 8MB, 파일당 2MB까지 등록할 수 있습니다. SKILL.md는 60KB 이내이며, 한 작업에서 스킬 3개까지 사용할 수 있습니다.</p></DeckDisclosure>
      {!entries.length&&<DeckEmpty loading={busy} icon="file" title={busy?"스킬 불러오는 중":error?"목록을 확인하지 못했습니다":"등록한 스킬이 없습니다"}/> }
      <ul className="office-template-list" aria-label="등록된 작성 스킬">{entries.map(skill=><li key={skill.id} className="office-template-card">
        <div className="office-template-heading"><span className="deck-symbol" aria-hidden="true"><Icon name="file" size={20}/></span><div><strong>{skill.name}</strong><span>{skill.package?`파일 ${skill.package.fileCount}개`:'작성 규칙'}</span></div><CxButton className="office-template-use" disabled={busy||remove===skill.id} onClick={()=>onUse(skill)}>선택</CxButton></div>
        <DeckDisclosure title={skill.package?'스킬 설명':'작성 규칙'} icon="file"><p className="office-skill-rules">{skill.instructions}</p></DeckDisclosure>
        {manifests[skill.id]&&<ul className="office-skill-files" id={`skill-files-${skill.id}`} aria-label={`${skill.name} 파일 목록`}>{manifests[skill.id].map(file=><li key={file.path}><code>{file.path}</code></li>)}</ul>}
        <div className="office-template-utilities" role="group" aria-label={`${skill.name} 관리`}>{skill.package&&<ActionButton action="view" label={`${skill.name} 파일 목록`} aria-expanded={!!manifests[skill.id]} aria-controls={`skill-files-${skill.id}`} disabled={busy} onClick={()=>{if(manifests[skill.id])setManifests(current=>({...current,[skill.id]:null}));else void perform(()=>showFiles(skill));}}/>}{!skill.package&&<ActionButton action="edit" label={`${skill.name} 수정`} disabled={busy} onClick={()=>edit({...skill,revision:skill.revision+1})}/> }<ActionButton action="delete" label={`${skill.name} 제거`} disabled={busy} onClick={()=>setRemove(skill.id)}/></div>
        {remove===skill.id&&<div><p>등록한 스킬을 제거할까요?</p><div className="office-dialog-actions"><ActionButton action="cancel" label="스킬 제거 취소" disabled={busy} onClick={()=>setRemove(null)}/><CxButton disabled={busy} onClick={()=>void perform(async()=>{await catalogMutation('document_skill_remove',{skillId:skill.id,revision:skill.revision},{call});setRemove(null);await load();})}>제거</CxButton></div></div>}
      </li>)}</ul>
    </>}
  </DetailPanel>;
}
