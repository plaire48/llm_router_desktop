import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from '@e2e/cx-design-system';
import {QuestionForm} from '../../../extensions/aipro-chat/src/QuestionForm.jsx';
import './question-inline.css';

export function QuestionDecision({question,disabled,blocked,onChoose,onDraft}){
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
  <span className="nubi-question-caption"><Icon name="helpCircle" size={16}/>질문</span>
  <p className="nubi-question-prompt">{question.text}</p><QuestionForm compact hideHeading confirmChoices showActionLabels selectionMode={question.selection==='multiple'?'multiple':'single'} selectionDraft={selection} onSelectionDraft={setSelection} question={{...question,draft}} disabled={disabled||blocked||answering} onDraft={value=>{setDraft(value);return onDraft(value);}} onChoose={async choice=>{setAnswering(true);try{return await onChoose(choice);}finally{setAnswering(false);}}}/>
  {hint&&createPortal(<div ref={tip} role="tooltip" className="nubi-question-choice-hint" style={{left:hint.left,width:hint.width,top:hint.top,bottom:hint.bottom}} onPointerLeave={()=>setHint(null)}>{hint.text}</div>,document.body)}
 </section>;
}
