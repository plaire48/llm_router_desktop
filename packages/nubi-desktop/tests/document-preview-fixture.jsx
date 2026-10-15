import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CxButton} from '@e2e/cx-design-system';
import {DocumentPreview,RenderedFile} from '../ui/DocumentPreview.jsx';
import {WikiBrowser} from '../ui/WikiBrowser.jsx';
import {ProjectWikiProgress} from '../ui/ProjectWikiProgress.jsx';
import '@e2e/cx-design-system/styles.css';
import '../../../extensions/aipro-chat/design/agent-deck.css';
import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../design/workspace-typography.css';
const html='<h2>프로젝트 일정 안내</h2><p>안녕하세요. <strong>10월 23일까지 검토</strong> 부탁드립니다.</p><table style="width:100%"><tr style="background-color:#E8F1FE"><th>항목</th><th>일정</th></tr><tr><td>기능 검토</td><td>10월 20일</td></tr><tr><td>최종 반영</td><td>10월 23일</td></tr></table><script>parent.unsafe=true</script><img src="file:///secret" alt="표시할 수 없는 이미지">';
const api=async(method,args)=>args.action==='roots'?{items:[{id:'project',name:'누비 프로젝트',kind:'code'}]}:new Promise(()=>{});
function App(){const [view,setView]=useState('html'),[count,setCount]=useState(0);return <main style={{maxWidth:920,margin:'24px auto',padding:16}}><nav style={{display:'flex',gap:8,marginBottom:16}}>{['html','markdown','pdf','wiki'].map(name=><CxButton key={name} onClick={()=>setView(name)}>{name}</CxButton>)}</nav>{view==='wiki'?<><ProjectWikiProgress job={{state:'running',stage:'generating',completed:5,total:11,percent:45,startedAt:new Date(Date.now()-45000).toISOString()}} projectName="누비 프로젝트" onStop={()=>{window.stopped=true;}}/><CxButton onClick={()=>setCount(v=>v+1)}>다른 작업 {count}</CxButton><div style={{height:520,marginTop:16}}><WikiBrowser api={api} projectId="project"/></div></>:view==='html'?<DocumentPreview key="html" document={{title:'보낸 메일.html',text:'프로젝트 일정 안내\n10월 23일까지 검토',html}}/>:view==='markdown'?<RenderedFile name="안내.md" text={'# 업무 안내\n\n**핵심부터** 확인해 주세요.\n\n| 항목 | 일정 |\n| --- | --- |\n| 검토 | 10월 20일 |'}/>:<DocumentPreview key="pdf" document={{title:'보고서.pdf',pdf:window.fixturePdf,text:'Nubi report page 1 and page 2'}}/>}</main>;}
createRoot(document.getElementById('root')).render(<App/>);
