import React,{useState} from 'react';
import {QuestionForm} from '../../../extensions/aipro-chat/src/QuestionForm.jsx';
import {DecisionPrompt} from './DecisionPrompt.jsx';

export function QuestionDecision({question,disabled,blocked,onChoose,onDraft}){
 const [answering,setAnswering]=useState(false),[selection,setSelection]=useState([]),[draft,setDraft]=useState(question.draft||'');
 return <DecisionPrompt questionSheet captionHint={question.kind==='choice'&&question.options?.length?'여러 개 선택 가능':undefined} id={question.id} title={question.text} summary={question.text} label="답변하기" blocked={blocked||disabled||answering}>
  {({onDefer})=><div className="nubi-question-form"><p className="nubi-question-prompt">{question.text}</p><QuestionForm compact hideHeading confirmChoices showActionLabels onDefer={onDefer} selectionDraft={selection} onSelectionDraft={setSelection} question={{...question,draft}} disabled={disabled} onDraft={value=>{setDraft(value);return onDraft(value);}} onChoose={async choice=>{setAnswering(true);try{return await onChoose(choice);}finally{setAnswering(false);}}}/></div>}
 </DecisionPrompt>;
}
