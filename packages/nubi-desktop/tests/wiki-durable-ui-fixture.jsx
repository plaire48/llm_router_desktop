import React,{useState,useCallback} from 'react';import {createRoot} from 'react-dom/client';
import {Workbench} from '../ui/Workbench.jsx';
window.__nubiExternalFixture=true;const {fixtureApi,fixtureProject}=await import('./shared-ui-fixture.jsx');
const job=state=>({id:'synthetic-durable',projectId:fixtureProject.projectId,state,stage:'generating',startedAt:new Date(Date.now()-65000).toISOString(),finishedAt:state==='partial'?new Date().toISOString():undefined,percent:state==='running'?33:null,completed:2,total:6,pages:2,model:'fixture',provider:'aipro',canResume:true,heartbeatAt:Date.now()-2000,pageStates:Object.fromEntries(Array.from({length:6},(_,i)=>['/openwiki/synthetic-'+i+'.md',{state:i<2?'done':state==='partial'?'skipped':i===2?'running':'retrying',attempts:1,nextRetryAt:i>2&&state==='running'?Date.now()+30000:null,error:i>2?'rate_limited':null}]))});
window.wikiResumeCalls=[];
function App(){const [current,setCurrent]=useState(job('running'));window.showWikiDurability=state=>setCurrent(job(state));
 const api=useCallback(async(method,args)=>{if(method==='wikiUpdate')return {status:{state:'current',lastUpdate:{updatedAt:'2026-10-20'}},updates:[]};if(method==='provider'){const base=await fixtureApi(method,args);return {...base,connected:true,provider:'aipro',model:'fixture',models:[{id:'fixture',name:'합성 모델'}]};}if(method==='wikiInitialization'&&args.action==='retry'){window.wikiResumeCalls.push(args);return current;}return fixtureApi(method,args);},[current]);
 return <Workbench hostLayout="integrated" api={api} initialProject={fixtureProject} openCurrent={async()=>fixtureProject} projects={[]} wikiInitialization={current}/>;}
createRoot(document.getElementById('root')).render(<App/>);
