import {WorkflowExecutionPerformance} from './workflow-execution-performance.jsx';
import {WorkflowCanvas} from '../ui/WorkflowCanvas.jsx';
const workflowSteps=Array.from({length:150},(_,i)=>({id:'step-'+i,kind:'tool',name:'합성 단계 '+i,lane:'lane-'+(i%3)}));
import '@e2e/cx-design-system/styles.css';
import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {DetailPanel} from '@e2e/cx-design-system';
import {useModalMotion} from '../ui/modalMotion.js';
import {useModalDismissalPolicy} from '../ui/useModalDismissalPolicy.js';
import {animatedSetter} from '../ui/viewTransition.js';
import {useSidebarResize} from '../ui/useSidebarResize.js';
import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../electron-app/shell.css';
import '../electron-app/ios-tokens.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
import '../design/workspace-dialogs.css';
import '../design/workspace-icons.css';
import '../electron-app/modal-motion.css';

function App(){
 const [workflowOpen,setWorkflowOpen]=useState(false);window.toggleWorkflow=layout=>setWorkflowOpen(value=>value?false:layout||'linear');
 useModalMotion();useModalDismissalPolicy();
 const root=useRef(null),[open,setOpen]=useState(false),[rows,setRows]=useState(4),[screen,setScreen]=useState(0);
 const resize=useSidebarResize(root,{hostWidth:1200,enabled:true,storageKey:'motion-fixture-width'});
 window.motionActions={open:()=>flushSync(()=>{setRows(4);setOpen(true);}),resize:n=>flushSync(()=>setRows(n)),close:()=>flushSync(()=>setOpen(false)),navigate:()=>animatedSetter(setScreen)(n=>n+1)};
 return <main ref={root} className="desktop-shell" style={{width:1200,height:800}}>
  <aside className="nubi-sidebar" style={{width:'var(--nubi-sidebar-width)',flex:'none'}}><button onClick={()=>setOpen(true)}>설정 열기</button></aside>
  <div {...resize} style={{width:8,flex:'none',cursor:'col-resize'}}/>
  <section className="nubi-workbench" style={{flex:1}}><div className="nubi-main"><h1>업무 화면 {screen}</h1>{Array.from({length:80},(_,i)=><p key={i}>업무 자료 {i+1}: 변경 범위와 다음 행동을 확인합니다.</p>)}</div></section>
  {open&&<DetailPanel className="deck-dialog" variant="modal" title="설정 검토" hideHelp onClose={()=>setOpen(false)}><input aria-label="설정 입력"/>{Array.from({length:rows},(_,i)=><p key={i}>작업 결과 {i+1}의 범위와 상태를 확인합니다.</p>)}</DetailPanel>}
 {workflowOpen==='execution'?<div style={{position:'fixed',inset:0,overflow:'auto',background:'var(--deck-surface)',zIndex:10}}><WorkflowExecutionPerformance/></div>:workflowOpen&&<WorkflowCanvas steps={workflowSteps} layout={workflowOpen} workflow={workflowOpen==='lanes'?{lanes:[{id:'lane-0',name:'합성 자료'},{id:'lane-1',name:'합성 판단'},{id:'lane-2',name:'합성 검토'}]}:undefined}/>}
 </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
