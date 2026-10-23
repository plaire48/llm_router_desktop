import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {FolderMark} from './marks.jsx';
import {durationLabel} from '../runtime/response-timing.mjs';
import {GitCloneProgress} from './GitCloneProgress.jsx';
import {TaskProgressBar} from './TaskProgressBar.jsx';
import {motionDuration} from './motion-policy.mjs';
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
  <div className="nubi-git-clone-stage"><span key={transition.stage} className="nubi-project-stage-label" aria-live="polite">{label}</span><time aria-label="경과 시간">{durationLabel(elapsed,{keepSeconds:true})} 경과</time></div>
  <TaskProgressBar label={label}/>
  {elapsed>=15000&&<p className="nubi-project-open-wait">{['selecting','selecting_zip'].includes(transition.stage)?'선택 창에서 위치를 지정해 주세요.':'아직 처리 중이에요. 완료되면 자동으로 열립니다.'}</p>}
 </section>;
}
export function ProjectSwitchCover({progress,transition}){
 const node=useRef(null),active=!!(progress||transition),[retained,setRetained]=useState(null);
 // Keep only the outgoing picture for the shared exit duration. Input belongs
 // to the ready project immediately; a new opening cancels the old cleanup.
 useLayoutEffect(()=>{
  if(active){setRetained({progress,transition});return;}
  if(!retained)return;
  const timer=setTimeout(()=>setRetained(null),motionDuration('exit',node.current));
  return()=>clearTimeout(timer);
 },[progress,transition,active]);
 const leaving=!active&&!!retained,shown=active?{progress,transition}:retained;
 return <div ref={node} className="nubi-project-switch-cover" data-leaving={leaving||undefined} role="status" aria-label="프로젝트 여는 중" aria-busy={active} aria-hidden={!active||undefined} inert={!active||undefined}>
  <div className="nubi-project-switch-scene">
   <div className="nubi-preparing-brand" aria-hidden="true"><AgentMark size={56}/><NubiWordmark/><span>Workspace</span></div>
   {shown?.progress?<GitCloneProgress progress={shown.progress}/>:shown?.transition?<ProjectOpenProgress transition={shown.transition}/>:<div className="nubi-preparing-bar" aria-hidden="true"><span/></div>}
  </div>
 </div>;
}
