import {IrreversibleNotice} from './IrreversibleNotice.jsx';
import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from '@e2e/cx-design-system';
import {QuestionForm} from '../../../extensions/aipro-chat/src/QuestionForm.jsx';
import './question-inline.css';
import {TerminalMark} from './marks.jsx';
import {NativeDocumentPreview} from './NativeDocumentPreview.jsx';
import {NativeExcelPreview} from './NativeExcelPreview.jsx';
import {ToolArguments} from './ToolArguments.jsx';

export function QuestionDecision({question:incomingQuestion,disabled,blocked,onChoose,onDraft,onNativeEdit}){
 const [localQuestion,setLocalQuestion]=useState(null),[nativeSaving,setNativeSaving]=useState(false),[nativeEditing,setNativeEditing]=useState(false);
 const question=localQuestion?.id===incomingQuestion.id&&(localQuestion.nativeRevision||0)>(incomingQuestion.nativeRevision||0)?localQuestion:incomingQuestion;
 async function editNative(edits){setNativeSaving(true);try{const result=await onNativeEdit({questionId:question.id,approvalId:question.nativeOfficeApproval,edits});if(result.ok===false)throw Object.assign(Error(result.error),{detail:result.detail});setLocalQuestion(result.question);return result;}finally{setNativeSaving(false);}}
 const [answering,setAnswering]=useState(false),[selection,setSelection]=useState([]),[draft,setDraft]=useState(question.draft||'');
 const form=useRef(null);
 const [hint,setHint]=useState(null),tip=useRef(null);
 function showChoice(event){
  const option=event.target.closest?.('.question-option');
  if(!option)return;
  const copy=option.querySelector('.question-option-copy');
  if(![...copy.children].some(node=>node.scrollWidth>node.clientWidth||getComputedStyle(node).display==='none'))return;
  const rect=option.getBoundingClientRect(),width=Math.min(560,innerWidth-32);
  setHint({text:option.title,left:Math.max(16,Math.min(rect.left,innerWidth-width-16)),width,...(rect.bottom+200<innerHeight?{top:rect.bottom+8}:{bottom:innerHeight-rect.top+8})});
 }
 useEffect(()=>{if(!hint)return;const hide=()=>setHint(null);window.addEventListener('resize',hide);document.addEventListener('scroll',hide,true);return()=>{window.removeEventListener('resize',hide);document.removeEventListener('scroll',hide,true);};},[hint]);
 useEffect(()=>{
  const focus=event=>{if(event.detail!==question.id)return;form.current?.scrollIntoView({block:'center'});form.current?.querySelector('button:not(:disabled),textarea:not(:disabled)')?.focus({preventScroll:true});};
  document.addEventListener('nubi-open-decision',focus);return()=>document.removeEventListener('nubi-open-decision',focus);
 },[question.id]);
 return <section ref={form} className="nubi-question-form nubi-question-inline" data-decision-id={question.id} aria-label="답변이 필요한 질문" aria-busy={answering}
  onPointerOver={showChoice} onFocusCapture={showChoice} onKeyDownCapture={event=>{if(event.key==='Escape')setHint(null);}}
  onPointerLeave={event=>{if(!tip.current?.contains(event.relatedTarget))setHint(null);}} onBlurCapture={()=>setHint(null)}>
  <span className="nubi-question-caption">{question.toolRequest?<TerminalMark size={16}/>:<Icon name="helpCircle" size={16}/>}{question.toolRequest?"도구 실행 승인":"질문"}</span>
  <p className="nubi-question-prompt">{question.text}</p>{question.browserScreenLearning&&<p className="nubi-question-learning-context">{question.screenContext?.title} / {question.screenContext?.element}<span>답변은 이 프로젝트의 화면 안내로 저장됩니다. 민감한 정보는 입력하지 마세요.</span></p>}{question.toolRequest&&<><IrreversibleNotice value={question.toolRequest.irreversible} alwaysAllowIgnored={question.toolRequest.alwaysAllowIgnored}/><p className="nubi-tool-permission">{question.toolRequest.serverId} / {question.toolRequest.tool}</p>{question.excelPreview&&<NativeExcelPreview preview={question.excelPreview} title={question.documentTitle} onEdit={onNativeEdit?editNative:undefined} onEditingChange={setNativeEditing} disabled={disabled||blocked||answering||nativeSaving} saving={nativeSaving}/>}<>{question.documentPreview&&<NativeDocumentPreview preview={question.documentPreview} title={question.documentTitle} onEdit={onNativeEdit?editNative:undefined} onEditingChange={setNativeEditing} disabled={disabled||blocked||answering||nativeSaving}/>}<>{question.editorChange&&<div className="nubi-editor-change-review"><div><span>변경 전</span><pre>{question.editorChange.before||"(빈 내용)"}</pre></div><div><span>변경 후</span><pre>{question.editorChange.after||"(빈 내용)"}</pre></div></div>}<ToolArguments value={question.toolRequest.arguments} open={!question.excelPreview&&!question.documentPreview&&!question.editorChange}/></></></>}<QuestionForm maxLength={question.browserScreenLearning?1000:undefined} compact hideHeading confirmChoices showActionLabels allowText={question.inputMode!=='none'} selectionMode={question.selection==='multiple'?'multiple':'single'} selectionDraft={selection} onSelectionDraft={setSelection} question={{...question,draft}} disabled={disabled||blocked||answering||nativeSaving||nativeEditing} onDraft={value=>{setDraft(value);return onDraft(value);}} onChoose={async choice=>{setAnswering(true);try{return await onChoose({...choice,...(question.nativeOfficeApproval?{nativeOfficeApprovalId:question.nativeOfficeApproval}:{})});}finally{setAnswering(false);}}}/>
  {hint&&createPortal(<div ref={tip} role="tooltip" className="nubi-question-choice-hint" style={{left:hint.left,width:hint.width,top:hint.top,bottom:hint.bottom}} onPointerLeave={()=>setHint(null)}>{hint.text}</div>,document.body)}
 </section>;
}
