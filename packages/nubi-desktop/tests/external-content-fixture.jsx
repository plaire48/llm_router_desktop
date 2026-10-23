import '../../../extensions/aipro-chat/src/app.css';
import '@e2e/cx-design-system/styles.css';
import '../electron-app/ios-tokens.css';
import '../electron-app/browser-pane.css';
import '../design/workspace-identity.css';
import '../design/workspace-interactions.css';
import '../design/workspace-typography.css';
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserPane} from '../electron-app/BrowserPane.jsx';
const api=(method,args)=>window.nubi.request(method,args);
function Fixture(){
 const [visible,setVisible]=useState(true),[modal,setModal]=useState(false),[error,setError]=useState('');
 return <main className="desktop-shell nubi-desktop-host" data-interactions="true" style={{height:'100vh',display:'grid',gridTemplateColumns:'280px minmax(0,1fr)',margin:0}}>
  <aside style={{padding:24,background:'#f1f7fe',display:'flex',flexDirection:'column',gap:16}}><h1 style={{fontSize:24}}>누비 Workspace</h1><p>외부 브라우저 콘텐츠 연결 검증</p><button onClick={()=>setVisible(value=>!value)}>패널 전환</button><button onClick={()=>setModal(true)}>검증 모달</button><output aria-label="검증 오류">{error}</output></aside>
  <div style={{minHeight:0,minWidth:0,height:'100%',display:'flex',flexDirection:'column'}}><BrowserPane api={api} visible={visible} obscured={modal} onError={cause=>setError(cause.message)} onState={()=>{}}/>{!visible&&<p>다른 보조 화면</p>}</div>
  {modal&&<section role="dialog" aria-modal="true" aria-label="검증 모달" style={{position:'fixed',inset:80,zIndex:10,background:'white',padding:40,boxShadow:'0 0 0 100vmax #0004'}}><p>웹페이지 입력이 모달 아래로 전달되지 않습니다.</p><button onClick={()=>setModal(false)}>모달 닫기</button></section>}
 </main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
