import '@e2e/cx-design-system/styles.css';
import React,{useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MailHistory} from '../ui/MailHistory.jsx';

import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../electron-app/shell.css';
import '../electron-app/ios-tokens.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
import '../design/workspace-dialogs.css';
import '../design/workspace-icons.css';
window.mailCalls=[];window.savedView={mailbox:'folder:3'};
const api=async(method,args={})=>{
 window.mailCalls.push(args);
 if(args.action==='status')return {connected:true,counts:{received:8},progress:{},folders:['Inbox','Sent','Drafts','Spam','Trash','프로젝트 자료','오래된 업무와 개인 보관 자료가 담긴 긴 이름의 폴더'].map((name,i)=>({id:String(i+1),name,mailbox:['inbox','sent','draft','spam','trash','other','other'][i]})),localKinds:['inbox','sent','notice']};
 if(args.action==='facets')return {tags:[],senders:[]};
 if(args.action==='search')return {results:[],total:0,totalPages:1,page:1,offset:0,filters:{},unavailable:[],retrieval:{}};
 if(args.action==='approvals')return {page:args.page,total:2,hasNext:args.page===1,items:[{id:'a'+args.page,lineId:'l',subject:args.page===1?'결재 문서':'예산 승인 요청',titlePending:args.page===1,submittedAt:'2026-10-15T03:00:00Z'}]};
 if(args.action==='approvalTitle')return new Promise(resolve=>{window.resolveTitle=()=>resolve({subject:'시스템 개선 검토 요청'});});
 if(args.action==='approvalRead')return {id:args.id,subject:'시스템 개선 검토 요청',mail:{text:'검토할 결재 본문',presentation:{html:'<p>검토할 결재 본문</p>'}}};
 return {};
};
function App(){const [revision,setRevision]=useState(0),viewState=useRef(window.savedView);window.remountMail=()=>setRevision(x=>x+1);return <div className="desktop-shell" style={{position:'relative',height:'100vh',display:'block'}}><main className="nubi-workbench" style={{height:'100%',display:'block'}}><MailHistory key={revision} api={api} viewState={viewState} onSettings={()=>{}}/></main></div>;}
createRoot(document.getElementById('root')).render(<App/>);
