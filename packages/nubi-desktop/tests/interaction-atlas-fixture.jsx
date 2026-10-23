import '@e2e/cx-design-system/styles.css';
import React,{useMemo,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CxButton,DetailPanel} from '@e2e/cx-design-system';
import {WorkspaceNavigation} from '../ui/WorkspaceNavigation.jsx';
import {WorkspaceCatalogTabs} from '../ui/WorkspaceCatalogTabs.jsx';
import {SessionSidebar} from '../ui/SessionSidebar.jsx';
import {WorkspaceActivity} from '../ui/WorkspaceActivity.jsx';
import {MailHistory} from '../ui/MailHistory.jsx';
import {WikiBrowser} from '../ui/WikiBrowser.jsx';
import {useAuxiliaryDetailHost} from '../ui/AuxiliaryDetail.jsx';
import {useWorkspaceInteractions} from '../ui/workspace-interactions.js';
import {BrandIconDefinitions} from '../ui/BrandIconDefinitions.jsx';
import {useModalMotion} from '../ui/modalMotion.js';
import {ToolsMenu} from '../electron-app/ToolsMenu.jsx';
import {BrowserDockIntake} from '../electron-app/BrowserWindowDock.jsx';
import {animatedSetter} from '../ui/viewTransition.js';
import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../electron-app/shell.css';
import '../electron-app/ios-tokens.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
import '../design/workspace-dialogs.css';
import '../electron-app/modal-motion.css';
import '../electron-app/workspace-tabs.css';
import '../electron-app/external-browser.css';
import '../ui/auxiliary-detail.css';
import '../design/workspace-interactions.css';
import '../design/workspace-icons.css';
import '../design/workspace-pastel.css';
import '../design/workspace-alignment.css';

const listeners=new Set();window.nubi={desktop:true,platform:'win32',onHostEvent:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
window.atlasHost=event=>{for(const fn of listeners)fn(event);};
window.atlasWrites=[];
const body=Array.from({length:40},(_,i)=>`검증 문단 ${i+1}: 중앙 목록과 오른쪽 본문을 함께 읽습니다.`).join('\n\n');
const rows=Array.from({length:20},(_,i)=>({sourceId:'mail-'+i,sourceHash:'hash-'+i,title:'검증 메일 '+i,from:'fixture@example.test',date:'2026-10-23T01:00:00Z',recipientRole:'to',local:{tags:[]}}));
const pages=Array.from({length:20},(_,i)=>({path:'page-'+i+'.md',title:'검증 위키 '+i,hash:'wiki-'+i,content:'# 검증 위키 '+i+'\n\n'+body,updatedAt:'2026-10-23T01:00:00Z'}));
async function api(method,args={}){
 if(method==='browserConnection')return {updated:true};
 if(method==='mail'){
  if(args.action==='status')return {accountKey:'fixture',folders:[],counts:{received:20},localCount:20};
  if(args.action==='facets')return {senders:[],tags:[]};
  if(args.action==='search')return {results:rows,total:20,totalPages:1,page:1,offset:0,retrieval:{},unavailable:[]};
  if(args.action==='read'){const row=rows.find(row=>row.sourceId===args.id);return {id:args.id,sourceHash:row.sourceHash,local:{tags:[]},mail:{subject:row.title,text:body,date:row.date,from:row.from,attachments:[]}};}
  if(args.action==='thread')return {messages:[],related:[]};
 }
 if(method==='wikiLibrary'){
  if(args.action==='roots')return {items:[{id:'fixture',kind:'project',name:'검증 프로젝트'}]};
  if(args.action==='list')return {items:pages,edges:[]};
  if(args.action==='read')return pages.find(row=>row.path===args.path);
 }
 return {};
}
const project={projectId:'fixture',name:'검증 프로젝트',root:'/fixture',files:[],tasks:[{id:'one',request:'관리 메뉴를 여는 검증 대화',state:'review',createdAt:new Date().toISOString()}]};
function Fixture(){
 const root=useRef(null);useWorkspaceInteractions(root);useModalMotion();
 const [screen,setScreenRaw]=useState('home'),[pane,setPaneRaw]=useState(null),[expanded,setExpanded]=useState(false),[dialog,setDialog]=useState(false),[tab,setTab]=useState('one'),[sidebar,setSidebar]=useState(true),[draft,setDraft]=useState('보존할 초안');
 const setPane=useMemo(()=>animatedSetter(setPaneRaw),[]),setScreen=useMemo(()=>animatedSetter(setScreenRaw),[]),{host,setTarget}=useAuxiliaryDetailHost(setPane);
 return <main ref={root} className="desktop-shell" data-layout="split" style={{height:'100vh',flexDirection:'column'}}>
  <BrandIconDefinitions/>
  <style>{`.atlas-toolbar{display:flex;gap:8px;padding:8px;border-bottom:1px solid var(--deck-line)}.atlas-main{flex:1;min-width:0;padding:24px;overflow:auto}.atlas-main .welcome{margin:40px auto}.atlas-main .nubi-start-choices{display:flex;gap:8px}.atlas-main .nubi-start-card{min-width:100px;padding:20px}.atlas-main .nubi-activity-record{border:1px solid var(--deck-line);padding:8px}.atlas-main .nubi-activity-timeline{min-height:80px}.desktop-shell .nubi-sidebar{position:relative;flex:none;width:250px}.desktop-shell .nubi-sidebar[data-open=false]{display:none}.atlas-pane{position:relative!important;width:380px!important;flex:none}.atlas-pane[data-expanded]{width:520px!important}.atlas-pane[hidden]{display:none!important}.atlas-main .nubi-workbench-content{height:100%}.atlas-main>.nubi-main{height:100%}.desktop-shell .desktop-workspace-body{display:flex;min-height:0;flex:1}.atlas-pane textarea{min-height:140px}@media(max-width:700px){.desktop-shell .nubi-sidebar{display:none}.atlas-pane{position:absolute!important;top:0;bottom:0;right:0;width:88vw!important}.atlas-main{padding:12px}.atlas-toolbar{flex-wrap:wrap}}`}</style>
  <header className="atlas-toolbar"><CxButton onClick={()=>setSidebar(value=>!value)} aria-label="프로젝트 목록 전환">프로젝트</CxButton><CxButton onClick={()=>setDialog(true)}>설정 시트</CxButton><CxButton onClick={()=>setPane(pane?null:'file')}>보조 영역 전환</CxButton><CxButton onClick={()=>setExpanded(value=>!value)}>보조 영역 확장</CxButton><input aria-label="즉시 입력" value={draft} onChange={event=>setDraft(event.target.value)}/></header>
  <div className="desktop-workspace-body">
   <WorkspaceNavigation rail homeActive={screen==='home'} onHome={()=>setScreen('home')} onMail={()=>setScreen('mail')} onWiki={()=>setScreen('wiki')} onView={()=>setPane('file')} onSettings={()=>setDialog(true)}/>
   <SessionSidebar open={sidebar} compact={false} project={project} selected="one" onSelect={()=>{}} onNew={()=>{}} onToggle={()=>setSidebar(value=>!value)} onChooseProject={()=>{}} onDelete={()=>{window.atlasWrites.push('delete');}}/>
   <section className="atlas-main nubi-workbench" data-workspace-screen={screen}><div className="nubi-main"><div className="nubi-workbench-content">
    {screen==='home'?<><section className="welcome"><div className="welcome-emblem" style={{width:80,height:80,borderRadius:40,background:'var(--nubi-surface-selected)'}}/><h1>인터랙션 검증</h1><p>실제 공통 컴포넌트를 연결한 로컬 검증 화면</p><div className="nubi-start-choices">{['자료','프로젝트','문서'].map(name=><CxButton className="nubi-start-card" key={name} onClick={()=>setPane('file')}>{name}</CxButton>)}</div></section><WorkspaceCatalogTabs active={tab} items={[{key:'one',label:'문서'},{key:'two',label:'연결 자료'},{key:'three',label:'기록'}]} onChange={setTab}/><WorkspaceActivity task={{id:'run',checkpoint:{runId:'123e4567-e89b-42d3-a456-426614174000'},state:'completed',messages:[],trace:[{id:'123e4567-e89b-42d3-a456-426614174000:1:0',type:'tool',tool:'read_source',status:'done',args:{path:'fixture.md'}}]}}/></>:screen==='mail'?<MailHistory api={api} detailHost={host}/>:<WikiBrowser api={api} projectId="fixture" detailHost={host}/>}
   </div></div></section>
   <aside className="desktop-pane atlas-pane" hidden={!pane} data-expanded={expanded||undefined} aria-label="보조 작업 영역"><header><strong>상세</strong><ToolsMenu projectReady onOpenChange={()=>{}} onFiles={()=>setPane('file')} onTerminal={()=>{}} onWeb={()=>{}}/><CxButton aria-label="상세 닫기" onClick={()=>host.dismiss(pane)}>닫기</CxButton></header><div ref={setTarget} className="desktop-selection-detail" hidden={!['mail-detail','wiki-detail'].includes(pane)}/><div data-browser-dock-viewport hidden={pane!=='file'} style={{flex:1}}><textarea aria-label="보존할 초안" value={draft} onChange={event=>setDraft(event.target.value)}/></div></aside>
  </div><BrowserDockIntake api={api}/>
  {dialog&&<DetailPanel title="설정 시트" variant="modal" onClose={()=>setDialog(false)}><CxButton onClick={()=>setDialog(false)}>완료</CxButton></DetailPanel>}
 </main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
