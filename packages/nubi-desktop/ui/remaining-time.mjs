import {durationLabel} from '../runtime/response-timing.mjs';

// Estimate only observed work in this phase. Persisted completed items on resume
// are a baseline, not work done in the current measurement window.
export function createProgressEstimator(){
 let baseline=null;
 return ({id,completed,total,now})=>{
  if(!Number.isFinite(completed)||completed<0||!Number.isFinite(total)||total<=0||!Number.isFinite(now)){baseline=null;return {state:'unknown'};}
  if(!baseline||baseline.id!==id||completed<baseline.last||total!==baseline.total){baseline={id,count:completed,last:completed,total,at:now};}
  baseline.last=completed;
  if(completed>=total)return {state:'finishing'};
  const count=completed-baseline.count,elapsed=now-baseline.at;
  if(count<=0||elapsed<1000)return {state:'measuring'};
  const remainingMs=elapsed/count*(total-completed);
  return Number.isFinite(remainingMs)?{state:'estimated',remainingMs}:{state:'measuring'};
 };
}
export function progressEstimateLabel(estimate){
 if(estimate.state==='unknown')return '전체 작업량 확인 중';
 if(estimate.state==='measuring')return '처리 속도 확인 중';
 if(estimate.state==='finishing')return '마무리 확인 중';
 return `현재 단계 약 ${durationLabel(Math.max(5,Math.ceil(estimate.remainingMs/5000)*5)*1000,{keepSeconds:true})} 남음`;
}
