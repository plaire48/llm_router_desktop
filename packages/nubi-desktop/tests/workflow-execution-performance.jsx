import React,{useState} from 'react';
import {WorkflowTimeline} from '../ui/WorkflowTimeline.jsx';
import {WorkflowMiniMap} from '../ui/WorkflowMiniMap.jsx';
import {WorkflowStatusBar} from '../ui/WorkflowStatusBar.jsx';
const makeWorkflow=count=>{const steps=Array.from({length:count},(_,i)=>({id:'step-'+i,name:'합성 단계 '+i,kind:'tool',action_summary:'합성 자료 확인',lane:'lane-'+i%3}));
return {name:'합성 실행 성능',steps,lanes:[{id:'lane-0',name:'자료'},{id:'lane-1',name:'판단'},{id:'lane-2',name:'검토'}]};};
export function WorkflowExecutionPerformance({count=150}){const [run,setRun]=useState(()=>({id:'performance-run',workflow:makeWorkflow(count),status:'running',cursor:'step-0',createdAt:new Date().toISOString(),steps:{'step-0':{status:'running'}}}));window.advanceWorkflow=index=>setRun(previous=>({...previous,workflow:structuredClone(previous.workflow),cursor:'step-'+index,steps:{...previous.steps,['step-'+(index-1)]:{status:'complete'},['step-'+index]:{status:'running'}}}));return <section className="nubi-workflow-run" data-performance-step-count={run.workflow.steps.length}><WorkflowStatusBar run={run}/><div className="nubi-workflow-execution"><WorkflowTimeline run={run} selected={run.cursor} onJump={()=>{}}/><WorkflowMiniMap run={run} onJump={()=>{}}/></div></section>;}
