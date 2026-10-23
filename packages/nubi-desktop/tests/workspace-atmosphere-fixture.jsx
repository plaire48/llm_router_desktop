// Production loading components with explicit lifecycle controls. Services are synthetic.
import '@e2e/cx-design-system/styles.css';
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CinematicIntro} from '../ui/CinematicIntro.jsx';
import {ProjectSwitchCover} from '../ui/ProjectSwitchCover.jsx';
import {NubiPreparing} from '../ui/NubiPreparing.jsx';
import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../electron-app/shell.css';
import '../electron-app/ios-tokens.css';
import '../design/workspace-typography.css';
import '../design/workspace-dialogs.css';
const scene=new URLSearchParams(location.search).get('scene')||'project',startedAt=Date.now();
function Fixture(){
 const [mounted,setMounted]=useState(true),[ready,setReady]=useState(false);
 window.atmosphereFixture={setMounted,setReady};
 useEffect(()=>{document.documentElement.toggleAttribute('data-project-switching',scene==='project'&&mounted&&!ready);return()=>document.documentElement.removeAttribute('data-project-switching');},[mounted,ready]);
 return <div className="desktop-shell" style={{height:'100vh'}}>{mounted&&(scene==='intro'?<CinematicIntro ready={ready}/>:scene==='startup'?<NubiPreparing ready={ready}/>:<ProjectSwitchCover transition={ready?null:{name:'검증 프로젝트',stage:'opening',startedAt}}/>)}</div>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
