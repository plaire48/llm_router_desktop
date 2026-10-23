import '@e2e/cx-design-system/styles.css';
import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MailHistory} from '../ui/MailHistory.jsx';
import {WikiBrowser} from '../ui/WikiBrowser.jsx';
import {useAuxiliaryDetailHost} from '../ui/AuxiliaryDetail.jsx';
import {BrowserPane} from '../electron-app/BrowserPane.jsx';
import {DocumentPreview} from '../ui/DocumentPreview.jsx';
import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../electron-app/shell.css';
import '../electron-app/ios-tokens.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
import '../design/workspace-dialogs.css';
import '../design/workspace-icons.css';
import '../ui/auxiliary-detail.css';
import {WorkspaceToast} from '../ui/WorkspaceToast.jsx';

window.nubi={desktop:true,platform:'darwin'};
window.fixtureCalls=[];window.failBrowserStatus=true;
const attachmentMode=new URLSearchParams(location.search).has('attachments');
async function attachmentApi(method,args){const response=await fetch('/attachment-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args})}),value=await response.json();if(value.error)throw Error(value.error);return value;}
const body=Array.from({length:40},(_,i)=>`검증 본문 ${i+1}: 목록 위치를 유지하며 오른쪽에서 읽습니다.`).join('\n\n');
const messages=Array.from({length:20},(_,i)=>({sourceId:'mail-'+i,sourceHash:'hash-'+i,title:'검증 메일 '+i,from:'검증 담당자 <test@example.test>',date:'2026-10-23T01:00:00Z',recipientRole:'to',local:{tags:[]}}));
const pages=Array.from({length:20},(_,i)=>({path:'page-'+i+'.md',title:'검증 위키 '+i,description:'목록과 상세 분리',hash:'wiki-'+i,content:'# 검증 위키 '+i+'\n\n'+body,updatedAt:'2026-10-23T01:00:00Z'}));
async function api(method,args={}){
 window.fixtureCalls.push({method,...args});
 if(attachmentMode&&method==='mailDocument')return attachmentApi(method,args);
 if(method==='browserConnection'){
  if(args.action==='status'&&window.failBrowserStatus)throw Error('browser_unavailable');
  return {mode:'external',showInternal:false,windowsRequired:true,connected:false,tabs:[],dock:{supported:false}};
 }
 if(method==='browser')return {tabs:[],active:null};
 if(method==='mail'){
  if(args.action==='status')return {accountKey:'fixture',folders:[],counts:{received:20},localCount:20};
  if(args.action==='facets')return {senders:[],tags:[]};
  if(args.action==='search'){const source=attachmentMode?await attachmentApi('source',{}):null;return {results:source?messages.map((row,index)=>index===0?{...row,sourceHash:source.sourceHash}:row):messages,total:20,totalPages:1,page:1,offset:0,filters:args.filters,retrieval:{},unavailable:[]};}
  if(args.action==='read'){if(attachmentMode&&args.id==='mail-0')return attachmentApi('source',{});const row=messages.find(row=>row.sourceId===args.id);if(args.id==='mail-1')await new Promise(resolve=>setTimeout(resolve,250));return {id:args.id,sourceHash:row.sourceHash,local:{tags:[]},mail:{subject:row.title,from:row.from,text:body,date:row.date,attachments:[]}};}
  if(args.action==='thread')return {messages:[],related:[]};
  return {};
 }
 if(method==='wikiLibrary'){
  if(args.action==='roots')return {items:[{id:'fixture',kind:'project',name:'검증 프로젝트'}]};
  if(args.action==='list')return {items:pages,edges:[]};
  if(args.action==='read')return pages.find(page=>page.path===args.path);
 }
 if(method==='wikiCoverage')return {};
 return {};
}
function Fixture(){
 const [width,setWidth]=useState(innerWidth);useEffect(()=>{const resize=()=>setWidth(innerWidth);addEventListener('resize',resize);return()=>removeEventListener('resize',resize);},[]);
 const [screen,setScreen]=useState('mail'),[pane,setPane]=useState(null),[fileDraft,setFileDraft]=useState('보존할 파일 초안'),[document,setDocument]=useState(null);
 const stableSetPane=useMemo(()=>setPane,[]),{host,detail,setTarget}=useAuxiliaryDetailHost(stableSetPane);
 return <div className="desktop-shell" data-layout={width>=800?'split':'overlay'} style={{height:'100vh',width:'100vw',flexDirection:'column'}}>
  <nav style={{display:'flex',gap:16,padding:8}}>{['mail','wiki','browser'].map(name=><button key={name} onClick={()=>setScreen(name)}>{name}</button>)}<button onClick={()=>setPane('file')}>파일 초안 보기</button><span className="status-spinner" aria-label="로딩 아이콘"/></nav>
  <div className="desktop-workspace-body">
   <div className="desktop-agent"><div className="nubi-workbench" data-host-layout="integrated" data-workspace-screen={screen} style={{height:'100%',minHeight:0}}><div className="nubi-workbench-layout"><div className="nubi-workbench-content">
    {screen==='mail'?<MailHistory api={api} detailHost={host} onDocument={async(id,attachmentId,reference)=>{const value=await api('mailDocument',{id,attachmentId,expectedSourceHash:reference.sourceHash,expectedAttachmentHash:reference.attachmentHash});if(reference.canPresent&&!reference.canPresent())return;setDocument(value);setPane('document');}}/>:screen==='wiki'?<WikiBrowser api={api} projectId="fixture" detailHost={host}/>:<BrowserPane api={api} visible onError={()=>{}}/>}
   </div></div></div></div>
   <aside className="desktop-pane" hidden={!pane} style={{width:width>=800?'46%':undefined,minWidth:0}} aria-label="보조 작업 영역">
    <header><strong>{detail?.title||'파일'}</strong><button onClick={()=>host.dismiss(pane)}>상세 닫기</button>{detail&&<button onClick={()=>setPane(detail.kind)}>상세로 돌아가기</button>}</header>
    <div ref={setTarget} className="desktop-selection-detail" hidden={!['mail-detail','wiki-detail'].includes(pane)}/>
    <textarea hidden={pane!=='file'} aria-label="파일 초안" value={fileDraft} onChange={event=>setFileDraft(event.target.value)}/>
    {pane==='document'&&document&&<section className="desktop-list" aria-label="첨부 미리보기"><h2>{document.title}</h2><button onClick={()=>setPane('mail-detail')}>메일 본문으로</button>{document.image?<img src={document.image} alt={document.title}/>:<DocumentPreview document={document}/>}</section>}
   </aside>
  </div><WorkspaceToast/>
 </div>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
