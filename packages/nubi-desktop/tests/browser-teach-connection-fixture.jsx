import React,{useLayoutEffect,useState} from 'react';import {createRoot} from 'react-dom/client';
import '@e2e/cx-design-system/styles.css';
import '../electron-app/workbench.css';import '../electron-app/shell.css';import '../electron-app/ios-tokens.css';
import '../design/workspace-identity.css';import '../design/workspace-typography.css';import '../design/workspace-density.css';import '../design/workspace-dialogs.css';import '../design/workspace-icons.css';
import {BrowserPane} from '../electron-app/BrowserPane.jsx';import {SessionSidebar} from '../ui/SessionSidebar.jsx';
const params=new URLSearchParams(location.search),external=params.has('external');
const card={schemaVersion:1,title:'합성 조회 절차',inputs:[],steps:[{tool:'click_element',target:{role:'button',name:'검색'}}]};
const canvas=document.createElement('canvas');canvas.width=640;canvas.height=240;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,640,240);ctx.fillStyle='black';ctx.font='24px sans-serif';ctx.fillText('합성 조회 결과',30,90);
const capture={id:'capture-1',dataUrl:canvas.toDataURL(),width:640,height:240,label:'실행 뒤 화면'};
const tab={id:'tab-1',tabId:'tab-1',documentId:'doc-1',title:'합성 업무 화면',url:'https://example.test/work',active:true};
window.connectionCalls=[];window.nubi={desktop:true,onHostEvent:()=>()=>{},onBrowserEvent:()=>()=>{}};
const api=async(method,args={})=>{
 if(method==='browserConnection')return {mode:external?'external':'internal',showInternal:!external,connected:true,tabs:[tab],dock:{supported:false}};
 if(method==='browser')return {tabs:[tab],active:tab.id};
 if(method!=='browserTeach')throw Error('unexpected_fixture_method');window.connectionCalls.push(structuredClone(args));
 if(args.action==='tabs')return {tabs:window.ambiguousTabs?[{...tab,active:false},{...tab,tabId:'tab-2',title:'합성 두 번째 탭',active:false}]:[tab]};
 if(args.action==='record'){
  if(window.rejectOldProject&&args.projectId!==window.activeProject)throw Error('project_changed');
  if(args.op==='start'&&window.delayStart)await new Promise(resolve=>{window.finishStart=resolve;});
  if(args.op==='start'&&window.protectedPage)throw Error('browser_auth_protected');
  if(args.op!=='stop')return {...tab,recording:true,events:2,dropped:0,startedAt:'2026-10-21'};
  if(window.emptyRecording)return {card:null,binding:null,events:0};
  return {binding:{projectId:args.projectId,sessionId:'session-1',revision:'revision-1'},card,events:1,dropped:0,skipped:0,observation:null,capture:null};
 }
 if(args.action==='test')return {binding:args.binding,draftKey:args.draftKey,receiptId:'receipt-1',success:true,steps:1,ms:10,stopped:null,captures:[capture]};
 if(args.action==='save'||args.action==='approve')return {binding:args.binding,draftKey:args.draftKey,script:{slug:'synthetic-search',hash:'steps-hash',version:1,status:args.action==='save'?'draft':'reviewed'}};
 if(args.action==='discard')return {discarded:true};throw Error('unexpected_fixture_action');
};
function BrowserFixture(){const [projectId,setProjectId]=useState('project-1');window.switchTeachProject=setProjectId;window.activeProject=projectId;return <main className="desktop-shell" data-project-id={projectId}><BrowserPane api={api} projectId={projectId} visible onError={e=>{throw e;}}/></main>;}
const tasks=[{id:'other',request:'오늘 대화',createdAt:'2026-10-21T08:00:00Z'},{id:'pinned',request:'고정한 대화',createdAt:'2026-10-21T07:00:00Z'}];
localStorage.setItem('nubi-pinned-tasks:pin-project',JSON.stringify(['pinned']));
window.pinMax=0;new MutationObserver(()=>{window.pinMax=Math.max(window.pinMax,document.querySelectorAll('[data-session-id="pinned"] summary').length);}).observe(document.getElementById('root'),{childList:true,subtree:true});
function PinFixture(){const [pins,setPins]=useState(null);window.setHostPins=setPins;
 useLayoutEffect(()=>{window.firstPinRow=document.querySelector('.nubi-session-row')?.dataset.sessionId;},[]);
 return <main className="desktop-shell"><SessionSidebar project={{projectId:'pin-project',root:'/synthetic',tasks,conversationNavigation:{pinnedIds:pins,tasks}}} open onToggle={()=>{}} onNew={()=>{}} onChooseProject={()=>{}} onSelect={()=>{}} onDelete={()=>{}}/></main>;
}
createRoot(document.getElementById('root')).render(params.has('pins')?<PinFixture/>:<BrowserFixture/>);
