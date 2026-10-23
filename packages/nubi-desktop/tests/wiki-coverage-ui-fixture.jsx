import React,{useCallback,useState} from 'react';import {createRoot} from 'react-dom/client';import {Workbench} from '../ui/Workbench.jsx';
window.__nubiExternalFixture=true;const {fixtureApi,fixtureProject}=await import('./shared-ui-fixture.jsx');
window.coverageCalls=[];window.wikiSearchCalls=[];let update=null,complete=false;
const coverage=()=>({important:['app.txt','main.mjs','config.json'],uncovered:complete?[]:['main.mjs','config.json'],ratio:complete?1:1/3,pages:{'openwiki/home.md':['app.txt']},files:{'app.txt':['openwiki/home.md']},quality:{pages:1,brokenLinks:complete?0:2,emptySections:complete?0:1,sourceReviewPages:complete?0:1,missingClaims:0,unreviewedPages:0,omitted:0,rows:complete?[]:[{page:'openwiki/home.md',brokenLinks:2,emptySections:1,staleClaims:1}]}});
const report={pages:1,coveredRatio:1/3,uncovered:['main.mjs','config.json'],important:['app.txt','main.mjs','config.json'],skipped:{large:1,binary:2,encoding:1},modelCalls:5,durationMs:12500,rounds:2};
function App(){const [toolbarHost,setToolbarHost]=useState(null);const api=useCallback(async(method,args={})=>{
 if(method==='provider'){const base=await fixtureApi(method,args);return {...base,connected:true,provider:'aipro',model:'synthetic',models:[{id:'synthetic',label:'합성 모델'}]};}
 if(method==='wikiCoverage')return {coverage:coverage(),report};
 if(method==='wikiGeneration')return {unsupported:true};
 if(method==='wikiLibrary'){if(args.action==='roots')return {items:[{id:fixtureProject.projectId,name:'합성 프로젝트',kind:'project'}]};if(args.action==='list')return {items:[{path:'home.md',title:'프로젝트 개요',hash:'synthetic',updatedAt:'2026-10-20T09:00:00Z'}],edges:[]};if(args.action==='read')return {path:'home.md',hash:'synthetic',content:'# 프로젝트 개요\n\n이 합성 프로젝트의 현재 문서입니다.\n\n본문전용키'};if(args.action==='search'){window.wikiSearchCalls.push(args.query);if(args.query==='지연질의')await new Promise(r=>setTimeout(r,700));if(args.query==='조회실패')throw Error('unavailable');return {paths:args.query==='본문전용키'?['home.md']:[],truncated:false};}}
 if(method==='wikiUpdate'){
  if(args.method!=='status')window.coverageCalls.push(structuredClone(args));
  if(args.method==='propose')update={id:'coverage-proposal',fingerprint:'bound-files',state:'proposed',coverageFiles:args.coverageFiles};
  if(args.method==='run'){if(args.id!==update.id||args.fingerprint!==update.fingerprint)throw Error('wiki_update_changed');update={...update,state:'ready',changes:[{path:'openwiki/entry.md',change:'added'}]};}
  if(args.method==='apply'){if(args.id!==update.id||args.fingerprint!==update.fingerprint)throw Error('wiki_update_changed');complete=true;update={...update,state:'applied'};}
  if(args.method==='status')return {status:{state:'current',lastUpdate:{updatedAt:'2026-10-20'}},updates:update?[update]:[]};return update;
 }
 return fixtureApi(method,args);
 },[]);return <div className="desktop-shell" data-layout="overlay" data-toolbar="true"><div className="desktop-titlebar" ref={setToolbarHost}/><div className="desktop-workspace-body"><div className="desktop-agent"><Workbench toolbarHost={toolbarHost} workspaceView={async()=>{}} hostLayout="integrated" api={api} initialProject={fixtureProject} openCurrent={async()=>fixtureProject} projects={[]}/></div></div></div>;}
createRoot(document.getElementById('root')).render(<App/>);
