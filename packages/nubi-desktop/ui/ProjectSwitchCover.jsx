import React from 'react';
import {GitCloneProgress} from './GitCloneProgress.jsx';
import {AgentMark,NubiWordmark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import './nubi-preparing.css';
import './project-switch-cover.css';

// Present before the first async project request, without unmounting drafts or
// moving layout. The renderer removes the guard only after the next UI commits.
export function ProjectSwitchCover({progress}){
 return <div className="nubi-project-switch-cover" role="status" aria-label="프로젝트 여는 중">
  <div className="nubi-preparing-brand" aria-hidden="true"><AgentMark size={56} mood="idle" lively/><NubiWordmark/><span>Workspace</span></div>
  {progress?<GitCloneProgress progress={progress}/>:<div className="nubi-preparing-bar" aria-hidden="true"><span/></div>}
 </div>;
}
