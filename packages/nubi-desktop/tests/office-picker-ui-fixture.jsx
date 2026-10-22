import '@e2e/cx-design-system/styles.css';
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {useOfficeConnection} from '../ui/OfficeConnection.jsx';
import '../electron-app/workbench.css';import '../design/workspace-identity.css';import '../ui/shell-state-auto.mjs';import '../electron-app/shell.css';import '../electron-app/ios-tokens.css';import '../design/workspace-typography.css';import '../design/workspace-density.css';import '../design/workspace-dialogs.css';import '../design/workspace-icons.css';import '../design/office-connection.css';
window.requests=[];
const api=async(method,args)=>{window.requests.push({method,...args});if(args.action==='preview')return {token:'selection',app:args.app,documents:Array.from({length:12},(_,i)=>({candidateId:'document-'+i,documentTitle:i<2?'2026년 사업 운영 계획 및 실적 보고서.docx':'업무 문서 '+(i+1)+'.docx',windowNumber:i+1}))};if(args.action==='select')return {token:'selection',document:{app:'word',documentId:args.candidateId,documentTitle:'2026년 사업 운영 계획 및 실적 보고서.docx'}};return {};};
function App(){const [open,setOpen]=useState(true),office=useOfficeConnection({api,projectId:'fixture',onChanged:async()=>{}});return <main className="nubi-workbench"><button onClick={()=>setOpen(true)}>연결 열기</button>{open&&office.dialog(()=>setOpen(false))}</main>;}
createRoot(document.getElementById('root')).render(<App/>);
