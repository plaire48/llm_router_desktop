import React,{useEffect,useState} from 'react';
import {createProgressEstimator,progressEstimateLabel} from './remaining-time.mjs';

export function ProgressEstimate({active=true,identity,completed,total}){
 const [estimate,setEstimate]=useState({state:'unknown'});
 const [sample]=useState(createProgressEstimator);
 useEffect(()=>{
  if(!active){sample({});setEstimate({state:'unknown'});return;}
  const update=()=>setEstimate(sample({id:identity,completed,total,now:performance.now()}));
  update();const timer=setInterval(update,1000);return()=>clearInterval(timer);
 },[active,identity,completed,total,sample]);
 if(!active)return null;
 return <small className="nubi-progress-estimate" data-estimate-state={estimate.state} title="현재 단계에서 실제 처리한 양과 속도로 추정해요. 파일 크기와 네트워크, AI 응답 속도에 따라 달라질 수 있어요.">{progressEstimateLabel(estimate)}</small>;
}
