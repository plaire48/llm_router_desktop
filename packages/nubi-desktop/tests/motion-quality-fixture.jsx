import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CxButton,Icon} from '@e2e/cx-design-system';
import {SessionSidebar} from '../ui/SessionSidebar.jsx';
import {useModalMotion} from '../ui/modalMotion.js';
import {animatedSetter} from '../ui/viewTransition.js';
import '../design/workspace-density.css';
function App(){
 useModalMotion();const [screen,setScreen]=useState(0),[loaded,setLoaded]=useState(false),[tasks,setTasks]=useState([{id:'one',request:'합성 대화',state:'review',createdAt:new Date().toISOString()}]);
 window.qualityLoad=()=>setLoaded(true);
 window.qualityNavigate=()=>animatedSetter(setScreen)(value=>value+1);
 window.qualityAdd=()=>setTasks(rows=>[...rows,{id:'two',request:'두 번째 합성 대화',state:'review',createdAt:new Date().toISOString()}]);
 window.qualityRemove=()=>setTasks(rows=>rows.filter(row=>row.id!=='two'));
 return <main className="desktop-shell motion-quality-shell" style={{height:'100vh'}}><style>{`.motion-quality-shell .nubi-sidebar{position:relative;min-height:0;flex:none;width:280px}.motion-quality-shell .nubi-workbench{min-height:700px}@media(max-width:600px){.motion-quality-shell{flex-direction:column;overflow:auto}.motion-quality-shell .nubi-sidebar{width:100%}.motion-quality-shell .nubi-workbench{flex:none!important}}`}</style><SessionSidebar open compact={false} project={{projectId:'motion',name:'합성 프로젝트',root:'/fixture',files:[],tasks}} selected="one" onSelect={()=>{}} onNew={()=>{}} onToggle={()=>{}} onChooseProject={()=>{}} onSearch={()=>{}}/>
 <section className="nubi-workbench" style={{flex:1,minWidth:0,overflow:'auto'}}><section className="nubi-main" style={{padding:'var(--cx-space-4)',minWidth:0}}><h1>모션 검토 {screen}</h1>
 <CxButton className="nubi-settings-row" onClick={()=>{}}>버튼 누름</CxButton>
 <button className="nubi-start-card" style={{marginBlock:16}}><Icon name="file" size={18}/><strong>문서 카드</strong><span>합성 자료</span></button>
 {loaded&&<p className="nubi-enter" data-quality-loaded>자료 준비 완료</p>}
 </section></section></main>;
}
createRoot(document.getElementById('root')).render(<App/>);
