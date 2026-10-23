import React,{useLayoutEffect,useRef,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {WikiInitializationProgress,WikiProgressSteps} from './WikiInitializationProgress.jsx';
import {FolderMark} from './marks.jsx';
import {TaskProgressBar} from './TaskProgressBar.jsx';
import {backgroundJobId} from './background-task-queue.mjs';
import {projectPreparation} from './project-preparation.mjs';
import {wikiProgress} from './wiki-progress.mjs';
import {AgentMark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import './project-wiki-progress.css';

export function WikiProjectIdentity({name,root}){
  if(!name&&!root)return null;
  return <div className="nubi-wiki-project-identity" aria-label="위키 대상 프로젝트"><FolderMark size={18}/><strong title={root||name}>{name||String(root).split(/[\\/]/).filter(Boolean).at(-1)}</strong></div>;
}

// The overlay is positioned against the workbench (the main column keeps a reading width and would leave
// margins beside it). Its left edge follows the sidebar's actual width, or the rail when the sidebar is closed (2026-10-14).
export function useWorkbenchEdge(node){
  const [edge,setEdge]=useState(null);
  useLayoutEffect(()=>{
    const workbench=node.current?.closest('.nubi-workbench');if(!workbench)return;
    const measure=()=>{const base=workbench.getBoundingClientRect().left,sidebar=workbench.querySelector('.nubi-sidebar'),box=sidebar?.getBoundingClientRect(),rail=parseFloat(getComputedStyle(workbench).getPropertyValue('--nubi-rail-width'))||0;const left=box&&box.width>0&&getComputedStyle(sidebar).position!=='absolute'?box.right-base:rail;const column=node.current?.parentElement?.getBoundingClientRect(),top=column?column.top-workbench.getBoundingClientRect().top:0;setEdge({left:Math.max(0,Math.round(left)),top:Math.max(0,Math.round(top))});};
    measure();const sizes=new ResizeObserver(measure);sizes.observe(workbench);const sidebar=workbench.querySelector('.nubi-sidebar');if(sidebar)sizes.observe(sidebar);
    const changes=new MutationObserver(()=>{measure();const next=workbench.querySelector('.nubi-sidebar');if(next)sizes.observe(next);});changes.observe(workbench,{childList:true});
    window.addEventListener('resize',measure);return()=>{sizes.disconnect();changes.disconnect();window.removeEventListener('resize',measure);};
  },[node]);
  return edge;
}
export function ProjectWikiProgress({job,projectName,projectRoot,onStop,onSelectScope,onOpenWiki,connected,chatNotice}){
  const [expanded,setExpanded]=useState(false),view=projectPreparation(job),ready=view.phase==='ready',progress=wikiProgress(job);
  return <section className="nubi-project-wiki-progress" data-preparation-phase={view.phase} aria-label="프로젝트 위키 작성">
    <div className="nubi-project-wiki-progress-body">
      <WikiProjectIdentity name={projectName} root={projectRoot}/>
      {job?.state==='running'&&onStop&&<CxButton data-icon-only onClick={onStop} aria-label="위키 작성 중지" title="위키 작성 중지"><Icon name="xClose" size={16}/></CxButton>}
    </div>
    {chatNotice&&<div className="nubi-wiki-chat-guide" role="note" aria-label="뱁새 안내"><AgentMark size={64} mood="working"/><p>{chatNotice}</p></div>}
    <WikiProgressSteps job={job}/>
    <strong key={view.phase} className="nubi-project-journey-title" role="status">{view.title}</strong>
    {ready?<div className="nubi-project-ready"><p>{connected?'질문을 입력하면 이 프로젝트의 자료를 함께 참고해요.':'모델을 연결하면 이 프로젝트의 자료로 대화할 수 있어요.'}</p>{onOpenWiki&&<CxButton onClick={onOpenWiki}><Icon name="bookmark" size={16}/>위키 보기</CxButton>}</div>:<>
      <WikiInitializationProgress job={job} inline/>
      {job?.state==='running'&&<><TaskProgressBar backgroundTask={backgroundJobId('wiki',job)} label={`${progress.label} 진행률`} value={progress.completed??undefined} max={progress.total} valueText={progress.remainingLabel||undefined} estimate={{identity:progress.phase,completed:progress.completed,total:progress.total}}/><div className="nubi-wiki-progress-meta"><span>{progress.remainingLabel||progress.nextLabel}</span></div>{progress.percent===100&&<small className="nubi-wiki-next-stage">{progress.nextLabel}</small>}</>}
      {view.phase==='scope'&&onSelectScope&&<CxButton variant="primary" onClick={onSelectScope}><FolderMark size={16}/>범위 선택</CxButton>}
      <details className="deck-disclosure nubi-project-preparation-detail" open={expanded} onToggle={event=>setExpanded(event.currentTarget.open)}>
        <summary><Icon name="list" size={16}/><span>준비 상세</span><Icon name="chevronDown" size={16}/></summary>
        {expanded&&<div className="deck-disclosure-body"><WikiInitializationProgress job={job} heading={false}/></div>}
      </details>
    </>}
  </section>;
}
