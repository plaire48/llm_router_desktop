import {frameCoalescer} from './frame-coalescer.mjs';
import React,{lazy,Suspense,useCallback,useEffect,useRef,useState} from 'react';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {workflowChapters} from '../runtime/workflow-chapters.mjs';
const Canvas=lazy(()=>import('./WorkflowCanvas.jsx').then(module=>({default:module.WorkflowCanvas})));
export function WorkflowMiniMap({run,onJump}){
 const latest=useRef({run,onJump});latest.current={run,onJump};const select=useCallback(step=>{const value=latest.current;value.onJump(workflowChapters(value.run).find(chapter=>chapter.stepId===step.id));},[]);
 const root=useRef(null);
 const [narrow,setNarrow]=useState(()=>matchMedia('(max-width: 27.5em)').matches),[expanded,setExpanded]=useState(false);
 useEffect(()=>{const owner=root.current?.closest('.nubi-workflow-run');if(!owner)return;const queue=frameCoalescer(width=>{const unit=parseFloat(getComputedStyle(document.documentElement).fontSize)||16;setNarrow(width<=27.5*unit);});const observer=new ResizeObserver(entries=>queue.schedule(entries[0].contentRect.width));observer.observe(owner);return()=>{observer.disconnect();queue.cancel();};},[]);
 const hidden=narrow&&!expanded;
 return <aside ref={root} className="nubi-workflow-minimap" aria-label="단계 지도"><div className="nubi-workflow-map-title"><strong>단계 지도</strong>{narrow&&<CxButton aria-label={expanded?'단계 지도 접기':'단계 지도 펼치기'} title={expanded?'단계 지도 접기':'단계 지도 펼치기'} aria-expanded={expanded} onClick={()=>setExpanded(value=>!value)}><Icon name={expanded?'chevronUp':'chevronDown'} size={16}/></CxButton>}</div><div className="nubi-workflow-minimap-body" hidden={hidden}><Suspense fallback={<p role="status">지도를 준비하고 있어요.</p>}><Canvas compact currentStepId={run.cursor} workflow={run.workflow} checkpoints={run.steps} onSelect={select}/></Suspense></div></aside>;
}
