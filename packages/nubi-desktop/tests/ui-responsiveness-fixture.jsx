import {useWikiScopePerformance} from './wiki-scope-performance.jsx';
import './graphics-worker-probe.mjs';
import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DetailPanel} from '@e2e/cx-design-system';
import {AnchoredDialog} from '../ui/AnchoredDialog.jsx';
import {WorkspaceActionMenu} from '../ui/WorkspaceActionMenu.jsx';
import {useModalDismissalPolicy} from '../ui/useModalDismissalPolicy.js';
import {useModalMotion} from '../ui/modalMotion.js';
import '../node_modules/@e2e/cx-design-system/dist/styles.css';
import '../design/workspace-identity.css';
import '../ui/shell-state-auto.mjs';// layout facts as attributes, as the renderer host does (design light-flow §1.1)
import '../design/workspace-dialogs.css';
import '../design/workspace-density.css';
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
 useModalDismissalPolicy();useModalMotion();
 const [anchored,setAnchored]=useState(false),[child,setChild]=useState(false),[count,setCount]=useState(0),[shellLocked,setShellLocked]=useState(false),trigger=useRef(null);
 window.closeAnchor=()=>setAnchored(false);
 window.lockShell=setShellLocked;window.openDirect=()=>setChild(true);
 return <main className="desktop-shell" inert={shellLocked}>
  <button ref={trigger} onClick={()=>setAnchored(true)}>메뉴 열기</button>
  <button onClick={()=>setCount(value=>value+1)}>응답 확인 {count}</button><input aria-label="메인 입력"/>
  <WorkspaceActionMenu label="작업 관리"><button onClick={()=>setChild(true)}>첫 작업</button><button>두 번째 작업</button></WorkspaceActionMenu>
  {anchored&&<Anchored trigger={trigger} onClose={()=>setAnchored(false)} onChild={()=>setChild(true)}/>}
  {child&&<DetailPanel title="상세 창" variant="modal" className="deck-dialog" hideHelp onClose={()=>setChild(false)}><input aria-label="상세 입력"/></DetailPanel>}
 {wikiScopeUI}</main>;
}
createRoot(document.getElementById('root')).render(<App/>);
