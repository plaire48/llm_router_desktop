import {sameWorkflowView} from './workflow-view.mjs';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {CxButton} from '@e2e/cx-design-system';
import {WorkflowTimeline} from './WorkflowTimeline.jsx';
import {WorkflowMiniMap} from './WorkflowMiniMap.jsx';
import {WorkflowStatusBar} from './WorkflowStatusBar.jsx';
import './workflow.css';
export {workflowRunStatus} from './WorkflowStatusBar.jsx';
export function WorkflowRunView({api,runId,onOpenOutput,onOpenTask,renderDecisions,embedded=false}){
 const latest=useRef(null),root=useRef(null),epoch=useRef(0);const [view,setView]=useState(null),[error,setError]=useState(''),[selected,setSelected]=useState(null),[jump,setJump]=useState(null),[busy,setBusy]=useState(false);
 const accept=useCallback(value=>{if(!sameWorkflowView(latest.current,value)){latest.current=value;setView(value);}},[]);
 useEffect(()=>{let live=true,timer;epoch.current++;latest.current=null;setView(null);setSelected(null);setBusy(false);setError('');async function poll(){try{const value=await api('workflowRun',{runId});if(!live)return;accept(value);if(!['complete','partial','failed','cancelled'].includes(value.run.status))timer=setTimeout(poll,2000);}catch{if(live)setError('실행 상태를 불러오지 못했어요.');}}void poll();return()=>{live=false;epoch.current++;clearTimeout(timer);};},[api,runId,accept]);
 async function act(work){if(busy)return false;const current=epoch.current;setBusy(true);try{setError('');await work();const value=await api('workflowRun',{runId});if(current!==epoch.current)return false;accept(value);return true;}catch{if(current===epoch.current)setError('처리하지 못했어요. 현재 상태를 다시 확인해 주세요.');return false;}finally{if(current===epoch.current)setBusy(false);}}
 const onJump=useCallback(chapter=>{if(!chapter)return;setSelected(chapter.stepId);setJump(chapter.stepId);},[]);
 useEffect(()=>{if(!jump)return;let frame;let attempts=0;const scroll=()=>{const node=root.current?.querySelector('[data-step-id="'+CSS.escape(jump)+'"]');if(node){node.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});setJump(null);}else if(attempts++<8)frame=requestAnimationFrame(scroll);};frame=requestAnimationFrame(scroll);return()=>cancelAnimationFrame(frame);},[jump]);
 if(!view)return <p role={error?'alert':'status'}>{error||'실행 상태를 불러오고 있어요.'}</p>;
 const {run,task}=view,focus=selected||run.cursor,questionTaskId=task?.questionTaskId||task?.id;
 return <section ref={root} className="nubi-workflow-run" aria-label="워크플로우 실행 상태" aria-busy={busy}><WorkflowStatusBar embedded={embedded} run={run} task={task} onResume={()=>act(()=>api('resumeWorkflow',{runId}))} onDecision={()=>{onJump({stepId:task?.question?.workflow?.stepId||run.cursor});requestAnimationFrame(()=>document.dispatchEvent(new CustomEvent('nubi-open-decision',{detail:task?.question?.id||task?.decisions?.[0]?.record.id})));}}/>{error&&<p role="alert">{error}</p>}<div className="nubi-workflow-execution"><WorkflowTimeline onNativeEdit={args=>api('reviseNativeOfficeDraft',{taskId:questionTaskId,...args})} renderDecisions={renderDecisions} api={api} run={run} task={task} selected={focus} onJump={onJump} onDraft={draft=>api('saveQuestionDraft',{taskId:questionTaskId,questionId:task.question.id,draft})} onAnswer={choice=>act(()=>api('answerAgent',{taskId:questionTaskId,choice}))} onOpenOutput={onOpenOutput||(()=>{setError('산출물은 누비 대화에서 열어 주세요.');})}/><WorkflowMiniMap run={run} onJump={onJump}/></div><div className="nubi-workflow-actions">{!['complete','partial','failed','cancelled'].includes(run.status)&&<CxButton disabled={busy} onClick={()=>act(()=>api('cancelWorkflow',{runId}))}>중단</CxButton>}</div></section>;
}
