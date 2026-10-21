import React from 'react';import {createRoot} from 'react-dom/client';
import {Workbench} from '../ui/Workbench.jsx';
import {workflowExecutionRun} from './workflow-run-demo.jsx';
window.__nubiExternalFixture=true;
const {fixtureApi,fixtureProject}=await import('./shared-ui-fixture.jsx');
const task={id:'umbrella',request:'합성 업무 실행',kind:'workflow',workflowRunId:workflowExecutionRun.id,state:'waiting_input',messages:[],trace:[],criteria:[],chapters:[],createdAt:workflowExecutionRun.createdAt};
const question={id:'workflow-host-question',kind:'choice',workflow:{stepId:'step-2',phase:'human'},text:'합성 업무 확인 질문',options:[{id:'yes',label:'진행'},{id:'no',label:'중단'}],selection:'single',inputMode:'none'};
fixtureProject.tasks=[task];
window.workflowWorkbenchCalls=[];
async function api(method,args){window.workflowWorkbenchCalls.push({method,args});if(method==='listWorkflows')return [{slug:'synthetic',name:workflowExecutionRun.workflow.name,version:1,valid:true,trigger:{kind:'manual'},definitionHash:'synthetic-definition',inputs:{},qualified:false,routine:null,proposal:null,lastRun:workflowExecutionRun}];if(method==='workflowRun')return {run:workflowExecutionRun,task:{id:task.id,question,state:task.state}};if(method==='conversationHistory'&&args?.taskId==='child')return {id:'child',origin:{kind:'workflow_step',runId:workflowExecutionRun.id,stepId:'step-1'},messages:[{role:'assistant',content:'실제 Workbench 안의 합성 하위 대화'}]};return fixtureApi(method,args);}
createRoot(document.getElementById('root')).render(<Workbench toolbarHost={document.getElementById('toolbar')} workspaceView={async()=>{}} hostLayout="integrated" api={api} openCurrent={async()=>fixtureProject} projects={[]} openPath={(path,taskId)=>{window.workflowOpenedFile={path,taskId};}}/>);
