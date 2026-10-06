import React from 'react';
import {createRoot} from 'react-dom/client';
import {Workbench} from '../ui/Workbench.jsx';
import '@e2e/cx-design-system/styles.css';
import '../extension/lib/browser/style/style.css';
import '../../nubi-vscode/design/host.css';
import '../design/workspace-identity.css';
async function post(route,body){const response=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),value=await response.json();if(!response.ok)throw Error(value.error);return value;}
async function api(method,args={}){
  if(method==='provider')return {provider:'aipro',connected:true,providers:[{id:'aipro',connected:true}],models:[{id:'synthetic',label:'화면 검증 모델'}],model:'synthetic'};
  if(method==='approvalPolicy')return {mode:'ask',allowedCommands:[]};
  return post('/api',{method,args});
}
const ports={api,openCurrent:()=>api('overview'),chooseFolder:async()=>{},workspaceView:async()=>{},connectMarketplace:()=>post('/marketplace',{}),openTeamWorkspace:async()=>{},ghesAccount:operation=>post('/account',{operation}),ghesUpdate:operation=>post('/update',{operation}),ghesRepositories:()=>post('/repositories',{}),openPath:async()=>{},review:async()=>{},apply:async()=>{},openURI:async()=>{},openBrowser:async()=>{}};
createRoot(document.getElementById('root')).render(<Workbench hostLayout="integrated" {...ports}/>);
