import {hostCapabilities} from './capabilities.mjs';
import React from 'react';
import {createRoot} from 'react-dom/client';
import {Workbench} from '../../nubi-desktop/ui/Workbench.jsx';
import '@e2e/cx-design-system/styles.css';
import '../../nubi-desktop/electron-app/workbench.css';
import '../design/host.css';

const vscode=acquireVsCodeApi(),pending=new Map();let next=0;
window.addEventListener('message',event=>{const message=event.data,item=pending.get(message?.id);if(!item)return;pending.delete(message.id);message.error?item.reject(Error(message.error)):item.resolve(message.result);});
const call=(method,...args)=>new Promise((resolve,reject)=>{const id=String(++next);pending.set(id,{resolve,reject});vscode.postMessage({id,method,args});});
const ports=Object.fromEntries(['api','openCurrent','chooseFolder','cloneRepository','workspaceView','connectMarketplace','openTeamWorkspace','ghesAccount','ghesUpdate','ghesRepositories','openPath','review','apply','openURI','openBrowser'].map(name=>[name,(...args)=>call(name,...args)]));
ports.api.capabilities=hostCapabilities;
createRoot(document.getElementById('root')).render(<Workbench {...ports} hostLayout="integrated"/>);
