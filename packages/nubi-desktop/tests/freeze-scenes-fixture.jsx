// Synthetic workloads exercising production React surfaces; no model, credentials or writes.
import React,{useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {Workbench} from '../ui/Workbench.jsx';
import {WikiBrowser} from '../ui/WikiBrowser.jsx';
import {MailHistory} from '../ui/MailHistory.jsx';
import {WorkflowRunView} from '../ui/WorkflowRunView.jsx';
import {TerminalBlock} from '../ui/TerminalBlock.jsx';
import {useModalMotion} from '../ui/modalMotion.js';
import './freeze-scenes.css';
window.__nubiExternalFixture=true;
const {fixtureApi,fixtureProject}=await import('./shared-ui-fixture.jsx');
const root=document.getElementById('root'),shell=document.createElement('div');shell.className='desktop-shell';shell.dataset.layout='split';shell.dataset.toolbar='true';shell.dataset.platform='darwin';root.replaceWith(shell);shell.append(root);root.className='desktop-agent';const toolbar=document.createElement('div');toolbar.id='toolbar';toolbar.className='desktop-titlebar';shell.prepend(toolbar);
localStorage.setItem('nubi-session-tabs-v1:freeze',JSON.stringify({tabs:['chat'],selected:'chat'}));
const at='2026-10-19T00:00:00Z';
const messages=Array.from({length:500},(_,i)=>({id:'message-'+i,role:i%2?'assistant':'user',runId:i>=498?'freeze-chat':'history-'+Math.floor(i/2),at,content:i%2?`합성 결과 ${i}\n\n**확인한 사실**\n\n| 항목 | 결과 |\n|---|---|\n| 확인 | 완료 |\n\n`+Array.from({length:8},(_,j)=>`- 합성 근거 ${j}: 원문과 대조한 기록입니다.`).join('\n'):`합성 자료 ${i}의 내용을 확인해 주세요.`}));
const project={...fixtureProject,projectId:'freeze',name:'성능 검증 프로젝트',tasks:[{id:'chat',request:'500개 대화 성능 확인',state:'running',messages,trace:[],criteria:[],createdAt:at,checkpoint:{runId:'freeze-chat'}}],backgroundProjects:[]};
const provider={provider:'aipro',providers:[{id:'aipro',label:'AI Pro',connected:true}],connected:true,model:'qwen-fixture',models:[{id:'qwen-fixture',label:'합성 모델',contextLength:32000}]};
const documents=Array.from({length:150},(_,i)=>({path:`group-${i%3}/document-${i}.md`,title:`합성 문서 ${i}`,section:'group-'+i%3,tags:['합성 자료'],hash:'wiki-'+i,updatedAt:at,content:`# 합성 문서 ${i}\n\n`+Array.from({length:30},(_,j)=>`## 확인 ${j}\n\n합성 자료를 검토한 설명입니다.\n\n- 관찰한 내용을 보존합니다.\n- 실제 회사 자료가 아닙니다.\n`).join('\n')}));
const edges=documents.slice(1).map((d,i)=>({from:documents[i].path,to:d.path}));
const mails=Array.from({length:1000},(_,i)=>({sourceId:'mail-'+i,id:'mail-'+i,sourceHash:'mail-hash-'+i,title:`합성 검토 요청 ${i}`,subject:`합성 검토 요청 ${i}`,senderLabel:'합성 발신자',from:'fixture@example.invalid',recipientRole:'to',date:at,preview:'검토할 합성 자료입니다.',attachmentCount:0,local:{tags:[]}}));
const steps=Array.from({length:1000},(_,i)=>({id:'step-'+i,name:`합성 단계 ${i}`,kind:'tool',lane:'lane-'+Math.floor(i/10),action_summary:'합성 근거 확인'}));
const workflow={name:'1000단계 합성 실행',steps,lanes:Array.from({length:100},(_,i)=>({id:'lane-'+i,name:'합성 묶음 '+i}))};
let pollCount=0,streamTimer;const started=Date.now();window.freezeCalls={polls:0,states:0,mailTotal:1000,projectSwitches:0};
async function api(method,a={}){
 if(method==='provider')return provider;
 if(method==='state'||method==='overview'){window.freezeCalls.states++;return structuredClone(project);}
 if(method==='conversationHistory')return structuredClone(project.tasks.find(t=>t.id===a.taskId)||project.tasks[0]);
 if(method==='wikiLibrary'){
  if(a.action==='roots')return {items:[{id:project.projectId,name:project.name,kind:'project'}]};
  if(a.action==='list')return {items:documents.map(({content,...item})=>item),edges};
  if(a.action==='read')return documents.find(d=>d.path===a.path);
 }
 if(method==='mail'){
  if(a.action==='status')return {connected:true,autoWiki:false,counts:{received:1000},identityRevision:1,progress:{},folders:[]};
  if(a.action==='facets')return {tags:[],senders:[]};
  if(a.action==='search'){const list=a.query?mails.filter(m=>m.title.includes(a.query)):mails,limit=a.limit||20,page=a.page||1;return {results:list.slice((page-1)*limit,page*limit),total:list.length,totalPages:Math.ceil(list.length/limit),page,offset:(page-1)*limit,filters:a.filters,unavailable:[],retrieval:{}};}
  if(a.action==='read'){const row=mails.find(m=>m.id===a.id);return {id:row.id,sourceHash:row.sourceHash,mail:{...row,text:row.preview,to:['fixture@example.invalid'],attachments:[]},local:row.local};}
 }
 if(method==='workflowRun'){
  window.freezeCalls.polls++;const cursor=Math.min(999,Math.floor((Date.now()-started)/4000));pollCount++;
  return structuredClone({run:{id:'freeze-run',workflow,status:'running',cursor:'step-'+cursor,createdAt:at,updatedAt:String(cursor),steps:Object.fromEntries(steps.slice(0,cursor+1).map((s,i)=>[s.id,{status:i===cursor?'running':'complete',startedAt:at,summary:'합성 자료 확인'}]))},task:{id:'umbrella',state:'running'}});
 }
 if(method==='listWorkflows')return [{slug:'synthetic',name:workflow.name,version:1,valid:true}];
 return fixtureApi(method,a);
}
let setSceneExternal;
window.freezeOpen=id=>setSceneExternal(id);
window.freezeStream=()=>{clearInterval(streamTimer);let n=0;streamTimer=setInterval(()=>{const task=project.tasks[0];task.messages=task.messages.map((m,i)=>i===499?{...m,content:m.content+'\n합성 스트리밍 '+(++n)}:m);if(n>=35)clearInterval(streamTimer);},80);};
function Chat({navigation=false}){
 const [version,setVersion]=useState(0);window.freezeSwitchProject=()=>{window.freezeCalls.projectSwitches++;project.projectId=project.projectId==='freeze'?'freeze-other':'freeze';project.name=project.projectId==='freeze'?'성능 검증 프로젝트':'다른 합성 프로젝트';setVersion(n=>n+1);};
 return <Workbench key={version} initialProject={structuredClone(project)} initialProvider={provider} api={api} openCurrent={async()=>project} hostLayout="integrated" toolbarHost={document.getElementById('toolbar')} workspaceView={async()=>{}} openPath={()=>{}} projects={[]} />;
}
const outputLines=Array.from({length:5000},(_,i)=>`\u001b[32m${i}: 합성 출력과 실행 근거를 보존합니다. ${'result '.repeat(8)}\u001b[0m`);
function Terminal(){const [lines,setLines]=useState(0);useEffect(()=>{const timer=setInterval(()=>setLines(n=>Math.min(5000,n+100)),20);return()=>clearInterval(timer);},[]);return <TerminalBlock profile="bash" workspace="/synthetic" command="synthetic-output" output={outputLines.slice(0,lines).join('\n')} status={lines+' / 5000줄'}/>;}
function App(){const [scene,setScene]=useState(null);setSceneExternal=setScene;useModalMotion();window.freezeScene=scene;useEffect(()=>{window.freezeReady=true;},[]);return <><button id="freeze-probe" onClick={()=>{}} aria-label="입력 반응 확인">입력 반응 확인</button>{scene==='chat'||scene==='navigation'?<Chat navigation={scene==='navigation'}/>:<main className="nubi-workbench freeze-content">{scene==='wiki'?<WikiBrowser api={api} projectId={project.projectId}/>:scene==='mail'?<MailHistory api={api} onSettings={()=>{}}/>:scene==='workflow'?<WorkflowRunView api={api} runId="freeze-run"/>:scene==='terminal'?<Terminal/>:null}</main>}</>;}
createRoot(document.getElementById('root')).render(<App/>);
