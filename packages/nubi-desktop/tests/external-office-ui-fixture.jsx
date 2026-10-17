import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CxButton} from '@e2e/cx-design-system';
import '@e2e/cx-design-system/styles.css';
import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
import '../design/workspace-dialogs.css';
import '../design/workspace-icons.css';
import '../design/office-connection.css';
import {useOfficeConnection} from '../ui/OfficeConnection.jsx';
import {WorkspaceSkillMenu} from '../ui/WorkspaceSkillMenu.jsx';
window.events=[];window.slowPreview=false;window.failPreview=false;
const api=async(method,args)=>{window.events.push({method,args});const r=await fetch('/request',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({method,args})});const value=await r.json();if(value.error)throw Error(value.error);if(args.action==='preview'&&window.slowPreview)await new Promise(r=>setTimeout(r,300));if(args.action==='preview'&&window.failPreview)throw Error('native_office_windows_required');return value;};
function App(){
 const [task,setTask]=useState(null),[open,setOpen]=useState(false);
 const refresh=async()=>{if(task)setTask(await api('task',{taskId:task.id}));};
 const office=useOfficeConnection({api,projectId:'fixture',task,onChanged:refresh});
 return <main className="desktop-shell" style={{display:'block',padding:24,minHeight:'100vh'}}><section style={{maxWidth:740,margin:'auto',paddingTop:80}}><h1>Office 연결 화면 검증</h1><p>상태 기반 가상 Office입니다. 실제 Office 연결 증거가 아닙니다.</p><div>{office.chip(()=>setOpen(true))}</div><div style={{display:'flex',gap:8}}><WorkspaceSkillMenu api={api} taskId={task?.id} onOffice={()=>setOpen(true)}/><CxButton onClick={()=>setOpen(true)}>Office 연결 관리</CxButton><CxButton onClick={async()=>{const t=await api('create',{});await office.attach(t.id);setTask(await api('task',{taskId:t.id}));}}>요청 보내기</CxButton><CxButton onClick={()=>setTask(null)}>새 대화</CxButton></div>{open&&office.dialog(()=>setOpen(false))}<output aria-label="현재 대화">{task?.id||'새 대화'}</output></section></main>;
}
createRoot(document.getElementById('root')).render(<App/>);
