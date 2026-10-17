import '@e2e/cx-design-system/styles.css';
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {GhesAccount} from '../ui/GhesAccount.jsx';

import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
import '../design/workspace-dialogs.css';
import '../design/workspace-icons.css';
const photo='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="#E8F1FE"/><circle cx="32" cy="24" r="11" fill="#3182F6"/><path d="M12 58a20 20 0 0 1 40 0" fill="#3182F6"/></svg>');
function App(){
 const [open,setOpen]=useState(false),[status,setStatus]=useState({emoji:'😄',message:'집중 중'});
 window.setProfileStatus=setStatus;
 const account=React.useCallback(async()=>({connected:true,state:'connected',profile:{id:1,login:'fixture',name:'누비 검토 계정',avatar:photo,company:'예시 회사',status}}),[status]);
 return <main className="desktop-shell" style={{display:'block',padding:24}}><header style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}><strong>누비 Workspace Beta</strong><div className="nubi-toolbar-account"><GhesAccount account={account} open={open} onOpen={()=>setOpen(true)} onClose={()=>setOpen(false)}/></div></header><p style={{marginTop:60,color:'#4E5968'}}>프로필 상태 표시 검토용 화면</p></main>;
}
createRoot(document.getElementById('root')).render(<App/>);
