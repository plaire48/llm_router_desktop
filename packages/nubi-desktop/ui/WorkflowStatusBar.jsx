import React,{useEffect,useMemo,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
export const workflowRunStatus={pending:'미실행',running:'실행 중',waiting:'대기',unconfirmed:'결과 확인 대기',complete:'완료',skipped:'건너뜀',partial:'일부 완료',failed:'실패',cancelled:'중단'};
export function WorkflowStatusBar({run,task,onDecision,onResume,embedded=false}){
 const name=useMemo(()=>run.workflow.name,[run.workflow]),[now,setNow]=useState(Date.now());
 useEffect(()=>{if(run.finishedAt)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[run.id,run.finishedAt]);
 const elapsed=Math.max(0,Math.floor(((Date.parse(run.finishedAt)||now)-(Date.parse(run.startedAt||run.createdAt)||now))/1000));
 const checkpoint=run.steps?.[run.cursor]||{},waiting=['waiting','unconfirmed'].includes(run.status)||!!task?.question||task?.decisions?.length>0;
 const reason=run.status==='unconfirmed'||checkpoint.status==='unconfirmed'?'이전 실행 결과를 확인하는 중이에요':task?.question?.workflow?.phase==='supervision'||checkpoint.phase==='supervision'?'다음 단계를 실행할까요':(task?.question?.toolRequest||task?.decisions?.length)?'외부 반영 전에 확인이 필요해요':checkpoint.reason==='process_running'?'명령 실행 결과를 기다리고 있어요':checkpoint.reason==='workflow_action_pending'?'진행 중인 작업의 결과를 기다리고 있어요':'답을 기다리고 있어요';
 return <header className="nubi-workflow-status"><div className="nubi-workflow-status-heading">{!embedded&&<h2>{name}</h2>}<span className="nubi-pill" data-status={run.status}>{workflowRunStatus[run.status]||'확인 필요'}</span></div><div className="nubi-workflow-timing"><span>경과 {Math.floor(elapsed/60)}분 {elapsed%60}초</span>{Number.isFinite(run.workflow.metrics?.expectedMinutes)&&<span>원본 예상 {run.workflow.metrics.expectedMinutes}분</span>}{run.supervised&&<span>이번 실행은 단계마다 확인</span>}</div>{waiting&&<div className="nubi-workflow-wait"><p><Icon name="infoCircle" size={18}/><span>{reason}</span></p><CxButton onClick={task?.question||task?.decisions?.length?onDecision:onResume}>{task?.question||task?.decisions?.length?'확인하기':'다시 확인'}</CxButton></div>}</header>;
}
