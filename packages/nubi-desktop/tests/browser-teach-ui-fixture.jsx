import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import '@e2e/cx-design-system/styles.css';
import '../electron-app/workbench.css';import '../electron-app/shell.css';import '../electron-app/ios-tokens.css';
import '../design/workspace-identity.css';import '../design/workspace-typography.css';import '../design/workspace-density.css';import '../design/workspace-dialogs.css';import '../design/workspace-icons.css';
import {BrowserTeachPanel} from '../ui/BrowserTeachPanel.jsx';
const canvas=document.createElement('canvas');canvas.width=800;canvas.height=400;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,800,400);ctx.fillStyle='#191F28';ctx.font='24px sans-serif';ctx.fillText('합성 검색 화면',40,50);ctx.strokeStyle='#3182F6';ctx.strokeRect(40,100,440,60);ctx.fillText('검색어',55,138);ctx.strokeRect(540,100,180,60);ctx.fillText('제출',590,138);
const dataUrl=canvas.toDataURL();
const card={schemaVersion:1,title:'합성 검색 절차',inputs:[{slot:'v1',label:'입력값'}],steps:[{tool:'fill_form',fields:[{target:{role:'textbox',name:'검색어'},slot:'v1'}]},{tool:'click_element',target:{role:'button',name:'제출'}}]};
const observation={observationId:'o',binding:{tabId:'tab',documentId:'doc'},data:{candidates:[{targetId:'t1',name:'검색어',role:'textbox',editable:true,box:{x:40,y:100,width:440,height:60}},{targetId:'t2',name:'제출',role:'button',box:{x:540,y:100,width:180,height:60}}]}};
const capture={id:'c',observationId:'o',tabId:'tab',documentId:'doc',dataUrl,width:800,height:400,viewport:{x:0,y:0,width:800,height:400},label:'조회 결과'};
window.teachCalls=[];
function App(){const [session,setSession]=useState('s');window.changeTeachSession=setSession;const binding={projectId:'p',sessionId:session,revision:'r'};
 const ports=window.location.search.includes('disconnected')?{}:{
  onTest:async request=>{window.teachCalls.push({action:'test',request});if(window.throwTeachRun)throw Error('offline');const result={...request,success:true,receiptId:'receipt',captures:[capture]};if(window.delayTeachRun)return new Promise(resolve=>window.resolveTeachRun=()=>resolve(result));return result;},
  onSave:async request=>{window.teachCalls.push({action:'save',request});return {...request,script:{...request.card,slug:'synthetic-search',hash:'synthetic-hash',version:1,status:'draft'}};},
  onApprove:async request=>{window.teachCalls.push({action:'approve',request});return {...request,script:{...card,slug:request.slug,hash:request.hash,version:request.version,status:'reviewed'}};}
 };
 return <main className="desktop-shell"><BrowserTeachPanel binding={binding} card={card} observation={observation} capture={capture} {...ports}/></main>;
}
createRoot(document.getElementById('root')).render(<App/>);
