import React,{useEffect,useRef,useState} from 'react';
import {ActionButton,CxButton,CxField,CxInput,CxNotice,DetailPanel,Icon,SearchField} from '@e2e/cx-design-system';
import {DeckEmpty} from '../../../extensions/aipro-chat/src/DeckSurfaces.jsx';
import {catalogEntries,catalogMutation} from './template-catalog.js';
import {rpc} from './bridge.js';
import {useFormFeedback} from './form-feedback.js';
import {errorText} from './errors.js';

export function OfficeTemplates({host,hostName,onRegister,onUse,onSkills,onClose,call=rpc}){
  const [entries,setEntries]=useState([]),[loading,setLoading]=useState(true),[working,setWorking]=useState(false),[error,setError]=useState(''),[unreadable,setUnreadable]=useState(0);
  const [query,setQuery]=useState(''),[edit,setEdit]=useState(null),[name,setName]=useState(''),[remove,setRemove]=useState(null),[details,setDetails]=useState(null);
  const feedback=useFormFeedback();
  const alive=useRef(true),locked=useRef(false),editButtons=useRef(new Map()),removeButtons=useRef(new Map());
  async function load(){setLoading(true);setError('');try{const result=await call('template_catalog_list');const values=catalogEntries(result,host);if(alive.current){setEntries(values);setUnreadable(result.unreadable);}}catch(cause){if(alive.current)setError(errorText(cause.message,host));}finally{if(alive.current)setLoading(false);}}
  useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;};},[host]);
  async function perform(action){if(locked.current)return;locked.current=true;setWorking(true);setError('');try{await action();}catch(cause){if(alive.current)setError(errorText(cause.message,host));}finally{locked.current=false;if(alive.current)setWorking(false);}}
  const disabled=working||loading;
  const visible=entries.filter(item=>(item.name+' '+item.summary).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <DetailPanel title={`${hostName} 양식`} variant="modal" className="deck-dialog office-template-dialog" hideHelp busy={working} onClose={()=>{if(!locked.current)onClose();}} footer={<span className="context-note">이 Windows 계정에 보관됩니다.</span>}>
    {onSkills&&<CxButton onClick={onSkills} disabled={working}>작성 스킬</CxButton>}
    <div className="office-template-toolbar">
      <SearchField label="양식 검색" placeholder="양식 검색" value={query} disabled={disabled||!entries.length} onChange={setQuery}/>
      <ActionButton action="add" iconOnly className="office-template-register" label="현재 양식 등록" disabled={disabled} onClick={onRegister}/>
      <ActionButton action="refresh" iconOnly label="양식 목록 새로고침" busy={loading} disabled={working} onClick={load}/>
    </div>
    {error&&<CxNotice tone="danger">{error}</CxNotice>}
    {unreadable>0&&<CxNotice tone="warning">읽지 못한 등록 항목이 {unreadable}개 있습니다. 양식 파일은 삭제하지 않았습니다.</CxNotice>}
    {loading&&!entries.length?<DeckEmpty loading title="양식을 불러오고 있습니다"/>:<>
      {!visible.length?<DeckEmpty icon="file" title={entries.length?'검색 결과가 없습니다':error?'목록을 확인하지 못했습니다':'등록한 양식이 없습니다'} description={!entries.length&&!error?'위의 +로 현재 문서의 양식을 등록하세요.':undefined}/>:<ul className="office-template-list" aria-label={`${hostName} 등록 양식`} aria-busy={loading||undefined}>
        {visible.map(item=><li key={item.id} className="office-template-card">
          <div className="office-template-heading">
            <span className="deck-symbol"><Icon name={host==='excel'?'table':'file'} size={20}/></span>
            <div><strong>{item.name}</strong><span>입력 위치 {item.inputCount}개</span></div>
            <CxButton className="office-template-use" aria-label="이 양식으로 작성" disabled={disabled||!item.available||edit===item.id||remove===item.id} onClick={()=>void perform(()=>onUse(item))}>작성</CxButton>
          </div>
          {!item.available&&<CxNotice tone="warning">양식 파일을 찾지 못했습니다. 파일을 열고 다시 등록해 주세요.</CxNotice>}
          <div className="office-template-utilities" role="group" aria-label={`${item.name} 관리`}>
            <ActionButton action="view" label={`${item.name} 스냅샷 정보`} aria-expanded={details===item.id} aria-controls={'template-info-'+item.id} disabled={disabled} onClick={()=>setDetails(details===item.id?null:item.id)}/>
            <ActionButton action="edit" label={`${item.name} 이름 변경`} ref={node=>{if(node)editButtons.current.set(item.id,node);else editButtons.current.delete(item.id);}} disabled={disabled} onClick={()=>{feedback.reset();setError('');setEdit(item.id);setName(item.name);setRemove(null);}}/>
            <ActionButton action="delete" label={`${item.name} 목록에서 제거`} ref={node=>{if(node)removeButtons.current.set(item.id,node);else removeButtons.current.delete(item.id);}} disabled={disabled} onClick={()=>{setRemove(item.id);setEdit(null);}}/>
          </div>
          <div id={'template-info-'+item.id} className="office-template-info" hidden={details!==item.id}>
            <p>{item.summary}</p><dl className="office-cell-details"><div><dt>양식 파일</dt><dd>{item.sourceFile}</dd></div><div><dt>관찰 항목</dt><dd>{item.itemCount}개</dd></div></dl>
          </div>
          {edit===item.id?<form noValidate onSubmit={e=>{e.preventDefault();if(!feedback.validate(e.currentTarget))return;void perform(async()=>{await catalogMutation('template_catalog_rename',{templateId:item.id,revision:item.revision,name:name.trim()},{call});setEdit(null);await load();});}}><CxField label="양식 이름 (필수)" id={'template-name-'+item.id} error={feedback.errors['template-name-'+item.id]}><CxInput required autoFocus maxLength={100} value={name} disabled={working} {...feedback.input(e=>setName(e.target.value))}/></CxField><div className="office-dialog-actions"><ActionButton action="cancel" label="이름 변경 취소" disabled={working} onClick={()=>{setEdit(null);editButtons.current.get(item.id)?.focus();}}/><CxButton variant="primary" type="submit" disabled={working}>이름 저장</CxButton></div></form>:remove===item.id?<div className="office-template-remove"><p>목록에서 제거할까요? 양식 파일은 남습니다.</p><div className="office-dialog-actions"><ActionButton action="cancel" label="목록 제거 취소" disabled={working} onClick={()=>{setRemove(null);removeButtons.current.get(item.id)?.focus();}}/><CxButton disabled={working} onClick={()=>void perform(async()=>{await catalogMutation('template_catalog_remove',{templateId:item.id,revision:item.revision},{call});setRemove(null);await load();})}>목록에서 제거</CxButton></div></div>:null}
        </li>)}
      </ul>}
    </>}
  </DetailPanel>;
}
