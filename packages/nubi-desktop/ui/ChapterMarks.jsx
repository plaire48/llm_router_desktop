import React,{useEffect,useState} from 'react';
import {workflowChapterGroups} from '../runtime/workflow-chapters.mjs';
import {CxButton,Icon} from '@e2e/cx-design-system';
import './chapter-marks.css';
export function ChapterDivider({chapter}){
 return <div className="nubi-chapter" id={'chapter-'+chapter.id} role="separator" aria-label={`챕터 ${chapter.title}`}><Icon name="bookmark" size={14}/><strong>{chapter.title}</strong>{chapter.summary&&<span title={chapter.summary}>{chapter.summary}</span>}</div>;
}
function WorkflowChapterLinks({chapters,current,onJump}){
 const selected=Math.max(0,chapters.findIndex(chapter=>chapter.stepId===current)),[page,setPage]=useState(Math.floor(selected/10));
 useEffect(()=>setPage(Math.floor(selected/10)),[current]);
 const virtual=chapters.length>=50,visible=virtual?chapters.slice(page*10,page*10+10):chapters;
 return <>{virtual&&page>0&&<CxButton onClick={()=>setPage(value=>value-1)}>이전 목차</CxButton>}{visible.map(chapter=><CxButton key={chapter.id} aria-current={current===chapter.stepId?'step':undefined} onClick={()=>onJump(chapter)}><span title={chapter.summary}>{chapter.title}</span></CxButton>)}{virtual&&(page+1)*10<chapters.length&&<CxButton onClick={()=>setPage(value=>value+1)}>다음 목차</CxButton>}</>;
}
export function ChapterContents({chapters=[],onJump,current,lanes=[]}){
 const groups=workflowChapterGroups(chapters,current),active=groups.find(group=>group.current)?.id;
 const [open,setOpen]=useState(active);useEffect(()=>setOpen(active),[active,current]);
 if(chapters[0]?.stepId)return <nav className="nubi-workflow-contents" aria-label="챕터 목차">{chapters.length<=20?<WorkflowChapterLinks chapters={chapters} current={current} onJump={onJump}/>:groups.map(group=><details key={group.id} open={open===group.id} onToggle={event=>{if(event.currentTarget.open)setOpen(group.id);}}><summary>{lanes.find(lane=>lane.id===group.lane)?.name||group.title}</summary>{open===group.id&&<WorkflowChapterLinks chapters={group.chapters} current={current} onJump={onJump}/>}</details>)}</nav>;
 if(chapters.length<2)return null;
 return <nav className="nubi-chapter-contents" aria-label="챕터 목차">{chapters.map((chapter,index)=><CxButton key={chapter.id} onClick={()=>onJump(chapter)}><span>{index+1}</span><span title={chapter.summary}>{chapter.title}</span></CxButton>)}</nav>;
}
