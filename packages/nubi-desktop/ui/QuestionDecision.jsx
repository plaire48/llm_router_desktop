import React,{useEffect,useRef,useState} from 'react';
import {Icon} from '@e2e/cx-design-system';
import {QuestionForm} from '../../../extensions/aipro-chat/src/QuestionForm.jsx';
import './question-inline.css';

export function QuestionDecision({question,disabled,blocked,onChoose,onDraft}){
 const [answering,setAnswering]=useState(false),[selection,setSelection]=useState([]),[draft,setDraft]=useState(question.draft||'');
 const form=useRef(null);
 useEffect(()=>{
  const focus=event=>{if(event.detail!==question.id)return;form.current?.scrollIntoView({block:'center'});form.current?.querySelector('button:not(:disabled),textarea:not(:disabled)')?.focus({preventScroll:true});};
  document.addEventListener('nubi-open-decision',focus);return()=>document.removeEventListener('nubi-open-decision',focus);
 },[question.id]);
 return <section ref={form} className="nubi-question-form nubi-question-inline" data-decision-id={question.id} aria-label="답변이 필요한 질문" aria-busy={answering}>
  <span className="nubi-question-caption"><Icon name="helpCircle" size={16}/>질문</span>
  <p className="nubi-question-prompt">{question.text}</p><QuestionForm compact hideHeading confirmChoices showActionLabels selectionDraft={selection} onSelectionDraft={setSelection} question={{...question,draft}} disabled={disabled||blocked||answering} onDraft={value=>{setDraft(value);return onDraft(value);}} onChoose={async choice=>{setAnswering(true);try{return await onChoose(choice);}finally{setAnswering(false);}}}/>
 </section>;
}
