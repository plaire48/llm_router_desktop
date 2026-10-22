import React,{useCallback,useState} from 'react';import {createRoot} from 'react-dom/client';import {Workbench} from '../ui/Workbench.jsx';
window.__nubiExternalFixture=true;const {fixtureApi,fixtureProject}=await import('./shared-ui-fixture.jsx');
// ?scenario=fresh: nothing restored yet. ?scenario=personal: the personal workspace is open and no project exists.
const scenario=new URLSearchParams(location.search).get('scenario');
const personal=()=>Object.assign(fixtureProject,{projectId:'personal',kind:'conversation',name:'개인 대화',root:'/synthetic/conversations'});
if(scenario==='personal')personal();
window.workspaceSwitches=0;
function App(){
 // As in electron-app/renderer.jsx: a workspace switch remounts the Workbench (key={generation}) and the renderer
 // remembers that the switch was to personal chat (startInConversation).
 const [shell,setShell]=useState({generation:0,project:scenario==='personal'?fixtureProject:null,intent:false});
 const api=useCallback(async(method,args={})=>{
  if(method==='provider'){const base=await fixtureApi(method,args);return {...base,providers:(base.providers||[]).map(p=>({...p,connected:p.id==='aipro'?true:p.connected})),connected:true,provider:'aipro',model:'model-a',models:[{id:'model-a',label:'합성 모델 A'}]};}
  return fixtureApi(method,args);
 },[]);
 const startConversation=useCallback(async()=>{window.workspaceSwitches++;const project=personal();setShell(old=>({generation:old.generation+1,project:{...project},intent:true}));return project;},[]);
 return <Workbench key={shell.generation} hostLayout="integrated" api={api} initialProject={shell.project} startInConversation={shell.intent} openCurrent={async()=>shell.project} startConversation={startConversation} projects={[]}/>;
}
createRoot(document.getElementById('root')).render(<App/>);
