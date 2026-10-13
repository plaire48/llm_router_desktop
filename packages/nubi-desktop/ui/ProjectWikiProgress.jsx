import React from 'react';
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

export function ProjectWikiProgress({job,projectName,projectRoot,onStop}){
  return <section className="nubi-project-wiki-progress" aria-label="프로젝트 위키 작성" aria-busy="true">
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
