import React,{createContext,useCallback,useContext,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createPortal,flushSync} from 'react-dom';
import {CxButton,Icon} from '@e2e/cx-design-system';
import './conversation-decisions.css';

const DecisionContext=createContext(null);
const DecisionActionContext=createContext(null);
export const DecisionActionProvider=DecisionActionContext.Provider;
export function useDecisionAction(){return useContext(DecisionActionContext)||((operation)=>operation?.());}
// Let the acknowledgement paint before editor/model preparation can occupy the
// renderer. Hidden windows must still dispatch the user's accepted action.
function paintAcknowledgement(){
 return new Promise(resolve=>{
  let frame;const finish=()=>{clearTimeout(timer);cancelAnimationFrame(frame);resolve();};
  const timer=setTimeout(finish,document.hidden?0:100);
  if(!document.hidden)frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(finish);});
 });
}
export function useDecisionSubmission(){
 const [pending,setPending]=useState(false),locked=useRef(false);
 const {onSubmit,claim,release}=useContext(DecisionContext)||{};
 const submit=useCallback(async operation=>{
  if(locked.current||!operation||claim?.()===false)return;locked.current=true;
  try{flushSync(()=>{setPending(true);onSubmit?.();});await paintAcknowledgement();return await operation();}
  finally{locked.current=false;release?.();setPending(false);}
 },[onSubmit,claim,release]);
 return {pending,submit};
}

// Only live decisions leave their chronological position. Completed records
// remain in the transcript, owned by the original run/message.
export function ConversationDecisionProvider({children,onSubmit}){
 const [host,setHost]=useState(null),[items,setItems]=useState([]),[selected,setSelected]=useState(null);
 const submitting=useRef(false);
 const claim=useCallback(()=>{if(submitting.current)return false;submitting.current=true;return true;},[]);
 const release=useCallback(()=>{submitting.current=false;},[]);
 const register=useCallback(item=>{
  setItems(current=>[...current.filter(row=>row.key!==item.key),item].sort((a,b)=>{
   const position=a.anchor.compareDocumentPosition(b.anchor);
   return position&Node.DOCUMENT_POSITION_FOLLOWING?-1:position&Node.DOCUMENT_POSITION_PRECEDING?1:0;
  }));
  return()=>setItems(current=>current.filter(row=>row.key!==item.key));
 },[]);
 const waiting=items.filter(item=>!item.submitting);
 const active=items.some(item=>item.submitting)?null:waiting.find(item=>item.key===selected)||waiting.find(item=>!item.blocked)||waiting[0];
 const select=useCallback(key=>setSelected(key),[]);
 useEffect(()=>{
  const reveal=event=>{
   const item=items.find(row=>row.id===event.detail);if(!item)return;
   setSelected(item.key);
   requestAnimationFrame(()=>{
    const panel=host?.querySelector('[data-decision-panel]:not([hidden])');
    const target=panel?.querySelector('[data-decision-id][tabindex="-1"]')||panel?.querySelector('button:not(:disabled),textarea:not(:disabled)');
    target?.focus({preventScroll:true});
   });
  };
  document.addEventListener('nubi-open-decision',reveal);
  return()=>document.removeEventListener('nubi-open-decision',reveal);
 },[items,host]);
 const value=useMemo(()=>({host,setHost,items,active:active?.key,register,select,onSubmit,claim,release}),[host,items,active?.key,register,select,onSubmit,claim,release]);
 return <DecisionContext.Provider value={value}>{children}</DecisionContext.Provider>;
}

export function ConversationDecision({id,blocked=false,submitting=false,statusLabel='선택한 동작을 처리하고 있어요',children}){
 const context=useContext(DecisionContext),anchor=useRef(null),[key]=useState(()=>Symbol('decision'));
 const register=context?.register;
 useLayoutEffect(()=>{
  if(register)return register({key,id,blocked,submitting,statusLabel,anchor:anchor.current});
 },[register,key,id,blocked,submitting,statusLabel]);
 if(!context)return children;
 const active=context.active===key;
 return <><span ref={anchor} hidden data-decision-anchor={id}/>{context.host&&createPortal(
  <div data-decision-panel={id} hidden={!active||submitting} inert={!active||submitting} aria-hidden={!active||submitting||undefined}>{children}</div>,context.host
 )}</>;
}

export function ConversationDecisionHost(){
 const context=useContext(DecisionContext);
 if(!context)return null;
 const {active,select,setHost}=context,items=context.items.filter(item=>!item.submitting),index=items.findIndex(item=>item.key===active);
 return <section className="nubi-conversation-decisions" aria-label="확인이 필요한 항목" hidden={!items.length||context.items.some(item=>item.submitting)}>
  {items.length>1&&<nav className="nubi-decision-pages" aria-label="확인 항목 이동">
   <output aria-live="polite" aria-label="현재 확인 항목">{index+1}/{items.length}</output>
   <CxButton data-icon-only aria-label="이전 확인 항목" title="이전 확인 항목" disabled={index<=0} onClick={()=>select(items[index-1].key)}><Icon name="chevronLeft" size={16}/></CxButton>
   <CxButton data-icon-only aria-label="다음 확인 항목" title="다음 확인 항목" disabled={index>=items.length-1} onClick={()=>select(items[index+1].key)}><Icon name="chevronRight" size={16}/></CxButton>
  </nav>}
  <div ref={setHost} className="nubi-decision-panels"/>
 </section>;
}

export function ConversationDecisionActivity({working=false,label}){
 const context=useContext(DecisionContext);
 const submissions=context?.items.filter(item=>item.submitting)||[];
 if(!submissions.length)return working?<p className="nubi-decision-submission nubi-working-status" role="status"><span className="status-spinner" aria-hidden="true"/>{label||'요청한 동작을 처리하고 있어요'}</p>:null;
 return submissions.map(item=><p className="nubi-decision-submission nubi-working-status" key={item.id} data-decision-submission={item.id} role="status"><span className="status-spinner" aria-hidden="true"/>{label||item.statusLabel}</p>);
}

export function QuestionReceipt({question}){
 return <details className="nubi-decision-receipt" data-question-receipt={question.id}>
  <summary><span>{question.text}</span><small>답변 완료</small><Icon name="chevronDown" size={16}/></summary>
  <p>{question.answer?.text||question.answer?.label||'답변을 전달했습니다.'}</p>
 </details>;
}
