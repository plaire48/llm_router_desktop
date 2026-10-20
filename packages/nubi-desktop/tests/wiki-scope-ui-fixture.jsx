import React,{useState,useCallback} from 'react';import {createRoot} from 'react-dom/client';
import {Workbench} from '../ui/Workbench.jsx';
window.__nubiExternalFixture=true;const {fixtureApi,fixtureProject}=await import('./shared-ui-fixture.jsx');
const folders=Array.from({length:1000},(_,i)=>({path:'synthetic-'+String(i).padStart(4,'0'),files:40,bytes:1024,score:1000-i}));
window.scopeCalls=[];
function App(){const [job,setJob]=useState({id:'synthetic-scope-job',projectId:fixtureProject.projectId,state:'running',stage:'selecting_scope',startedAt:new Date().toISOString(),percent:null,scopePlan:{total:40000,folders,selected:folders.slice(0,2).map(f=>f.path)}});const api=useCallback(async(method,args)=>{if(method==='wikiInitialization'&&args.action==='scope'){window.scopeCalls.push(args);setJob(before=>({...before,stage:'planning',scope:{mode:'folders',folders:args.folders,rounds:{done:0,total:2}}}));return {state:'running'};}return fixtureApi(method,args);},[]);return <Workbench toolbarHost={document.getElementById('toolbar')} workspaceView={async()=>{}} hostLayout="integrated" api={api} initialProject={fixtureProject} openCurrent={async()=>fixtureProject} projects={[]} wikiInitialization={job}/>;}
createRoot(document.getElementById('root')).render(<App/>);
