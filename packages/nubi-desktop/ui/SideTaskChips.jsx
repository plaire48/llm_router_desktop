import React from 'react';
import {CxButton} from '@e2e/cx-design-system';
import {SparklesMark} from './marks.jsx';
import {WorkspaceAction} from './WorkspaceAction.jsx';
import './side-task-chips.css';
export function SideTaskChips({chips=[],disabled=false,onStart,onDismiss}){
 const proposed=chips.filter(chip=>chip.state==='proposed');if(!proposed.length)return null;
 return <div className="nubi-side-tasks" role="group" aria-label="다음 작업 제안">{proposed.map(chip=><span className="nubi-side-task" key={chip.id}><CxButton className="nubi-side-task-start" disabled={disabled} title={chip.tldr} aria-description={chip.tldr} onClick={()=>onStart(chip)}><SparklesMark size={16}/><span>{chip.title}</span></CxButton><WorkspaceAction action="close" label={`${chip.title} 제안 닫기`} disabled={disabled} onClick={()=>onDismiss(chip)}/></span>)}</div>;
}
