import React,{useCallback,useState} from 'react';
import {WorkflowRunView} from '../ui/WorkflowRunView.jsx';
const count=Number(new URLSearchParams(location.search).get('many'))||4;
const steps=Array.from({length:count},(_,i)=>({id:'step-'+i,name:['자료 확인','초안 작성','외부 반영 승인','결과 정리'][i]||'합성 단계 '+i,kind:i===1?'agent':i===2?'human':'tool',action_summary:'합성 자료 확인 '+i,...(i===1?{done_when:{kind:'output_schema'}}:i===2?{}:{adapter:'documents.read'}),...(count>20?{lane:'lane-'+Math.floor(i/10)}:{})}));
const workflow={name:'합성 업무 실행',steps,metrics:{expectedMinutes:12},...(count>20?{lanes:Array.from({length:Math.ceil(count/10)},(_,i)=>({id:'lane-'+i,name:'합성 묶음 '+(i+1)}))}:{})};
const initial={id:'synthetic-execution',taskId:'umbrella',workflow,status:'waiting',cursor:'step-2',supervised:false,createdAt:new Date(Date.now()-65000).toISOString(),updatedAt:'revision1',steps:{'step-0':{status:'complete',receipts:['synthetic-receipt-1']},'step-1':{status:'complete',taskId:'child',summary:'합성 초안을 정리했어요.',outputs:['out1']},'step-2':{status:'waiting',phase:'human'}},outputCards:[{id:'out1',path:'out/synthetic.md',size:20,taskId:'child'}],report:'# 합성 실행 보고서\n\n확인된 영수증을 기록했어요.'};
export function WorkflowRunDemo(){
 const [run,setRun]=useState(new URLSearchParams(location.search).has('complete')?{...initial,status:'complete',finishedAt:new Date().toISOString()}:initial);
 window.updateExecutionStatuses=()=>setRun(previous=>({...previous,updatedAt:'revision-statuses',steps:{...previous.steps,'step-0':{...previous.steps['step-0'],status:'running'},'step-3':{status:'failed'}}}));
 const api=useCallback(async(name,args)=>{
  window.executionCalls.push({name,args});
  if(name==='workflowRun'){
   const question={id:'approval',kind:'choice',workflow:{stepId:'step-2',phase:'human'},text:'합성 결과를 반영할까요?',inputMode:'none',selection:'single',options:[{id:'approve',label:'승인'},{id:'stop',label:'중단'}],toolRequest:{serverId:'synthetic',tool:'write',arguments:{path:'synthetic'}}};
   return {run,task:{id:'umbrella',state:'waiting_input',chapters:[],...(run.status==='complete'?{}:{question})}};
  }
  if(name==='conversationHistory')return {id:'child',request:'하위 대화 원래 요청',trace:[{id:'child-run:0',runId:'child-run',tool:'read_source',status:'done'}],origin:{kind:'workflow_step',runId:run.id,stepId:'step-1'},chapters:[],messages:[{role:'user',content:'합성 초안 요청'},{role:'assistant',content:'펼친 하위 대화 전체 내용'}]};
  if(name==='answerAgent'||name==='saveQuestionDraft')return {};
  if(name==='cancelWorkflow'){setRun({...run,status:'cancelled',updatedAt:'revision2'});return {};}
  throw Error('unexpected_method:'+name);
 },[run]);
 window.executionCalls||=[];
 return <WorkflowRunView api={api} runId={run.id} onOpenOutput={card=>{window.openedWorkflowOutput=card;}}/>;
}

export {initial as workflowExecutionRun};
