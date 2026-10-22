import '@e2e/cx-design-system/styles.css';
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DetailPanel} from '@e2e/cx-design-system';
import {TaskProgressBar} from '../ui/TaskProgressBar.jsx';
import {WikiInitializationProgress} from '../ui/WikiInitializationProgress.jsx';
import {GitCloneProgress} from '../ui/GitCloneProgress.jsx';

import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../ui/shell-state-auto.mjs';// layout facts as attributes, as the renderer host does (design light-flow §1.1)
import '../electron-app/shell.css';
import '../electron-app/ios-tokens.css';
import '../ui/project-switch-cover.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
import '../design/workspace-dialogs.css';
import '../design/workspace-icons.css';
const startedAt=Date.now();
function Fixture(){
 const [count,setCount]=useState(10),[stage,setStage]=useState('reading'),[active,setActive]=useState(true);
 window.advance=()=>setCount(20);window.phase=()=>{setStage('generating');setCount(0);};window.finish=()=>setActive(false);
 return <main className="desktop-shell"><DetailPanel title="진행 시간 검증" variant="modal" className="deck-dialog nubi-panel" onClose={()=>{}}>
 <section aria-label="메일 가져오기"><strong>메일 가져오기</strong><TaskProgressBar label="메일 처리" value={count} estimate={{active,identity:stage,completed:count,total:100}}/></section>
 <WikiInitializationProgress job={{id:'wiki',state:active?'running':'completed',stage,startedAt:new Date(startedAt).toISOString(),stageStartedAt:new Date(startedAt).toISOString(),completed:count,total:100,percent:count,pages:100}}/>
 {active&&<GitCloneProgress progress={{startedAt,stage:'receiving',percent:count,current:count,total:100}}/>}
 </DetailPanel></main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
