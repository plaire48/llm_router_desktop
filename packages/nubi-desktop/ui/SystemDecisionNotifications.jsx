import {useEffect,useRef} from 'react';
import {recordNotice} from './notice-store.js';
import {notifyWorkspaceToast} from './WorkspaceToast.jsx';
const DECISION_LABEL={question:'답변 요청',proposal:'변경 승인 요청',command:'실행 승인 요청',computer:'앱 동작 확인'};

// Windows owns notification placement and dismissal. This component renders nothing.
export function SystemDecisionNotifications({decisions,onOpen,onAnswer}){
 const sent=useRef(new Map()),latest=useRef({decisions,onOpen,onAnswer});latest.current={decisions,onOpen,onAnswer};
 const signature=decisions.map(row=>row.id).sort().join('\n');
 useEffect(()=>{
  if(!window.nubi?.desktop)return;
  const next=new Map(latest.current.decisions.map(row=>[row.id,row]));
  for(const id of sent.current.keys())if(!next.has(id))void window.nubi.request('decisionNotice',{id,action:'clear'}).catch(()=>{});
  for(const [id,row] of next)if(!sent.current.has(id)){
   const notifyQuestion=row.kind==='question'&&row.question?row.question:null;
   void window.nubi.request('decisionNotice',{id,kind:row.kind,projectName:row.projectName,taskTitle:row.taskTitle,summary:row.summary,action:'show',...(notifyQuestion?{choices:(notifyQuestion.options||[]).slice(0,4).map(option=>option.label),allowText:notifyQuestion.inputMode!=='none',placeholder:notifyQuestion.inputPlaceholder||'답변 입력'}:{})}).catch(()=>{});
   // The same request shows in the app: a toast with an open action, and a notice the bell keeps (user request 2026-10-14).
   const text=`${DECISION_LABEL[row.kind]||DECISION_LABEL.question}: ${String((row.kind==='question'?row.summary:row.taskTitle)||row.summary||'대화를 확인해 주세요.').replace(/\s+/g,' ').slice(0,120)}`;
   const open=()=>{const current=latest.current.decisions.find(item=>item.id===id);if(current)void latest.current.onOpen(current);};
   recordNotice({text,kind:'decision',source:'decision',action:{label:'열기',onClick:open}});
   // The in-app toast is a plain notice with '열기'; the choices and reply box are on the Windows notification (user clarification 2026-10-14).
   notifyWorkspaceToast(text,{action:{label:'열기',onClick:open}});
  }
  sent.current=next;
 },[signature]);
 useEffect(()=>{
  const off=window.nubi?.onHostEvent?.(event=>{
   if(event.type==='decision_answer'){
    // A choice or reply made on the Windows notification: the same answer request as the conversation's form.
    const current=latest.current.decisions.find(row=>row.id===event.id);
    if(!current||current.kind!=='question'||!current.question||typeof latest.current.onAnswer!=='function')return;
    const option=typeof event.choice==='string'?(current.question.options||[]).find(item=>item.label===event.choice):null;
    if(option)void latest.current.onAnswer(current,{questionId:current.question.id,optionId:option.id});
    else if(typeof event.text==='string'&&event.text.trim())void latest.current.onAnswer(current,{questionId:current.question.id,text:event.text.trim()});
    return;
   }
   if(event.type!=='decision_open')return;
   const current=latest.current.decisions.find(row=>row.id===event.id);
   if(current)void latest.current.onOpen(current);
  });
  return()=>{off?.();for(const id of sent.current.keys())void window.nubi?.request?.('decisionNotice',{id,action:'clear'}).catch(()=>{});sent.current.clear();};
 },[]);
 return null;
}
