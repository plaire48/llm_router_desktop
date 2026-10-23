import '@e2e/cx-design-system/styles.css';
import React,{useCallback,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CxButton,DetailPanel} from '@e2e/cx-design-system';
import {MailProgress} from '../ui/MailProgress.jsx';
import {MailStorageSetup} from '../ui/MailStorageSetup.jsx';
import {DataResetConfirmation} from '../ui/DataResetConfirmation.jsx';
import {MailLoginForm} from '../ui/MailLoginForm.jsx';
import {WikiRepository} from '../ui/WikiRepository.jsx';
import {useModalDismissalPolicy} from '../ui/useModalDismissalPolicy.js';
import {useModalMotion} from '../ui/modalMotion.js';
import {backgroundTasks} from '../ui/background-task-queue.mjs';
import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../electron-app/shell.css';
import '../electron-app/ios-tokens.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
import '../design/workspace-icons.css';
import '../design/workspace-pastel.css';
import '../design/workspace-dialogs.css';
import '../electron-app/modal-motion.css';
const pending=new Map(),calls=[],state={amount:20};
const defer=key=>{calls.push(key);return new Promise((resolve,reject)=>pending.set(key,{resolve,reject}));};
function Fixture(){
 useModalDismissalPolicy();useModalMotion();
 const [parent,setParent]=useState(false),[panel,setPanel]=useState(null);
 const api=useCallback(async(method,args={})=>{
  if(method==='chooseMailRawRoot')return defer('storage');
  if(method==='mail'){
   if(args.action==='status')return {connected:false,counts:{received:0}};
   if(args.action==='storageProgress')return {moving:true,progress:{stage:'copying',bytes:state.amount,totalBytes:100,completed:state.amount,total:100}};
   if(args.action==='resetProgress')return {stage:'stopping',completed:state.amount,total:100};
   if(args.action==='reset')return defer('reset');
   if(args.action==='portalSession')return defer('session');
   if(args.action==='portalLogin')return defer('login');
   if(args.action==='cancelConnect'){pending.get('login')?.reject(Error('mail_cancelled'));pending.get('session')?.reject(Error('mail_cancelled'));return {};}
  }
  if(method==='wikiRepository'){
   if(args.action==='list')return {canUpload:true,head:'fixture-head',items:[]};
   if(args.action==='stage')return defer('stage');
   if(args.action==='publish')return defer('publish');
   if(args.action==='progress')return {phase:'upload',completed:state.amount,total:100};
   if(args.action==='cancel'){calls.push('cancel-stage');return {};}
  }
  return {};
 },[]);
 window.backgroundFixture={finish:(key,value)=>pending.get(key)?.resolve(value||{}),fail:key=>pending.get(key)?.reject(Error('fixture_failed')),setAmount:value=>state.amount=value,calls,rows:()=>backgroundTasks.getSnapshot(),seed:()=>{for(let i=1;i<=5;i++)backgroundTasks.begin({title:`작업 ${i}`,label:`문서 ${i} 처리 중`,value:i*10},i===4?{cancel:()=>{}}:undefined);},unmount:()=>{setParent(false);setPanel(null);}};
 return <div className="desktop-shell" style={{height:'100vh',padding:'40px'}}>
  <main><label>다른 작업<input aria-label="다른 작업"/></label><CxButton onClick={()=>{setParent(true);setPanel(null);}}>설정 열기</CxButton><CxButton onClick={()=>setPanel('reset')}>초기화 열기</CxButton><CxButton onClick={()=>setPanel('login')}>로그인 열기</CxButton><WikiRepository api={api}/></main>
  {parent&&<DetailPanel title="메일 설정" variant="modal" className="deck-dialog" onClose={()=>setParent(false)}><CxButton onClick={()=>setPanel('storage')}>보관 위치 선택</CxButton></DetailPanel>}
  {panel==='storage'&&<MailStorageSetup api={api} status={{rawRoot:'/fixture/mail',includeAttachments:true}} onClose={()=>setPanel(null)} onDone={()=>setPanel(null)}/>}
  {panel==='reset'&&<DataResetConfirmation kind="mail" api={api} onClose={()=>setPanel(null)} onDone={()=>setPanel(null)}/>}
  {panel==='login'&&<MailLoginForm api={api} onClose={()=>setPanel(null)}/>}
  <MailProgress api={api}/>
 </div>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
