import React,{useEffect,useState} from 'react';
import {FolderMark} from './marks.jsx';
import {durationLabel} from '../runtime/response-timing.mjs';
import {GitCloneProgress} from './GitCloneProgress.jsx';
import {AgentMark,NubiWordmark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import './nubi-preparing.css';
import './project-switch-cover.css';

// Present before the first async project request, without unmounting drafts or
// moving layout. The renderer removes the guard only after the next UI commits.
const stages={selecting:'폴더 선택 대기',selecting_zip:'ZIP 파일과 저장 위치 선택',extracting:'ZIP 파일 가져오는 중',resolving:'프로젝트 확인 중',opening:'프로젝트 불러오는 중',waiting_lock:'이전 작업 정리 대기',saving:'프로젝트 기록 저장 중',rendering:'화면 준비 중'};
function ProjectOpenProgress({transition}){
 const [elapsed,setElapsed]=useState(0);
 useEffect(()=>{const started=performance.now(),initial=Math.max(0,Date.now()-transition.startedAt);setElapsed(initial);const timer=setInterval(()=>setElapsed(initial+performance.now()-started),1000);return()=>clearInterval(timer);},[transition.startedAt]);
 const label=stages[transition.stage]||stages.opening;
 return <section className="nubi-git-clone-progress nubi-project-open-progress" aria-label="프로젝트 이동 진행">
  <div className="nubi-git-clone-heading"><FolderMark size={18}/><strong title={transition.name}>{transition.name||'프로젝트 열기'}</strong></div>
  <div className="nubi-git-clone-stage"><span aria-live="polite">{label}</span><time aria-label="경과 시간">{durationLabel(elapsed,{keepSeconds:true})} 경과</time></div>
  <progress aria-label={label}/>
  {elapsed>=15000&&<p className="nubi-project-open-wait">{['selecting','selecting_zip'].includes(transition.stage)?'선택 창에서 위치를 지정해 주세요.':'아직 처리 중이에요. 완료되면 자동으로 열립니다.'}</p>}
 </section>;
}
export function ProjectSwitchCover({progress,transition}){
 return <div className="nubi-project-switch-cover" role="status" aria-label="프로젝트 여는 중">
  <div className="nubi-preparing-brand" aria-hidden="true"><AgentMark size={56} mood="idle" lively/><NubiWordmark/><span>Workspace</span></div>
  {progress?<GitCloneProgress progress={progress}/>:transition?<ProjectOpenProgress transition={transition}/>:<div className="nubi-preparing-bar" aria-hidden="true"><span/></div>}
 </div>;
}
