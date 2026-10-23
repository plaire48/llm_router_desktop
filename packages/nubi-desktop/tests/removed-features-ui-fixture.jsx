import React from 'react';
import {createRoot} from 'react-dom/client';
import {Workbench} from '../ui/Workbench.jsx';
import {RoutineSettings} from '../ui/RoutineSettings.jsx';
import {BrowserPane} from '../electron-app/BrowserPane.jsx';
window.__nubiExternalFixture=true;
window.nubi={desktop:false};
const {fixtureApi,fixtureProject}=await import('./shared-ui-fixture.jsx');
window.removalCalls=[];
async function api(method,args={}){
 window.removalCalls.push({method,args});
 if(method==='browserTeach')throw Error('retired_recording_requested');
 return fixtureApi(method,args);
}
const screen=new URLSearchParams(location.search).get('screen');
const content=screen==='routines'?<RoutineSettings api={api} projectId={fixtureProject.projectId} onClose={()=>{}}/>:screen==='browser'?<BrowserPane api={api} projectId={fixtureProject.projectId} visible onError={error=>{throw error;}}/>:<Workbench initialProject={fixtureProject} initialProvider={await api('provider')} api={api} openCurrent={async()=>fixtureProject} hostLayout="integrated" toolbarHost={document.getElementById('toolbar')} workspaceView={async()=>{}} projects={[]}/>;
createRoot(document.getElementById('root')).render(content);
