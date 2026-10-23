import '@e2e/cx-design-system/styles.css';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CxButton} from '@e2e/cx-design-system';
import {TaskProgressBar} from '../ui/TaskProgressBar.jsx';
import {WikiInitializationProgress} from '../ui/WikiInitializationProgress.jsx';
import {WikiUpdate} from '../ui/WikiUpdate.jsx';
import {MailFileImport} from '../ui/MailFileImport.jsx';
import {GitCloneProgress} from '../ui/GitCloneProgress.jsx';
import {WorkspaceUpdateProgress} from '../ui/WorkspaceUpdate.jsx';
import {MailStorageSetup} from '../ui/MailStorageSetup.jsx';
import {WikiRepository} from '../ui/WikiRepository.jsx';
import {NubiPreparing} from '../ui/NubiPreparing.jsx';
import {ProjectSwitchCover} from '../ui/ProjectSwitchCover.jsx';
import {CinematicIntro} from '../ui/CinematicIntro.jsx';
import {ContextMeter} from '../../../extensions/aipro-chat/src/ChatControls.jsx';
import {useModalMotion} from '../ui/modalMotion.js';
import {useModalDismissalPolicy} from '../ui/useModalDismissalPolicy.js';
import {installModalStack} from '../ui/modalStack.js';
import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../electron-app/shell.css';
import '../electron-app/ios-tokens.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
import '../design/workspace-dialogs.css';
import '../design/workspace-icons.css';
import '../electron-app/modal-motion.css';
import './progress-unification-fixture.css';

const startedAt=Date.now(),scene=new URLSearchParams(location.search).get('scene')||'gallery';
function Fixture(){
 const [value,setValue]=useState(20),[pending,setPending]=useState(false),[dialog,setDialog]=useState(null),[ready,setReady]=useState(false);
 const state=useRef(),finishStorage=useRef(),finishPublish=useRef();state.current={value,pending};
 useModalMotion();useModalDismissalPolicy();useEffect(installModalStack,[]);
 const api=useCallback(async(method,args={})=>{
  if(method==='wikiUpdate')return {status:{state:'stale',changedFiles:[]},updates:[{id:'fixture-update',state:'running',events:state.current.pending?[]:[{type:'progress',stage:'generating',completed:5,total:11}]}]};
  if(method==='chooseMailRawRoot')return new Promise(resolve=>{finishStorage.current=resolve;});
  if(method==='mail'&&args.action==='storageProgress')return {moving:true,progress:state.current.pending?{stage:'scanning',discovered:100}:{stage:'copying',bytes:state.current.value,totalBytes:100,completed:state.current.value,total:100}};
  if(method==='wikiRepository'){
   if(args.action==='list')return {head:'fixture-head',canUpload:true,items:[]};
   if(args.action==='stage')return {id:'fixture-stage',files:[{path:'openwiki/readme.md'}]};
   if(args.action==='publish')return new Promise(resolve=>{finishPublish.current=resolve;});
   if(args.action==='progress')return state.current.pending?{phase:'save'}:{phase:'upload',completed:state.current.value,total:100};
   if(args.action==='people')return {items:[]};
  }
  return {};
 },[]);
 window.progressFixture={setValue,setPending,setDialog,setReady,finishStorage:()=>finishStorage.current?.({cancelled:false}),finishPublish:()=>finishPublish.current?.({saved:true})};
 window.nubi={desktop:true,installationId:'progress-fixture',request:api};
 useEffect(()=>{if(scene==='project')document.documentElement.setAttribute('data-project-switching','');return()=>document.documentElement.removeAttribute('data-project-switching');},[]);
 const percent=pending?undefined:value;
 return <main className="desktop-shell progress-fixture"><div className="nubi-workbench">
  {scene==='intro'?<CinematicIntro ready={ready}/>:scene==='startup'?<NubiPreparing ready={ready}/>:scene==='project'?<ProjectSwitchCover transition={{name:'검증 프로젝트',stage:'opening',startedAt}}/>:scene==='repository'?<WikiRepository api={api}/>:scene==='wiki-update'?<WikiUpdate api={api}/>:<>
   <h1>진행 표시</h1>
   <section><h2>작업 진행</h2><TaskProgressBar label="기준 진행" value={percent}/></section>
   <section><h2>메일 가져오기</h2><MailFileImport progress={{state:pending?'scanning':'importing',completed:value,total:100,startedAt:new Date(startedAt).toISOString(),failures:[]}} onCancel={()=>{}}/></section>
   <section><h2>위키 준비</h2><WikiInitializationProgress job={{id:'fixture-wiki',state:'running',stage:'generating',percent,completed:value,total:100,startedAt:new Date(startedAt).toISOString()}}/></section>
   <section><h2>Git 가져오기</h2><GitCloneProgress progress={{stage:pending?'opening':'receiving',percent,current:value,total:100,startedAt}}/></section>
   <div className="progress-fixture-actions"><CxButton onClick={()=>setDialog('update')}>업데이트 보기</CxButton><CxButton onClick={()=>setDialog('storage')}>보관 설정</CxButton><ContextMeter messages={[]} draft="" model={{name:'Fixture'}} usageInfo={{kind:'measured',used:2000,capacity:10000,ratio:.2}}/></div>
  </>}
  {dialog==='update'&&<WorkspaceUpdateProgress update={{opened:true,state:{phase:'downloading',percent,received:value*1024**2,release:{size:100*1024**2}},cancel:()=>setDialog(null)}}/>}
  {dialog==='storage'&&<MailStorageSetup api={api} status={{protocol:'pop3',rawRoot:'/fixture/mail',counts:{received:100}}} onClose={()=>setDialog(null)} onDone={()=>setDialog(null)}/>}
 </div></main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
