import React,{useRef} from 'react';
import {useWorkbenchEdge} from './ProjectWikiProgress.jsx';
import {AgentMark} from '../../../extensions/aipro-chat/src/AgentMark.jsx';
import './nubi-preparing.css';

// The startup screen spans the workbench from the rail (or sidebar) to the window edge, below the toolbar (user report 2026-10-14).
export function NubiPreparing(){
 const node=useRef(null),edge=useWorkbenchEdge(node);
 return <div ref={node} className="nubi-connecting nubi-preparing" style={edge||undefined} role="status" aria-label="누비 준비 중" aria-busy="true">
  <div className="nubi-preparing-emblem" aria-hidden="true">
   <span className="nubi-preparing-orbit"/>
   <AgentMark size={76} mood="still"/>
  </div>
 </div>;
}
