import {ProgressEstimate} from './ProgressEstimate.jsx';
import React,{useEffect,useState} from 'react';
import {BranchMark} from './marks.jsx';
import {durationLabel} from '../runtime/response-timing.mjs';
const labels={destination:'저장할 폴더 선택',connecting:'저장소 연결 중',enumerating:'자료 확인 중',counting:'자료 확인 중',compressing:'전송 준비 중',receiving:'자료 받는 중',resolving:'변경 계산 중',checkout:'파일 배치 중',filtering:'추가 파일 받는 중',opening:'프로젝트 여는 중'};
export function GitCloneProgress({progress}){
 const [now,setNow]=useState(Date.now());
 useEffect(()=>{setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[progress.startedAt]);
 const percent=Number.isFinite(progress.percent)?Math.max(0,Math.min(100,progress.percent)):undefined;
 const label=labels[progress.stage]||'저장소 연결 중';
 return <section className="nubi-git-clone-progress" aria-label="Git 가져오기">
  <div className="nubi-git-clone-heading"><BranchMark size={18}/><strong>Git 가져오기</strong><time>{durationLabel(Math.max(0,now-progress.startedAt),{keepSeconds:true})}</time></div>
  <div className="nubi-git-clone-stage"><span aria-live="polite">{label}</span>{percent!==undefined&&<strong>{percent}%</strong>}</div>
  <progress aria-label={`${label} 진행률`} max="100" value={percent}/>
  <ProgressEstimate identity={`${progress.startedAt}:${progress.stage}`} completed={progress.current} total={progress.total}/>
  <div className="nubi-git-clone-detail">{progress.total>0&&<span>{progress.current.toLocaleString()} / {progress.total.toLocaleString()}</span>}{progress.transferred&&<span>{progress.transferred}{progress.speed?` (${progress.speed})`:''}</span>}</div>
 </section>;
}
