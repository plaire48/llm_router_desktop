import React,{useLayoutEffect,useRef,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {AgentMark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import {WikiInitializationProgress} from './WikiInitializationProgress.jsx';
import {FolderMark} from './marks.jsx';
import './nubi-preparing.css';
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
export function ProjectWikiProgress({job,projectName,projectRoot,onStop}){
  const node=useRef(null),edge=useWorkbenchEdge(node);
  return <section ref={node} className="nubi-project-wiki-progress" style={edge||undefined} aria-label="프로젝트 위키 작성" aria-busy="true">
    <div className="nubi-project-wiki-progress-body">
      <div className="nubi-preparing-emblem" aria-hidden="true"><span className="nubi-preparing-orbit"/><AgentMark size={76} mood="still"/></div>
      <WikiProjectIdentity name={projectName} root={projectRoot}/>
      <h2>{job?.kind==='update'?'위키를 갱신하고 있어요':'위키를 만들고 있어요'}</h2>
      <p>완료되면 이 프로젝트에서 대화할 수 있어요.</p>
      <WikiInitializationProgress job={job}/>
      <CxButton onClick={onStop} aria-label="위키 작성 중지"><Icon name="xClose" size={16}/>중지</CxButton>
    </div>
  </section>;
}
