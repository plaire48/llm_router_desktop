import '@e2e/cx-design-system/styles.css';
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QuestionDecision} from '../ui/QuestionDecision.jsx';
import {SystemDecisionNotifications} from '../ui/SystemDecisionNotifications.jsx';

import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
window.notices=[];window.nubi={desktop:true,request:async(method,args)=>{if(method==='decisionNotice')window.notices.push(args);return {};},onDecisionNotice:()=>()=>{}};
function App(){
 const [task,setTask]=useState(null),[error,setError]=useState('');
 const refresh=()=>fetch('/state').then(r=>r.json()).then(setTask);useEffect(()=>{void refresh();},[]);
 if(!task)return null;
 return <main className="desktop-shell" style={{display:'block',padding:16,height:'100vh',overflow:'auto'}}><div style={{maxWidth:800,margin:'auto'}}><h1 style={{fontSize:20,fontWeight:600}}>문서 변경 검토</h1><p>{task.nativeOffice?.binding?.documentTitle||task.nativeOffice?.binding?.documentId}</p>{task.question&&<><SystemDecisionNotifications decisions={[{id:task.question.id,kind:'question',question:task.question,summary:task.question.text,projectName:'검증 프로젝트'}]} onOpen={()=>{}} onAnswer={()=>{}}/><QuestionDecision question={task.question} onDraft={()=>{}} onNativeEdit={async args=>{const r=await fetch('/revise',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(args)});const value=await r.json();if(!r.ok)throw Error(value.error);return value;}} onChoose={async choice=>{const result=await fetch('/answer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(choice)});if(!result.ok){setError(await result.text());return;}await refresh();}}/></>}<output aria-label="문서 처리 상태">{task.nativeOffice?.state}</output>{error&&<p role="alert">{error}</p>}</div></main>;
}
createRoot(document.getElementById('root')).render(<App/>);
