import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AiWorkspaceEmbed} from '../ui/AiWorkspaceEmbed.jsx';
import {prepareWorkspaceSite} from '../ui/ai-workspace/workspace/workspaceSite.js';
import '@e2e/cx-design-system/styles.css';
import '../electron-app/workbench.css';import '../design/workspace-identity.css';import '../electron-app/shell.css';import '../electron-app/ios-tokens.css';import '../design/workspace-typography.css';import '../design/workspace-density.css';import '../design/workspace-dialogs.css';
window.calls=[];window.unhandled=[];window.openFailure=false;
const user={id:7,login:'nubi',name:'김누비',email:'nubi@example.test',type:'User'};
const pageInfo={hasNextPage:false,endCursor:null};
const site=await prepareWorkspaceSite({schemaVersion:1,files:[{path:'index.html',content:btoa('<h1>Fixture app</h1>')}]});
const base={description:'업무에 필요한 자료를 확인합니다.',maintainers:[],editors:[],createdBy:'nubi',updatedBy:'nubi',createdAt:'2026-10-14T00:00:00Z',updatedAt:'2026-10-14T00:00:00Z'};
const catalog={schemaVersion:1,items:[{...base,id:'11111111-1111-4111-8111-111111111111',title:'링크 앱',url:'https://app.example.invalid'},{...base,id:'22222222-2222-4222-8222-222222222222',title:'파일 앱',kind:'site',site:site.descriptor}]};
const encode=value=>btoa(unescape(encodeURIComponent(JSON.stringify(value))));
window.nubi={desktop:true,request:async(method,args)=>{
 window.calls.push({...args,bridgeMethod:method,method});
 if(method==='openWorkspaceApp')return window.openFailure?{__nubiError:'community_missing'}:{opened:true,tabId:'fixture'};
 if(method!=='ghesFetch')throw Error('unexpected method');
 const url=new URL(args.url),route=url.pathname;let value,status=200;
 if(route==='/api/graphql'){
  const {query}=JSON.parse(args.body);
  if(query.includes('user(login:$login)'))value={data:{user:{status:null}}};
  else if(query.includes('E2EDiscussionSetup'))value={data:{repository:{id:'repo',hasDiscussionsEnabled:true,viewerPermission:'WRITE',discussionCategories:{nodes:[{id:'general',name:'경험 공유',slug:'general',isAnswerable:false}],pageInfo},pinnedDiscussions:{nodes:[],pageInfo}}}};
  else if(query.includes('E2EDiscussions')||query.includes('E2EDiscussionActivity'))value={data:{repository:{discussions:{nodes:[],pageInfo}}}};
  else {window.unhandled.push(query.slice(0,80));status=400;value={message:'unexpected fixture query'};}
 }else if(route.endsWith('/git/ref/heads/main'))value={object:{sha:'a'.repeat(40)}};
 else if(route.endsWith('/contents/data/workspace/catalog.json'))value={sha:'b'.repeat(40),encoding:'base64',content:encode(catalog)};
 else if(route==='/api/v3/user'||route==='/api/v3/users/nubi')value=user;
 else if(route==='/api/v3/repos/Manufacturing-IT/ai_workspace')value={permissions:{admin:false,push:false,pull:true}};
 else if(route.endsWith('/issues')||route.endsWith('/assignees')||route.endsWith('/collaborators'))value=[];
 else {status=404;value={message:'fixture missing'};}
 return {status,body:encode(value),url:args.url,headers:{'content-type':'application/json'}};
}};
function Fixture(){const [view,setView]=useState('apps'),[connected,setConnected]=useState(true);return <main className="desktop-shell" style={{display:'block',height:'100vh',overflow:'auto'}}><nav><button onClick={()=>setView('apps')}>테스트 앱</button><button onClick={()=>setView('talk')}>테스트 Talk</button><button onClick={()=>setConnected(v=>!v)}>테스트 로그인 전환</button></nav><AiWorkspaceEmbed view={view} account={{connected,profile:user}} onSignIn={()=>setConnected(true)}/></main>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
