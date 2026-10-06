import React from 'react';
import {createRoot} from 'react-dom/client';
import {Workbench} from '../ui/Workbench.jsx';
import '@e2e/cx-design-system/styles.css';
import '../extension/lib/browser/style/style.css';
import '../../nubi-vscode/design/host.css';
import '../design/workspace-identity.css';
window.teamEntries=0;window.skillPickerCalls=[];window.instructionEntries=[];
async function api(method,args={}){
  if(method==='openTeamWorkspace'){window.teamEntries++;return true;}
  if(method==='chooseSkillPackage'){window.skillPickerCalls.push(args.kind);const response=await fetch('/pick',{method:'POST',body:JSON.stringify(args)});const result=await response.json();if(!response.ok)throw Error(result.error);return result;}
  if(method==='provider')return {provider:'aipro',connected:true,providers:[{id:'aipro',connected:true}],models:[{id:'synthetic',label:'화면 검증 모델'}],model:'synthetic'};
  if(method==='approvalPolicy')return {mode:'ask',allowedCommands:[]};
  const response=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args})});const value=await response.json();if(!response.ok)throw Error(value.error);return value;
}
createRoot(document.getElementById('root')).render(<Workbench hostLayout="integrated" workspaceView={async()=>{}} openTeamWorkspace={async()=>{window.teamEntries++;}} connectMarketplace={async()=>({connected:true})} api={api} openCurrent={()=>api('overview')} chooseFolder={()=>{}} openPath={async file=>{window.instructionEntries.push(file);}} review={()=>{}} apply={()=>{}} openURI={()=>{}} openBrowser={()=>{}}/>);
