import React,{useEffect,useRef,useState} from 'react';
import {useWorkbenchEdge} from './ProjectWikiProgress.jsx';
import {AgentMark,NubiWordmark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import './nubi-preparing.css';
import {TaskProgressBar} from './TaskProgressBar.jsx';

// While Nubi gets ready: the logo and a progress bar on the app's own background (user decisions 2026-10-14: no lone
// bird, no sky on later launches). It fades out when ready; automated runs and reduced motion skip that.
const quick=()=>typeof navigator!=='undefined'&&navigator.webdriver||typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
export function NubiPreparing({ready=false}){
 const node=useRef(null),edge=useWorkbenchEdge(node),[gone,setGone]=useState(ready);
 useEffect(()=>{if(!ready){setGone(false);return;}if(quick()){setGone(true);return;}const timer=setTimeout(()=>setGone(true),700);return()=>clearTimeout(timer);},[ready]);
 // A new loading phase covers content in the same render, before effects run.
 if(gone&&ready)return null;
 // The whole workbench from the rail (or sidebar) to the window edge, below the toolbar (user report 2026-10-14).
 return <div ref={node} className="nubi-connecting nubi-preparing" data-leaving={ready||undefined} style={edge||undefined} role="status" aria-label="누비 준비 중" aria-busy={!ready}>
  <div className="nubi-preparing-brand" aria-hidden="true"><AgentMark size={56} mood="idle" lively/><NubiWordmark/><span>Workspace</span></div>
  <TaskProgressBar className="nubi-preparing-bar" label="누비 준비" value={ready?100:undefined}/>
 </div>;
}
