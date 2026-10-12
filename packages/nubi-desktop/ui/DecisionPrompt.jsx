import React,{useEffect,useRef,useState} from 'react';
import {CxButton,DetailPanel,Icon} from '@e2e/cx-design-system';
import {TerminalMark} from './marks.jsx';

// Notifications never take focus, answer questions or approve an action.
// Only a deliberate click opens a decision, and only one can be open at once.
let activeDecision=null;
export function DecisionPrompt({id,title,summary,icon='helpCircle',label='확인하기',pending=true,blocked=false,questionSheet=false,captionHint,children}){
 const [open,setOpen]=useState(false),owner=useRef(Symbol('decision')),trigger=useRef(null),latest=useRef(null);
 const release=()=>{if(activeDecision===owner.current)activeDecision=null;};
 const close=()=>{setOpen(false);release();requestAnimationFrame(()=>trigger.current?.focus({preventScroll:true}));};
 const reveal=()=>{if(!pending||blocked||(activeDecision&&activeDecision!==owner.current))return;activeDecision=owner.current;setOpen(true);};
 latest.current={reveal};
 useEffect(()=>{setOpen(false);release();},[id,pending]);
 useEffect(()=>{
  const openRequested=event=>{if(event.detail===id)latest.current.reveal();};
  document.addEventListener('nubi-open-decision',openRequested);
  return()=>document.removeEventListener('nubi-open-decision',openRequested);
 },[id]);
 useEffect(()=>()=>release(),[]);
 const mark=icon==='terminal'?<TerminalMark size={18}/>:<Icon name={icon} size={18}/>;
 return <div className="nubi-decision-prompt" data-decision-id={id}>
  <span className="nubi-decision-summary">{mark}<span title={summary}>{summary}</span></span>
  <CxButton ref={trigger} className="nubi-text-button" disabled={blocked} onClick={()=>open?close():reveal()}><Icon name="arrowRight" size={16}/>{label}</CxButton>
  {open&&<DetailPanel className="deck-dialog nubi-panel nubi-decision-dialog" title={questionSheet?<><span className="nubi-question-caption" aria-hidden="true"><Icon name="helpCircle" size={16}/>질문</span>{captionHint&&<span className="nubi-question-caption-hint" aria-hidden="true">{captionHint}</span>}<span className="visually-hidden">{title}</span></>:title} hideHelp={questionSheet} variant="modal" onClose={close} busy={blocked} initialFocus=".cx-panel-header button[data-action=close]">{typeof children==='function'?children({onDefer:close}):children}</DetailPanel>}
 </div>;
}
