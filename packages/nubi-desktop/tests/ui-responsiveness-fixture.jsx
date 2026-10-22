import {useWikiScopePerformance} from './wiki-scope-performance.jsx';
import {WorkflowExecutionPerformance} from './workflow-execution-performance.jsx';
import {WorkflowCanvas} from '../ui/WorkflowCanvas.jsx';
const workflowSteps=Array.from({length:150},(_,i)=>({id:'step-'+i,kind:'tool',name:'합성 단계 '+i,lane:'lane-'+(i%3)}));
import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DetailPanel} from '@e2e/cx-design-system';
import {AnchoredDialog} from '../ui/AnchoredDialog.jsx';
import {useModalDismissalPolicy} from '../ui/useModalDismissalPolicy.js';
import {useModalMotion} from '../ui/modalMotion.js';
import '../node_modules/@e2e/cx-design-system/dist/styles.css';
import '../design/workspace-identity.css';
import '../ui/shell-state-auto.mjs';// layout facts as attributes, as the renderer host does (design light-flow §1.1)
import '../design/workspace-dialogs.css';
import '../design/workspace-icons.css';
import '../electron-app/modal-motion.css';

function Anchored({onClose,onChild,trigger}){
 const dialog=useRef(null);
 return <AnchoredDialog dialogRef={dialog} title="선택 메뉴" initialFocus="input" onClose={onClose} style={{position:'fixed',left:100,top:100,background:'white',padding:24}}>
  <input aria-label="메뉴 입력"/><button onClick={onChild}>상세 열기</button><button className="nubi-modal-close" onClick={onClose}>메뉴 닫기</button>
 </AnchoredDialog>;
}
function App(){
 const wikiScopeUI=useWikiScopePerformance();
 const [workflowOpen,setWorkflowOpen]=useState(false);window.toggleWorkflow=layout=>setWorkflowOpen(value=>value?false:layout||'linear');
 useModalDismissalPolicy();useModalMotion();
 const [anchored,setAnchored]=useState(false),[child,setChild]=useState(false),[count,setCount]=useState(0),[shellLocked,setShellLocked]=useState(false),trigger=useRef(null);
 window.closeAnchor=()=>setAnchored(false);
 window.lockShell=setShellLocked;window.openDirect=()=>setChild(true);
 return <main className="desktop-shell" inert={shellLocked}>
  <button ref={trigger} onClick={()=>setAnchored(true)}>메뉴 열기</button>
  <button onClick={()=>setCount(value=>value+1)}>응답 확인 {count}</button><input aria-label="메인 입력"/>
  {anchored&&<Anchored trigger={trigger} onClose={()=>setAnchored(false)} onChild={()=>setChild(true)}/>}
  {child&&<DetailPanel title="상세 창" variant="modal" className="deck-dialog" hideHelp onClose={()=>setChild(false)}><input aria-label="상세 입력"/></DetailPanel>}
 {workflowOpen==='execution'?<WorkflowExecutionPerformance count={1000}/>:workflowOpen&&<WorkflowCanvas steps={workflowSteps} layout={workflowOpen} workflow={workflowOpen==='lanes'?{lanes:[{id:'lane-0',name:'합성 자료'},{id:'lane-1',name:'합성 판단'},{id:'lane-2',name:'합성 검토'}]}:undefined}/>}
 {wikiScopeUI}</main>;
}
createRoot(document.getElementById('root')).render(<App/>);
