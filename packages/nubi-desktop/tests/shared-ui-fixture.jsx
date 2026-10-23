import {toolArgumentView} from '../runtime/tool-argument-view.mjs';
import '@e2e/cx-design-system/styles.css';
import {useModalDismissalPolicy} from '../ui/useModalDismissalPolicy.js';
import {searchConversations} from '../ui/conversation-search.mjs';
// Synthetic provider states only. No credentials, external network or claimed model success.
import React,{useState} from 'react';
import {createPortal} from 'react-dom';
import {WorkspaceAction} from '../ui/WorkspaceAction.jsx';
import {MailSourcePane} from '../ui/MailSourcePane.jsx';
import {ComputerUiFixture,ComputerControlUiFixture,ComputerPointerUiFixture,ComputerKeyboardUiFixture} from './computer-ui-fixture.jsx';
import {createRoot} from 'react-dom/client';
import {Workbench} from '../ui/Workbench.jsx';
import {WorkspaceOperationStatus} from '../ui/WorkspaceOperationStatus.jsx';

import '../electron-app/workbench.css';
import '../design/workspace-identity.css';
import '../ui/shell-state-auto.mjs';// layout facts as attributes, as the renderer host does (design light-flow §1.1)
import '../electron-app/shell.css';
import '../electron-app/ios-tokens.css';
import '../design/workspace-typography.css';
import '../design/workspace-density.css';
import '../design/workspace-dialogs.css';
import '../design/workspace-icons.css';
import '../design/workspace-pastel.css';
import '../design/workspace-alignment.css';
const wikiChatFixture=new URLSearchParams(location.search).has('wiki-chat');if(wikiChatFixture)window.wikiChatCalls=[];
let selected='aipro',connected=false,pending=null,model='qwen-fixture',catalogAt=1;
if(new URLSearchParams(location.search).has('catalog')){connected=true;window.catalogCalls=0;window.catalogDelay=0;window.catalogFailure=false;}
const models=[{id:'qwen-fixture',label:'Qwen fixture',contextLength:32000},{id:'second-exact-id',label:'Second fixture',contextLength:64000}];
// A project whose OpenWiki exists: without wiki files or a running initialization the Workbench shows the project start screen instead of the composer (2026-10-05).
const project={projectId:'fixture',name:'검증 프로젝트',branch:'main',files:[],wikiFiles:['openwiki/업무-지침.md'],tasks:[],proposals:[],processes:[],comparisons:[],profiles:[{id:'bash',label:'Bash'}]};
const realtimeActions=new URLSearchParams(location.search).has('realtime-actions');
if(realtimeActions){
 connected=true;const listeners=new Set(),runId='22222222-2222-4222-8222-222222222222';
 window.nubi={desktop:true,request:(method,args)=>api(method,args),onHostEvent:callback=>{listeners.add(callback);return()=>listeners.delete(callback);}};
 const changed=()=>listeners.forEach(callback=>callback({type:'workspace_activity',projectId:'fixture'}));
 const task={id:'realtime',request:'실시간 작업을 확인해 주세요.',state:'review',createdAt:new Date().toISOString(),messages:[],trace:[],criteria:[],responseTiming:{runId,afterMessageId:'realtime'}};
 project.tasks=[task,{id:'idle-realtime',request:'다른 대화',state:'review',createdAt:new Date().toISOString(),messages:[],trace:[],criteria:[]}];project.proposals=[{id:'live-file',taskId:task.id,runId,path:'src/live.mjs',kind:'create',state:'proposed',reason:'승인한 변경만 반영합니다.',quality:{state:'unsupported'},stats:{state:'counted',added:3,removed:0}}];
 window.liveHoldReads=()=>{window.liveReadsGate=new Promise(resolve=>{window.releaseLiveReads=()=>{window.liveReadsGate=null;resolve();};});};
 window.liveOpenDecision=()=>listeners.forEach(callback=>callback({type:'decision_open',id:'fixture:proposal:live-file'}));
 window.liveCalls=[];window.beginLiveAction=(kind,finish)=>{window.liveCalls.push(kind);return new Promise((resolve,reject)=>{window.finishLiveAction=()=>{const result=finish?.();changed();resolve(result||{accepted:true});};window.failLiveAction=()=>reject(Error('source_stale'));});};
 window.liveApi=async(method,args)=>{
  if(method==='startAgent'){if(window.delayLiveStart)await new Promise(resolve=>{window.finishLiveStart=resolve;});task.state='running';changed();return {state:'running'};}
  if(method==='answerAgent')return window.beginLiveAction('answer',()=>{task.questionHistory=[{...task.question,answer:{text:args.choice.text}}];task.question=null;task.state='running';});
  if(method==='decideSetupAction')return window.beginLiveAction('command',()=>{project.setupActions[0].state='started';project.setupActions[0].resultProcessId='live-process';project.processes=[{id:'live-process',taskId:task.id,state:'running',script:'node --version',output:'',profile:'bash'}];return structuredClone(project.setupActions[0]);});
 };
 window.liveStream=text=>{task.state='running';task.streamingAnswer=text;task.streamRevision=(task.streamRevision||0)+1;listeners.forEach(callback=>callback({type:'workspace_stream',projectId:'fixture'}));};
 window.liveComplete=()=>{task.state='review';task.streamingAnswer='';task.messages=[{id:'live-answer',runId,role:'assistant',content:'실시간으로 작성한 최종 응답입니다.'}];changed();};
 window.liveQuestion=()=>{task.state='waiting_input';task.question={id:'live-question',runId,text:'어떤 내용을 작성할까요?',kind:'text',inputMode:'long_text',options:[]};task.messages.push({id:'live-question-message',runId,questionId:task.question.id,role:'assistant',content:task.question.text});changed();};
 window.liveCommand=()=>{task.state='review';task.question=null;project.setupActions=[{id:'live-command',taskId:task.id,runId,state:'proposed',title:'버전 확인',profile:'bash',script:'node --version',reason:'버전을 확인합니다.',effects:'출력만 읽습니다.',fingerprint:'live-fingerprint'}];changed();};
 window.liveOutput=()=>{project.processes[0].output='v24.0.0\n출력을 받았습니다.';changed();};
 window.liveOtherProject=()=>listeners.forEach(callback=>callback({type:'workspace_activity',projectId:'other-project'}));
 window.liveReview=review=>{task.state='review';task.resultReview={...review,runId,status:review.state};changed();};
}
const decisionSequence=new URLSearchParams(location.search).has('decision-sequence');
if(decisionSequence){
 connected=true;window.decisionSequenceCalls=[];const runId='11111111-1111-4111-8111-111111111111',at='2026-10-23T01:00:00Z';
 const task={id:'decision-sequence',request:'순서와 승인 화면을 확인해 주세요.',state:'running',createdAt:at,criteria:[],trace:[],messages:[{id:'sequence-note',role:'assistant',content:'먼저 자료를 확인했습니다.',runId,at},{id:'sequence-steer',role:'user',content:'이 문장 뒤로 계획을 옮기지 마세요.',at:'2026-10-23T01:00:01Z'}],responseTiming:{runId,afterMessageId:'decision-sequence',startedAt:at},workPlan:{runId,steps:[{text:'자료 확인',status:'completed',expected_outcome:'자료를 확인합니다.'},{text:'결과 정리',status:'pending',expected_outcome:'결과를 정리합니다.'}]}};
 task.trace=[1,2,3].map(number=>({id:runId+':0:'+number,runId,tool:'read_source',label:'자료 조회',status:'error',reason:'source_missing'}));
 task.trace.push({id:runId+':0:4',runId,tool:'progress_note',content:'다른 경로로 확인을 이어갑니다.'});
 project.tasks=[task];
 project.setupActions=[1,2].map(number=>({id:'sequence-command-'+number,taskId:task.id,runId,title:'확인 명령 '+number,kind:'inspect',reason:'승인할 때만 실행합니다.',profile:'bash',workspace:'/fixture',script:'node --version',effects:'파일을 변경하지 않습니다.',fingerprint:'synthetic-'+number,state:'proposed'}));
 project.proposals=[{id:'sequence-file',taskId:task.id,runId,path:'src/example.mjs',kind:'create',reason:'검토한 내용을 반영합니다.',state:'proposed',afterHash:'synthetic',stats:{state:'counted',added:11,removed:0},quality:{state:'passed'}}];
 window.askSequenceQuestion=()=>{task.state='waiting_input';task.question={id:'sequence-question',runId,text:'결과를 어떻게 정리할까요?',kind:'choice',options:[{id:'table',label:'표로 정리'},{id:'text',label:'문장으로 정리'}]};task.messages.push({id:'sequence-question-message',role:'assistant',runId,questionId:task.question.id,content:task.question.text,at:'2026-10-23T01:00:02Z'});document.dispatchEvent(new Event('visibilitychange'));};
 window.advanceSequenceWithChangePlan=()=>{
  task.changePlan={id:'sequence-change-plan',runId,summary:'원래 실행의 파일 변경 계획',requirements:[],targets:[{path:'src/example.mjs',reason:'검토한 변경'}],checks:[],assumptions:[],impact:{items:[],unmapped:[]}};
  task.activityHistory=[{runId,state:'review',workPlan:task.workPlan,trace:task.trace,responseTiming:task.responseTiming,afterMessageId:task.id}];
  const next='22222222-2222-4222-8222-222222222222';task.messages.push({id:'sequence-next-request',role:'user',content:'다음 요청을 확인해 주세요.',at:'2026-10-23T01:02:00Z'});task.messages.push({id:'sequence-next-answer',role:'assistant',runId:next,content:'다음 요청의 자료를 확인하고 있습니다.',at:'2026-10-23T01:02:01Z'});
  task.state='running';task.responseTiming={runId:next,afterMessageId:'sequence-next-request',startedAt:'2026-10-23T01:02:00Z'};task.workPlan={runId:next,steps:[{text:'다음 자료 확인',status:'in_progress',expected_outcome:'다음 자료를 확인합니다.'}]};task.trace=[];window.dispatchEvent(new Event('focus'));
 };
 window.finishSequence=()=>{task.state='review';task.messages.push({id:'sequence-final',role:'assistant',runId,content:'요청한 확인을 마쳤습니다.',at:'2026-10-23T01:01:00Z'});document.dispatchEvent(new Event('visibilitychange'));};
}
const conversationUsageFixture=new URLSearchParams(location.search).has('usage');
if(conversationUsageFixture){connected=true;project.tasks=[{id:'conversation-usage',request:'사용량 확인',criteria:[],messages:[],trace:[],state:'review'}];}
const afterEditFailureFixture=new URLSearchParams(location.search).has('after-edit-failure');
if(afterEditFailureFixture){connected=true;project.tasks=[{id:'after-edit-failure',request:'검사 준비 실패',state:'review',criteria:[],trace:[],messages:[],afterEditCheckError:'source_stale',afterEditCheckPath:'src/app.mjs'}];}
const archiveFixture=new URLSearchParams(location.search).has('sidebar-archive');
if(archiveFixture){
 connected=true;
 project.tasks=[{id:'unread',request:'새로운 결과',unread:true},{id:'pinned',request:'고정한 대화'},{id:'archived',request:'지난 대화',archivedAt:'2026-09-01T00:00:00Z'}].map(task=>({state:'review',createdAt:'2026-10-18T12:00:00Z',criteria:[],trace:[],messages:[{role:'assistant',content:'보관해도 이 대화 내용은 그대로 남아요.'}],...task}));
 project.conversationNavigation={pinnedIds:null,autoArchiveDays:30,tasks:project.tasks};
 const saved=sessionStorage.getItem('archive-fixture');if(saved)Object.assign(project,JSON.parse(saved));
 if(!saved)localStorage.setItem('nubi-pinned-tasks:fixture',JSON.stringify(['pinned']));
 window.archiveCalls=[];
}
const proposalFixture=new URLSearchParams(location.search).get('proposal-review');
if(proposalFixture){
 connected=true;window.proposalCalls=[];
 project.tasks=[{id:'proposal-task',request:'변경 제안 검증',criteria:[],state:proposalFixture==='running'?'running':'review',messages:[{role:'assistant',content:'요청한 변경을 준비했습니다.'}],trace:[]}];
 project.proposals=[{id:'proposal-file',taskId:'proposal-task',path:'src/example.mjs',reason:'요청한 내용 반영',kind:'create',state:['attention','cancelled','applied'].includes(proposalFixture)?proposalFixture:'proposed',stats:{state:'counted',added:11,removed:0},quality:{state:'passed'}}];
 window.finishProposalReview=()=>{project.tasks[0].state='review';};
}
if(wikiChatFixture){project.backgroundProjects=[{projectId:'background-wiki',root:'/fixture/background',running:false,wikiChatJob:{id:'background-job',projectId:'background-wiki',kind:'update',state:'running',percent:50}}];window.wikiProjectSwitches=[];}
const reviewFailureFixture=new URLSearchParams(location.search).get('review-failure');
if(reviewFailureFixture){connected=true;project.tasks=[{id:'review-failure-task',request:'요구사항과 결과를 확인해 주세요.',state:'paused',checkpoint:{runId:'review-failed-run'},criteria:[],messages:[],trace:[],resultReview:{status:'error',reason:reviewFailureFixture},reviewDraft:{content:'검토 전 보관된 답변입니다.'}}];}
// Workflows and routines are off in this release: a stored workflow conversation and a saved routine still exist.
const workflowOffFixture=new URLSearchParams(location.search).has('workflow-off');
// The runner never writes messages to the umbrella task: its results live in the workflow-run record (final review 2026-10-22).
if(workflowOffFixture)project.tasks=[
 {id:'workflow-task',kind:'workflow',workflowRunId:'fixture-run',request:'합성 정의서 워크플로우',criteria:[],state:'waiting_input',question:{id:'workflow-question',kind:'text',text:'다음 단계로 갈까요?'},messages:[],trace:[]},
 {id:'workflow-interrupted',kind:'workflow',workflowRunId:'fixture-run-2',request:'중단된 정의서 워크플로우',criteria:[],state:'interrupted',messages:[],trace:[]},
 {id:'workflow-step-task',origin:{kind:'workflow_step',runId:'fixture-run',stepId:'collect'},request:'정의서 단계 대화',criteria:[],state:'interrupted',messages:[{id:'step-message',role:'assistant',content:'단계 대화 기록이에요.'}],trace:[]}];
const workflowRunFixture=runId=>({run:{id:runId,workflow:{name:'합성 정의서 워크플로우',steps:[{id:'collect',name:'자료 모으기',kind:'tool',action_summary:'합성 자료 확인'},{id:'write',name:'정의서 쓰기',kind:'tool',action_summary:'합성 정의서 작성'}],lanes:[]},status:runId==='fixture-run'?'waiting':'partial',cursor:'write',createdAt:'2026-10-21T09:00:00.000Z',updatedAt:'2026-10-21T09:05:00.000Z',steps:{collect:{status:'complete',startedAt:'2026-10-21T09:00:00.000Z',summary:'합성 자료를 정리했어요.'},write:{status:'interrupted',startedAt:'2026-10-21T09:03:00.000Z'}}},task:{id:runId,state:'interrupted'}});
const decisionFixture=new URLSearchParams(location.search).get('decision');
if(decisionFixture){
 connected=true;window.decisionCalls=[];
 project.tasks=[{id:'decision-task',request:'요청한 결과를 확인해 주세요.',criteria:[],state:decisionFixture==='question'?'waiting_input':'review',messages:[],trace:[]}];
 if(decisionFixture==='question')project.tasks[0].question={id:'decision-question',kind:'choice',text:'결과를 어떤 형식으로 정리할까요?',options:[{id:'table',label:'표로 정리',description:'항목별로 비교해요'},{id:'text',label:'문장으로 정리',description:'핵심 내용을 설명해요'}]};
 else project.setupActions=[{id:'decision-command',taskId:'decision-task',title:'실행 환경 확인',kind:'inspect',reason:'설치된 Node 버전을 확인합니다.',profile:'bash',workspace:'/fixture/project',script:'node --version',effects:'파일을 변경하지 않습니다.',verification:'실제 버전 출력과 종료 상태를 확인합니다.',references:[],fingerprint:'fixture',state:'proposed'}];
}
const irreversibleFixture=new URLSearchParams(location.search).get('irreversible');
if(irreversibleFixture){
 connected=true;window.decisionCalls=[];project.tasks=[{id:'irreversible-task',request:'승인 범위 확인',state:irreversibleFixture==='mcp'?'waiting_input':'review',messages:[],trace:[],criteria:[]}];
 if(irreversibleFixture==='mcp')project.tasks[0].question={id:'mcp-question',kind:'choice',text:'메일 발송을 허용할까요?',inputMode:'none',selection:'single',options:[{id:'run',label:'실행',description:'이번 한 번 실행'},{id:'cancel',label:'취소',description:'실행하지 않음'}],toolRequest:{serverId:'mail',tool:'send_mail',arguments:toolArgumentView({recipient:'fixture@example.invalid'}),scope:'once',irreversible:{reason:'외부 반영 도구'},alwaysAllowIgnored:true}};
 else {
  project.setupActions=[{id:'dangerous-command',taskId:'irreversible-task',title:'강제 push 확인',reason:'요청한 브랜치 갱신',profile:'bash',script:'git push --force origin main',workspace:'/fixture',effects:'원격 브랜치의 이력을 바꿉니다.',state:'proposed',irreversible:{reason:'강제 push'}}];
  project.proposals=[{id:'dangerous-delete',taskId:'irreversible-task',path:'src/old.mjs',kind:'delete',state:'proposed',reason:'요청한 파일 삭제',irreversible:{reason:'기존 파일 삭제'}}];
 }
}
if(new URLSearchParams(location.search).has('solution')){project.peerTasks=[{id:'design-request',recipient:'desktop',state:'submitted'}];window.nativeViewCalls=[];}
const status=()=>({modelCatalog:{fetchedAt:catalogAt},provider:selected,providers:Object.entries({aipro:'AI Pro',chatgpt:'ChatGPT',fabrix:'FabriX'}).map(([id,label])=>({id,label,connected:connected&&id===selected})),connected,pending,models:connected?models:[],model:connected?model:'',verified:false});
if(new URLSearchParams(location.search).has('message-footer')){connected=true;const at=new Date().toISOString();project.tasks=[{id:'footer',request:'네',state:'review',createdAt:at,messages:[{role:'user',content:'확인',at},{role:'assistant',content:'요청한 내용을 확인했어요.',at,responseTiming:{state:'completed',durationMs:65000,finishedAt:at}}],trace:[],criteria:[]}];}
if(new URLSearchParams(location.search).has('queue-layout')){
  connected=true;
  project.tasks=[{id:'queue-layout',request:'진행 내용을 간결하게 정리해 주세요.',state:'running',createdAt:new Date().toISOString(),checkpoint:{runId:'queue-run'},trace:[],messages:[{role:'assistant',content:'확인한 내용을 정리하고 있어요.',at:new Date().toISOString()}],inbox:[{id:'queued-message',mode:'queue',runId:'queue-run',text:'이 요청도 함께 반영해 주세요. 큐에서 올라온 메시지입니다.',createdAt:new Date().toISOString()}]}];
}
if(new URLSearchParams(location.search).has('interrupted-retry')){
 connected=true;const at=new Date().toISOString();window.retryResumeCalls=[];
 project.tasks=[{id:'retry-task',request:'확인하던 작업 이어가기',criteria:[],state:'interrupted',error:'network',createdAt:at,trace:[],messages:[{role:'user',content:'환경을 확인해 주세요.',at}],checkpoint:{runId:'retry-run'}}];
 project.setupActions=[{id:'retry-pending',taskId:'retry-task',title:'실행 환경 확인',kind:'inspect',reason:'설치된 Node 버전을 확인합니다.',profile:'bash',workspace:'/fixture/project',script:'node --version',effects:'파일을 변경하지 않습니다.',verification:'버전과 종료 상태 확인',references:[],fingerprint:'fixture',state:'proposed'}];
}
if(new URLSearchParams(location.search).has('side-tasks')){
 connected=true;const at=new Date().toISOString();const prompt='src/mail.mjs의 첨부 시간 초과 처리를 확인하고 tests/mail.test.mjs에 재현 시험을 추가해 주세요. 확인한 근거와 변경 결과를 정리해 주세요. '.repeat(3);
 project.tasks=[{id:'side-parent',request:'곁가지 작업 확인',criteria:[],state:'review',createdAt:at,trace:[],messages:[{id:'side-answer',role:'assistant',runId:'side-run',content:'현재 요청을 마쳤어요. 따로 확인할 작업은 아래에 남겼습니다.',at}],sideTasks:[
 {id:'side-one',title:'첨부 시간 초과 처리 보완',tldr:'확인된 첨부 실패가 안내 목록에서 빠져 있어요.',prompt,runId:'side-run',state:'proposed',at},
 {id:'side-two',title:'오래된 개발 안내 문서와 검사 방법 정리',tldr:'현재 명령과 다른 안내가 있어요.',prompt,runId:'side-run',state:'proposed',at}]}];
}
if(new URLSearchParams(location.search).has('outputs')){
 connected=true;const at=new Date().toISOString();
 project.tasks=[{id:'output-task',request:'검토 결과를 파일로 정리해 주세요.',criteria:[],state:'review',createdAt:at,trace:[],messages:[
 {id:'output-question',role:'assistant',runId:'output-run',questionId:'q',content:'보고서에 화면도 넣을까요?',at},
 {id:'output-answer',role:'assistant',runId:'output-run',content:'확인한 화면과 보고서를 준비했어요. 카드를 눌러 내용을 확인해 주세요.',at},
 {id:'output-followup',role:'user',runId:'next-run',content:'고마워요.',at}],outputs:[
 {id:'output-image',path:'capture-1.png',kind:'image',size:24576,caption:'검토한 결과 화면',runId:'output-run',at},
 {id:'output-text',path:'reports/프로젝트 검토 결과와 남은 확인 사항을 정리한 최종 보고서.md',kind:'text',size:1250,caption:'확인한 내용과 남은 작업을 정리했어요.',runId:'output-run',at}]}];
}
if(new URLSearchParams(location.search).has('chapters')){
 connected=true;
 const count=new URLSearchParams(location.search).has('chapters-long')?86:6;
 const messages=Array.from({length:count},(_,i)=>({id:'chapter-message-'+i,role:i%2?'assistant':'user',content:(i%2?'확인한 결과입니다.':'다음 자료를 확인해 주세요.')+'\n\n'+('대화 기록을 보존하며 현재 자료의 근거를 확인합니다. '.repeat(12)),runId:'chapter-run-'+Math.floor(i/2)}));
 project.tasks=[{id:'chapters-task',request:'챕터 화면 확인',criteria:[],state:'review',createdAt:new Date().toISOString(),messages,trace:[],chapters:(new URLSearchParams(location.search).has('chapters-many')?Array.from({length:20},(_,i)=>i*4+2):[2,4,count]).map((messageIndex,i)=>({id:'fixture-chapter-'+i,title:['자료 탐색','수정 사항','결과 검증'][i]||'확인 단계 '+(i+1),summary:'현재 단계에서 확인한 내용을 정리합니다.',messageIndex,runId:'chapter-run-'+i,at:new Date().toISOString()}))}];
}
if(new URLSearchParams(location.search).has('sessions')){
  connected=true;project.projectId='sessions-fixture';project.name='세션 검증 프로젝트';
  const now=new Date(),yesterday=new Date(now);yesterday.setDate(now.getDate()-1);
  project.tasks=[
    {id:'session-running',request:'실행 중인 분석',criteria:[],state:'running',createdAt:now.toISOString(),messages:[],trace:[]},
    {id:'session-review',request:'수정할 문서 확인',criteria:[],state:'review',createdAt:yesterday.toISOString(),messages:[],trace:[]},
    {id:'session-older',request:'지난달 코드 검토',criteria:[],state:'review',createdAt:new Date(2025,0,2).toISOString(),messages:[],trace:[]}
  ];
}
if(new URLSearchParams(location.search).has('connection')){
  connected=true;project.computer={availability:{available:true},apps:[],actions:[],checks:[]};
  project.tasks=[{id:'connection-task',request:'메신저 창의 안내문을 확인해 주세요.',criteria:[],state:'waiting_input',messages:[],trace:[],computerConnectionRequest:{id:'connect-1',state:'pending',reason:'안내문을 읽을 메신저 창을 선택해 주세요.',appHint:'업무 메신저'}}];
  window.connectionCalls=[];
}
if(new URLSearchParams(location.search).has('compaction')){connected=true;project.tasks=[{id:'compaction-task',request:'대화 압축 화면 검증',criteria:[],state:'running',checkpoint:{runId:'compaction-run'},/* activity is shown per run (2026-10-02) */messages:[{role:'user',content:'원문 보존 확인: 승인 없이 실행하지 마세요.',runId:'compaction-run'}],trace:[],context:{phase:'summarizing',operation:new URLSearchParams(location.search).get('operation')||'history',stage:new URLSearchParams(location.search).get('stage')||'draft'}}];}
if(new URLSearchParams(location.search).has('elevation')){connected=true;project.tasks=[{id:'elevation-task',request:'관리자 승인 화면 검증',criteria:[],state:'review',messages:[],trace:[]}];project.setupActions=['approve','reject'].map(id=>({id,taskId:'elevation-task',title:id==='approve'?'관리자 실행 검증':'관리자 실행 거절',reason:'합성 승인 흐름 검사',privilege:'administrator',privilegeReason:'시스템 범위 변경 필요',script:'Write-Output "fixture"',profile:'powershell',workspace:'C:\\fixture',effects:'검증용 합성 요청',verification:'실제 결과 확인',references:[],fingerprint:id,state:'proposed'}));}
// A check proposed with its fix (2026-09-30): the run button waits for the fix; always allow sits beside it.
if(new URLSearchParams(location.search).has('command')){connected=true;project.tasks=[{id:'command-task',request:'무료 배송 기준을 고치고 테스트로 확인해 주세요.',criteria:[],state:'review',messages:[],trace:[]}];project.proposals=[{id:'fix',taskId:'command-task',path:'src/shipping.mjs',reason:'무료 배송 기준을 정책 값 50,000원으로 되돌립니다.',state:'proposed'}];project.setupActions=[{id:'check',taskId:'command-task',title:'테스트 실행',kind:'verify',reason:'수정한 배송 기준을 테스트로 확인합니다.',privilege:'user',script:'npm test',profile:'bash',workspace:'/fixture/order-service',effects:'파일을 바꾸지 않습니다.',verification:'종료 코드 0과 실패 0건을 확인합니다.',references:[{path:'package.json',hash:'fixture'}],fingerprint:'check',state:'proposed',afterProposals:['fix']}];}
if(new URLSearchParams(location.search).has('command-analysis')){
 const paused=new URLSearchParams(location.search).get('command-analysis')==='paused',runId='11111111-1111-4111-8111-111111111111',task=project.tasks[0];
 task.state=paused?'paused':'running';task.checkpoint={runId,phase:paused?'planning':'model'};
 task.error=paused?'work_plan_invalid':null;task.recovery={state:paused?'attention':'checking',processId:'command-result'};
 task.trace=[{id:runId+':0:planning',runId,tool:paused?'recover_model':'read_process_output',label:paused?'작업 계획 확인':'실행 기록 확인',status:paused?'error':'running',reason:paused?'plan_json_invalid':undefined}];
 project.proposals=[];project.setupActions[0]={...project.setupActions[0],state:'started',resultProcessId:'command-result',afterProposals:[]};
 project.processes=[{id:'command-result',taskId:task.id,profile:'bash',script:'npm test',state:'completed',exitCode:0,output:'결과 확인용 출력',recoveryState:paused?'paused':'diagnosing'}];
}
if(new URLSearchParams(location.search).has('command-order')){
 connected=true;project.tasks=[{id:'order-task',request:'명령 순서 확인',state:'review',messages:[],trace:[]}];
 project.setupActions=[{id:'pending',title:'다음 명령 승인',state:'proposed'}, {id:'second',title:'두 번째 실행',state:'started'}, {id:'first',title:'첫 번째 실행',state:'started'}].map(row=>({...row,taskId:'order-task',script:'node --version',profile:'bash',workspace:'/fixture',reason:'실행 확인',effects:'파일을 변경하지 않습니다.',resultProcessId:row.state==='started'?'process-'+row.id:undefined}));
 project.processes=['second','first'].map(id=>({id:'process-'+id,taskId:'order-task',state:'completed',output:id,exitCode:0,recoveryState:'review'}));
}
if(new URLSearchParams(location.search).has('long-chat')){
 connected=true;const count=Number(new URLSearchParams(location.search).get('long-chat'))||240;
 project.tasks=[{id:'long-chat',request:'긴 대화 성능 확인',state:'review',messages:Array.from({length:count},(_,index)=>({id:'perf-'+index,role:index%2?'assistant':'user',content:index%2?`확인한 결과 ${index}입니다. **핵심 내용**을 먼저 안내합니다.\n\n| 항목 | 결과 |\n|---|---|\n| 확인 | 완료 |\n\n`+Array.from({length:8},(_,i)=>`- 근거 ${i+1}: 저장한 자료와 비교한 설명입니다.`).join('\n'):`자료 ${index}의 변경 내용을 확인해 주세요.`,at:'2026-10-15T01:00:00Z'})),trace:[]}];
}
if(new URLSearchParams(location.search).has('long-chat-question')){
 const task=project.tasks[0];task.state='waiting_input';task.question={id:'old-question',runId:'old-run',text:'이전 질문을 확인해 주세요.',options:['계속','중지']};task.messages[5]={...task.messages[5],questionId:'old-question',runId:'old-run',content:task.question.text};
}
if(new URLSearchParams(location.search).has('long-chat-live')){
 project.backgroundProjects=[{projectId:'background-fixture',running:true}];
 window.appendLongChat=()=>{const task=project.tasks[0];project.tasks=[{...task,messages:[...task.messages,{id:'appended',role:'assistant',content:'새 답변',at:'2026-10-15T02:00:00Z'}]}];};
 window.updateLongChat=()=>{const task=project.tasks[0];project.tasks=[{...task,messages:task.messages.map((message,index)=>index===task.messages.length-1?{...message,content:'갱신된 마지막 답변입니다.'}:message)}];};
}
if(new URLSearchParams(location.search).has('capture-gallery')){
 connected=true;const runId='11111111-1111-4111-8111-111111111111';
 const refs=['before','after','missing'].map((id,index)=>({id,width:800,height:450,label:['웹 캡처: 수정 전 주문 화면','웹 캡처: 수정 후 주문 화면','웹 캡처: 삭제된 이미지'][index],kind:'web',region:index===1}));
 window.captureRecords={};for(const ref of refs.slice(0,2)){const canvas=document.createElement('canvas');canvas.width=800;canvas.height=450;const ctx=canvas.getContext('2d');ctx.fillStyle='#F1F7FE';ctx.fillRect(0,0,800,450);ctx.fillStyle='#191F28';ctx.font='bold 32px sans-serif';ctx.fillText(ref.id==='before'?'주문 내역':'주문 내역 확인 완료',40,65);ctx.fillStyle=ref.id==='before'?'#E5E8EB':'#3182F6';ctx.fillRect(40,115,720,85);ctx.fillStyle='white';ctx.font='24px sans-serif';ctx.fillText('테스트 화면 이미지',60,167);window.captureRecords[ref.id]={image:canvas.toDataURL('image/png').split(',')[1]};}
 project.tasks=[{id:'capture-gallery',request:'두 화면을 확인해 주세요.',requestCaptures:[refs[0]],state:'review',checkpoint:{runId},messages:[{id:'capture-answer',role:'assistant',runId,content:'수정 전후 화면을 확인했습니다.',captures:refs}],trace:[{id:runId+':0:0',runId,tool:'inspect_workspace_page',status:'done',captures:[refs[1]]}]}];
}
// The composer gauge (2026-09-30): the tokens AI Pro reported for the latest answer, against the model window.
if(new URLSearchParams(location.search).has('progress')){
 connected=true;const runId=new URLSearchParams(location.search).has('activity-memos')?'11111111-1111-4111-8111-111111111111':'progress-run';
 project.tasks=[{id:'progress-task',request:'선택 메일 확인',state:'review',checkpoint:{runId},messages:[{role:'user',content:'선택 메일 확인',runId},{role:'assistant',content:'합성 화면 검증 결과입니다.',runId}],trace:['personal_mail_query','read_personal_mail','read_personal_mail','read_source','wiki_query','review_task'].map((tool,index)=>({id:`${runId}:0:${index}`,runId,tool,status:'done',label:'도구 호출'})),resultReview:{runId,status:'ready',checks:[{requirementId:'REQ-progress',state:'supported',detail:'선택한 원문과 답변의 근거를 대조했습니다.'}]}}];
}
if(new URLSearchParams(location.search).has('context')){connected=true;project.tasks=[{id:'context-task',request:'문맥 사용량 화면 검증',criteria:[],state:'review',messages:[],trace:[],context:{phase:'ready',compactions:1,beforeTokens:215000,afterTokens:61000,usage:{kind:'measured',used:23223,window:262144,prompt:23175,completion:48,reasoning:30,compactAt:213811,model:'qwen-fixture',at:'2026-09-30T12:00:00.000Z'}}}];}
if(new URLSearchParams(location.search).has('composer-stress')){models[0].label='업무 분석을 위한 아주 긴 모델 이름 GPT-6.1-Sol';if(new URLSearchParams(location.search).has('composer-running'))project.tasks[0].state='running';}
// Representative conversation for visual comparison, never a live-model claim.
if(new URLSearchParams(location.search).has('codex-chat')){
 connected=true;project.tasks=[{id:'codex-chat',request:'10월 운영 보고서의 변경 내용을 정리해 주세요.',state:'review',criteria:[],trace:[],messages:[
 {id:'codex-answer-1',role:'assistant',model:'qwen-fixture',at:'2026-10-17T01:00:00Z',content:'검토할 항목은 **예산, 일정, 담당자**입니다.\n\n운영 보고서와 변경 내역을 비교해 달라진 부분부터 정리하겠습니다.'},
 {id:'codex-user-2',role:'user',at:'2026-10-17T01:00:30Z',content:'예산 차이와 이번 주에 결정할 것만 짧게 보여 주세요.'},
 {id:'codex-answer-2',role:'assistant',model:'qwen-fixture',at:'2026-10-17T01:01:00Z',content:'예산은 **300만 원 증가**했고, 이번 주에는 적용 일정만 확정하면 됩니다.\n\n| 항목 | 기존 | 변경 |\n|---|---:|---:|\n| 운영 예산 | 2,400만 원 | 2,700만 원 |\n| 적용 부서 | 2개 | 3개 |\n\n- **금요일까지** 부서별 담당자를 확정합니다.\n- 추가 예산의 승인 여부를 확인합니다.\n\n이 대화는 화면 검토용 예시입니다.'}
 ]}];
}
if(new URLSearchParams(location.search).has('chat-preview')){
 const task=project.tasks[0];task.request='이번 주 회의 내용을 핵심만 정리해 줘.';
 task.messages=[{role:'assistant',model:'qwen-fixture',content:'확인할 내용은 **세 가지**입니다.\n\n- 일정: 다음 주 수요일까지 초안을 준비합니다.\n- 담당: 각 담당자가 변경 사항을 확인합니다.\n- 다음 단계: 초안을 검토한 뒤 최종 일정을 정합니다.\n\n이 화면은 채팅 배치를 확인하기 위한 예시입니다.'}];
}

if(new URLSearchParams(location.search).has('apply')){connected=true;project.tasks=[{id:'apply-task',request:'준비한 두 파일을 반영하고 결과를 확인해 주세요.',criteria:[],state:'review',messages:[],trace:[]}];project.proposals=['first','second'].map(id=>({id,taskId:'apply-task',path:id+'.txt',reason:'검토할 변경안',state:'proposed'}));}
if(new URLSearchParams(location.search).has('document')){
  connected=true;const partial=new URLSearchParams(location.search).get('document')==='partial';
  project.tasks=[{id:'document-task',request:'긴 업무 문서의 요구사항을 나눠 확인해 주세요.',criteria:[],state:partial?'review':'running',messages:[],trace:[],documentAnalysis:{id:'document-analysis',state:partial?'partial':'running',question:'승인 단계와 예외를 비교합니다.',phase:'synthesizing',completed:2,total:3,sources:[{id:'guide',path:'docs/업무-요구사항.md',hash:'fixture',characters:18000}],workers:[{taskId:0,role:'research',phase:'finished',outcome:'complete',summary:'승인 단계의 원문을 확인했습니다.',range:{documentId:'guide',start:0,end:6000}},{taskId:1,role:'research',phase:'finished',outcome:'partial',summary:'예외 처리 구간이 남아 있습니다.',range:{documentId:'guide',start:6000,end:12000}},{taskId:'synthesis:0',role:'synthesis',phase:'synthesizing',documentIds:['guide']}],...(partial?{coverage:{unreadRanges:[{documentId:'guide',start:12000,end:18000}]}}:{})}}];
}
if(new URLSearchParams(location.search).get('document')?.startsWith('history')){
  project.tasks[0].checkpoint={runId:'role-run'};
  project.tasks[0].trace=[{id:'role-run:0:role-worker',at:'2026-09-25T02:00:00.000Z',tool:'analysis_page',status:'running',analysis:{task:'저장 결과 화면을 확인합니다.',phase:'reading',calls:2,reads:1,doneWhen:'화면의 저장 상태 확인',sources:[{id:'screen',kind:'computer',tool:'read_computer_result',hasImage:true,historical:true,read:true,imageRead:true}]}}];
}
if(new URLSearchParams(location.search).get('document')==='history-resume'){project.tasks[0].checkpoint={runId:'resumed-run'};}
let historyFailure=true;
let handoffFinished=false;
if(new URLSearchParams(location.search).get('document')==='history-handoff'){
  project.tasks[0].trace=[];
  window.finishHandoffFixture=()=>{handoffFinished=true;};
}
const modalMail={connected:false,autoWiki:true,serverProfile:'company',counts:{received:0,queued:0,saved:0,attention:0},messages:[],total:0,activeModel:{provider:'aipro',model:'qwen-fixture'},storageRoot:'/fixture/personal'};
if(new URLSearchParams(location.search).has('modals')){project.wikiFiles=['openwiki/업무-지침.md'];project.defaultShell='bash';}
let ghes=new URLSearchParams(location.search).has('company-connected')?{state:'connected',connected:true,profile:{name:'긴 이름의 회사 계정 화면 검토 사용자',login:'fixture-user',bio:'함께 더 편리한 업무 환경을 만듭니다.',company:'화면 검증용 조직',email:'fixture@example.test',location:'서울',avatar:'data:image/png;base64,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'}}:{state:'guest',connected:false,profile:null};
const ghesAccount=async operation=>{// the company account dialog of the Electron rail: guest, a device code while connecting, and back (2026-10-07)
  if(operation==='login')ghes=new URLSearchParams(location.search).has('company-login-error')?{state:'guest',connected:false,profile:null,error:'ghes_login_endpoint_unavailable',diagnostic:{stage:'device_code',status:404}}:{state:'connecting',connected:false,profile:null,device:{code:'NUBI-1234'}};
  else if(operation==='cancel'||operation==='logout')ghes={state:'guest',connected:false,profile:null};
  return structuredClone(ghes);
};
if(new URLSearchParams(location.search).has('wiki-inventory')){project.wikiFiles=[];window.setWikiPages=files=>{project.wikiFiles=files;};}
const modalsVariant=new URLSearchParams(location.search).has('modals');
const mailFlow=new URLSearchParams(location.search).has('mail-flow');
if(mailFlow)connected=!new URLSearchParams(location.search).has('mail-disconnected');
const flowMails=Array.from({length:47},(_,i)=>({id:String(i+1).padStart(64,'0'),sourceHash:'a'.repeat(64),subject:[`10월 예산 승인 요청 ${i+1}`,`견적서 검토 결과 ${i+1}`,`프로젝트 일정 공유 ${i+1}`][i%3],from:['김누비 <nubi@example.test>','구매팀 <buy@example.test>','프로젝트팀 <team@example.test>'][i%3],to:'업무 담당자 <owner@example.test>',cc:'검토팀 <review@example.test>',date:'2026-10-12T01:00:00Z',text:'확인할 내용과 다음 일정을 공유합니다.\n\n예산안의 변경 항목을 확인해 주세요. 검토 의견은 목요일까지 취합합니다.\n승인 이후 구매 일정을 확정할 예정입니다.\n\n이 메일은 화면 검토용 예시입니다.',attachments:i%3===0?[{id:'attachment',filename:'10월 견적서.pdf',contentState:'document_read',sha256:'b'.repeat(64),coverage:'전체 2쪽 읽음'}]:[]}));
if(mailFlow)flowMails[0].text+='\n\n\n상세 안내 https://example.test/notice?tracking=fixture';
if(new URLSearchParams(location.search).has('conversation-search'))project.tasks=[{id:'bread',request:'아침 식사 추천',state:'review',createdAt:new Date().toISOString(),messages:[{role:'user',content:'간단한 메뉴를 추천해 주세요.'},{role:'assistant',content:'따뜻한 빵과 우유를 추천합니다. 식빵도 좋아요.'}],trace:[],criteria:[]},{id:'other',request:'다른 이야기',state:'review',createdAt:new Date().toISOString(),messages:[{role:'assistant',content:'오늘은 산책하기 좋아요.'}],trace:[],criteria:[]}];
if(new URLSearchParams(location.search).has('activity-readability')){
 const task=project.tasks[0],runId=task.checkpoint.runId;task.messages=task.messages.filter(message=>message.role!=='user');
 task.workPlan={runId,steps:[{text:'메일 원문 확인',status:'completed',expected_outcome:'선택한 원문과 출처 확인'},{text:'관련 자료 대조',status:'in_progress',expected_outcome:'메일과 프로젝트 자료의 차이 확인'},{text:'결과 정리',status:'pending',expected_outcome:'핵심 결과와 다음 행동 안내'}]};
 task.trace.forEach(row=>{delete row.label;});
 if(new URLSearchParams(location.search).has('timeline')) {
  task.trace.splice(0,0,{id:runId+':0:note1',runId,tool:'progress_note',status:'done',content:'**메일과 프로젝트 자료를 비교하겠습니다.** 먼저 원문을 확인하고 차이가 있는 항목을 정리하겠습니다.'});
  task.trace.splice(3,0,{id:runId+':0:note2',runId,tool:'progress_note',status:'done',content:'메일에서 변경된 일정을 확인했습니다. 관련 소스와 대조해 **실제 반영 여부**를 확인하겠습니다.'});
 }
 if(new URLSearchParams(location.search).has('activity-memos')) {
  task.trace.forEach((row,index)=>{row.startedAt=new Date(Date.UTC(2026,9,16,0,0,index*2)).toISOString();});
  task.thoughts=[1,3].map((index)=>({id:`${runId}:memo:${index}`,runId,at:new Date(Date.UTC(2026,9,16,0,0,index*2+1)).toISOString(),content:`기록된 작업 메모 ${index}`}));
  task.sources=[{path:'src/example.mjs',hash:'fixture'}];
 }
 window.activityState=state=>{task.state=state;task.trace.at(-1).status=state==='running'?'running':state==='paused'?'error':'done';task.trace.at(-1).label=state==='running'?'메일 원문과 프로젝트 자료를 대조하고 있어요':'답변과 근거 확인';task.responseTiming={elapsedMs:12500,startedAt:new Date().toISOString()};};
 window.activityState(new URLSearchParams(location.search).has('activity-paused')?'paused':'running');
 project.processes=[{id:'activity-process',taskId:task.id,profile:'powershell',cwd:'C:/repo/project',script:'Get-ChildItem -Name',state:'completed',exitCode:0,output:'src\nREADME.md\npackage.json'}];
}
if(new URLSearchParams(location.search).has('stopped-order')){
 const task=project.tasks[0],runId=task.checkpoint.runId;
 task.messages=[];task.responseTiming={runId,afterMessageId:task.id,startedAt:new Date().toISOString(),elapsedMs:12500};
 window.addSteering=()=>{task.messages.push({id:'steer-1',inputId:'input-steer',role:'user',content:'추가 요청은 이 위치에 남겨 주세요.',at:new Date().toISOString()});};
 window.stopOrderedRun=()=>{task.state='paused';task.trace.at(-1).status='error';};
}
if(new URLSearchParams(location.search).has('polling-response')){project.processes[0].state='running';window.pollCalls=[];window.finishProcess=()=>{project.processes[0]={...project.processes[0],state:'completed',output:'실행 완료 확인'};};}
const usageFixture=new URLSearchParams(location.search).has('chatgpt-usage');
if(usageFixture){connected=true;selected='chatgpt';model='gpt-5.6-sol';models.push({id:model,label:'GPT fixture',contextLength:262144});project.tasks=[{id:'usage-task',request:'사용량 확인',state:'review',messages:[{role:'assistant',content:'토큰 표시 검증용 응답입니다.'}],trace:[],criteria:[],context:{usage:{model,kind:'measured',used:23223,prompt:23175,completion:48,window:262144}}}];}
const usageSnapshot=()=>{const stats=window.usageWasReset?{calls:0,measured:0,total:0,input:0,output:0,inputReports:0,outputReports:0,pending:0}:{calls:1,measured:1,total:23223,input:23175,output:48,inputReports:1,outputReports:1,pending:0};return {auth:{provider:'chatgpt',present:true},connections:{chatgpt:{present:true,receivedAt:1}},accountUsage:window.quotaFixture||null,usage:{startedAt:window.usageResetAt||Date.UTC(2026,9,24,1,0,0),lastResetAt:window.usageResetAt||null,today:{chatgpt:stats},total:{chatgpt:stats}}};};
const sendTransition=new URLSearchParams(location.search).has('send-transition');
if(sendTransition){connected=true;const saved=sessionStorage.getItem('send-fixture');if(saved)Object.assign(project,JSON.parse(saved));window.saveSendFixture=()=>sessionStorage.setItem('send-fixture',JSON.stringify(project));window.sendCalls=[];window.sendGate={};window.finishSend=()=>{const task=project.tasks[0];task.state='review';task.messages.push({id:'finished',role:'assistant',content:'확인한 결과입니다.',at:new Date().toISOString()});};}
async function waitForSendGate(kind){await new Promise((resolve,reject)=>{window.sendGate[kind]={release:resolve,reject:()=>reject(Error('network'))};});}
const attachedDocument={id:'doc-fixture',sourceHash:'document-hash',filename:'분기 보고서.pdf',coverage:'2쪽 텍스트. 이미지와 OCR은 미확인',bytes:200};
if(new URLSearchParams(location.search).has('documents'))connected=true;
const routineRows=[];
if(new URLSearchParams(location.search).has('routines'))connected=true;
// A saved command exists before the final answer anchors its activity above a message.
// Keep the host snapshot immutable to the renderer, just like the worker transport.
const commandStatusRace=new URLSearchParams(location.search).get('command-status-race');
const commandRecordRace=new URLSearchParams(location.search).has('command-record-race')||!!commandStatusRace;
if(commandRecordRace){
 connected=true;
 project.tasks=[{id:'command-race',request:'명령 기록 펼침 확인',state:'running',criteria:[],trace:[],messages:[],checkpoint:{runId:'command-run'},responseTiming:{runId:'command-run'}}];
 project.setupActions=[{id:'command-action',taskId:'command-race',runId:'command-run',state:'started',title:'명령 결과 확인',profile:'bash',script:'printf command-output',resultProcessId:'command-process'}];
 project.processes=[{id:'command-process',taskId:'command-race',state:'completed',recoveryState:'review',exitCode:0,profile:'bash',cwd:'/synthetic',script:'printf command-output',output:'command-output'}];
 if(commandStatusRace){Object.assign(project.processes[0],{state:commandStatusRace,output:'',exitCode:null});window.commandStateReads=0;window.finishCommandProcess=()=>Object.assign(project.processes.find(p=>p.id==='command-process'),{state:'completed',output:'command-output',exitCode:0});project.processes.unshift({...project.processes[0],id:'older-process',state:'completed',output:'older-output',exitCode:0});}
 window.finishCommandTurn=()=>{project.setupActions.push({...project.setupActions[0],id:'other-command',title:'다른 명령 기록'});project.tasks[0].state='review';project.tasks[0].messages.push({id:'command-answer',role:'assistant',runId:'command-run',content:'명령 기록을 확인했습니다.'});document.dispatchEvent(new Event('visibilitychange'));};
}
const documentChatFixture=new URLSearchParams(location.search).has('document-form-chat');
if(documentChatFixture){connected=true;project.tasks=[{id:'form-chat',request:'출장 양식을 채워 줘',state:'review',criteria:[],trace:[],messages:[{id:'missing',role:'assistant',content:'출장 기간과 담당자를 한 번에 알려 주세요.',runId:'form-read'}]}];project.setupActions=[];project.processes=[];}
async function api(method,args={}){
  if(realtimeActions&&method==='state'&&args.streamOnly){const task=project.tasks[0];window.liveStreamReads=(window.liveStreamReads||0)+1;return {stream:task.state==='running'?{taskId:task.id,runId:task.responseTiming.runId,streamRevision:task.streamRevision||0,streamingAnswer:task.streamingAnswer||'',streamingReasoning:'',timing:{elapsedMs:700}}:null};}
  if(realtimeActions&&method==='poll')return structuredClone(project.processes.find(row=>row.id===args.id));
  if(realtimeActions&&['startAgent','answerAgent','decideSetupAction'].includes(method))return window.liveApi(method,args);
  if(documentChatFixture&&method==='startAgent'){const task=project.tasks[0];window.documentChatAnswer=args.answer;task.messages.push({id:'values',role:'user',content:args.answer,runId:'form-write'},{id:'written',role:'assistant',content:'사본을 문서/출장 작성.docx에 저장했어요. 원본은 그대로 두었습니다.',runId:'form-write'});task.state='review';return {taskId:task.id,state:'review'};}

  if(afterEditFailureFixture&&method==='retryAfterEditCheck'){window.afterEditRetries=(window.afterEditRetries||0)+1;throw Object.assign(Error('source_stale'),{details:{path:'src/app.mjs'}});}
  if(workflowOffFixture&&method==='workflowRun'){window.workflowRunReads=(window.workflowRunReads||0)+1;return workflowRunFixture(args.runId);}
  if(workflowOffFixture&&['resumeWorkflow','cancelWorkflow','answerAgent','startAgent'].includes(method)){window.workflowWrites=(window.workflowWrites||[]).concat(method);throw Error('workflow_feature_off');}
  if(method==='routineNotice')return workflowOffFixture&&!sessionStorage.getItem('routine-notice-acknowledged')?{show:true,text:'루틴은 다음 판에서 다시 켜집니다. 저장한 루틴은 그대로 있어요.'}:{show:false};
  if(method==='acknowledgeRoutineNotice'){window.routineNoticeAcknowledged=(window.routineNoticeAcknowledged||0)+1;sessionStorage.setItem('routine-notice-acknowledged','1');return {show:false};}
  if(method==='listRoutines'){if(window.routineFailure)throw Error('fixture_read_failure');return {items:structuredClone(routineRows),projects:[{id:project.projectId,name:project.name}]};}
  if(method==='saveRoutine'){const row={...args,id:args.id||'routine-fixture'},index=routineRows.findIndex(r=>r.id===row.id);if(index<0)routineRows.push(row);else routineRows[index]=row;return row;}
  if(method==='deleteRoutine'){if(args.confirmed!==true)throw Error('routine_confirmation');routineRows.splice(routineRows.findIndex(r=>r.id===args.id),1);return {deleted:true};}

  if(method==='taskUsage'){
   if(window.usageFailure)throw Error('fixture_usage_failure');
   return {taskId:args.taskId,modelCalls:8,toolCalls:2,compactions:1,retries:1,elapsedMs:8800,runCount:2,retentionDays:30,rows:['planner','actor','reviewer','summary','analysis','research'].map((purpose,i)=>({purpose,calls:[1,4,1,0,0,2][i],promptTokens:i===1?400:i>=3?null:100,completionTokens:i===3||i===4?null:10,cachedTokens:null,reports:{promptTokens:i===1?3:i>=3?0:1,completionTokens:i===3||i===4?0:1,cachedTokens:0}}))};
  }

  if(new URLSearchParams(location.search).has('interrupted-retry')&&['resumeAgent','startAgent'].includes(method)){
   if(method==='startAgent'){window.retryStartCalls=(window.retryStartCalls||0)+1;throw Error('fixture_unexpected_restart');}
   window.retryResumeCalls.push({method,...args});window.retryPendingState=project.setupActions[0].state;
   window.retryUserMessages=project.tasks[0].messages.filter(message=>message.role==='user').length;
   project.tasks[0].state='paused';return {taskId:args.taskId,state:'paused'};
  }

  if(method==='startSideTask'){
   const task=project.tasks.find(row=>row.id===args.taskId),chip=task.sideTasks.find(row=>row.id===args.sideTaskId);chip.state='started';
   const created={id:'side-child',request:chip.prompt,origin:{kind:'side_task',taskId:task.id,sideTaskId:chip.id,runId:chip.runId},criteria:[],state:'draft',createdAt:new Date().toISOString(),messages:[],trace:[]};project.tasks.unshift(created);window.startedSideTask={...args,taskId:created.id};return {taskId:created.id};
  }
  if(method==='dismissSideTask'){const task=project.tasks.find(row=>row.id===args.taskId);task.sideTasks.find(row=>row.id===args.sideTaskId).state='dismissed';window.dismissedSideTask=args.sideTaskId;return {state:'dismissed'};}

  if(method==='setPinnedTasks'){
   if(!args.initialize||project.conversationNavigation?.pinnedIds===null)project.conversationNavigation={...project.conversationNavigation,pinnedIds:[...new Set(args.ids)],tasks:project.tasks,autoArchiveDays:project.conversationNavigation?.autoArchiveDays??30};
   for(const task of project.tasks)if(project.conversationNavigation?.pinnedIds?.includes(task.id))task.archivedAt=null;
   return structuredClone(project.conversationNavigation);
  }
  if(method==='markTaskRead'){
   if(archiveFixture)window.archiveCalls.push({method,args});
   const task=project.tasks.find(row=>row.id===args.taskId);if(task)task.unread=false;
   return task?structuredClone(task):{viewingTaskId:null};
  }
  if(method==='archiveTask'){
   const task=project.tasks.find(row=>row.id===args.taskId);task.archivedAt=args.archived?new Date().toISOString():null;
   project.conversationNavigation.tasks=project.tasks;
   if(archiveFixture)sessionStorage.setItem('archive-fixture',JSON.stringify(project));
   return structuredClone(project.conversationNavigation);
  }
  if(method==='setAutoArchiveDays'){project.conversationNavigation={...project.conversationNavigation,autoArchiveDays:args.days};if(archiveFixture)sessionStorage.setItem('archive-fixture',JSON.stringify(project));return {days:args.days};}

  if(method==='listSkills'&&new URLSearchParams(location.search).has('documents'))return {skills:[],issues:[],truncated:false};
  if(method==='chooseChatDocuments')return {documents:[attachedDocument],errors:[]};
  if(method==='chatDocument'){window.documentReads=(window.documentReads||0)+1;return {...attachedDocument,text:'승인 예산은 1200입니다.',segments:[],offset:0,totalCharacters:17,partial:false};}
  if(new URLSearchParams(location.search).has('documents')&&['createTask','startAgent','agentInput'].includes(method))(window.documentCalls||=[]).push({method,args});
  if(method==='appliedFileSummary')return {files:project.proposals.filter(p=>p.state==='applied').map(p=>({...p,hash:'fixture',state:'verified'})),total:1,totals:{added:11,removed:0}};
  // Workspace capture (2026-10-14): the window picture is a canvas the size of the viewport with one blue block.
  if(method==='captureWorkspace'){const canvas=document.createElement('canvas');canvas.width=innerWidth;canvas.height=innerHeight;const ctx=canvas.getContext('2d');ctx.fillStyle='#dbeafe';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#1d4ed8';ctx.fillRect(40,40,200,120);window.captureCalls=(window.captureCalls||0)+1;window.captureArgs=[...(window.captureArgs||[]),args];let out=canvas;if(args.clip){out=document.createElement('canvas');out.width=args.clip.width;out.height=args.clip.height;out.getContext('2d').drawImage(canvas,args.clip.x,args.clip.y,args.clip.width,args.clip.height,0,0,args.clip.width,args.clip.height);}const url=out.toDataURL('image/png');return {image:url.slice(url.indexOf(',')+1),width:out.width,height:out.height,viewport:{width:innerWidth,height:innerHeight},...(args.clip?{clip:args.clip}:{}),title:'fixture'};}
  if(method==='capture'){(window.captureReads||=[]).push(args.id);const record=(window.captureRecords||{})[args.id];if(!record)throw Error('capture_missing');return record;}
  if(['createTask','startAgent','agentInput'].includes(method)&&Array.isArray(args.captures)&&args.captures.length){window.sentCaptures=[...(window.sentCaptures||[]),...args.captures.map(item=>({width:item.width,height:item.height,bytes:item.image.length}))];}
  if(proposalFixture&&method==='cancelProposal'){window.proposalCalls.push({method,...args});project.proposals.find(p=>p.id===args.proposalId).state='cancelled';return {state:'cancelled'};}

  if(wikiChatFixture&&(method==='wikiInitialization'&&['reset','retry'].includes(args.action)||method==='wikiUpdate'&&['refresh','resume'].includes(args.method))){
    window.wikiStartCalls=(window.wikiStartCalls||[]).concat({method,...args});
    await new Promise(resolve=>{window.releaseWikiAdmission=resolve;});
    if(window.rejectWikiAdmission)throw Error('model_unavailable');
    project.wikiChatBlocked=true;project.wikiChatJob={id:'rewrite',projectId:'fixture',kind:method==='wikiUpdate'?'update':'init',state:'running',stage:'generating',startedAt:new Date().toISOString(),completed:2,total:8,percent:25};
    return {...project.wikiChatJob,resetProjectId:'fixture'};
  }
  if(wikiChatFixture&&['createTask','startAgent','agentInput','regenerateAnswer'].includes(method)){window.wikiChatCalls.push(method);if(window.wikiSilentLock)throw Error('wiki_chat_blocked');}
  if(sendTransition&&['createTask','startAgent','agentInput'].includes(method)){
    window.sendCalls.push({method,args});if(method==='startAgent'&&project.tasks.find(item=>item.id===args.taskId)?.state==='running')throw Error('agent_busy');await waitForSendGate(method);
    if(method==='createTask'){const task={id:'sent-task',request:args.request,requestMailReferences:args.mailReferences,createdAt:new Date().toISOString(),criteria:[],state:'draft',messages:[],trace:[]};project.tasks.push(task);return structuredClone(task);}
    const task=project.tasks.find(item=>item.id===args.taskId);
    if(method==='agentInput'){task.inbox=[...(task.inbox||[]),{id:args.id,text:args.text,mode:'queue',createdAt:new Date().toISOString()}];return structuredClone(task);}
    task.state='running';task.checkpoint={runId:'send-run'};task.responseTiming={runId:'send-run',startedAt:new Date().toISOString(),elapsedMs:0};
    if(args.answer)task.messages.push({role:'user',content:args.answer,at:new Date().toISOString(),runId:'send-run'});
    task.trace=[{type:'progress',text:'관련 자료를 확인하고 있어요.',at:new Date().toISOString(),runId:'send-run'}];return {taskId:task.id,state:'running'};
  }
  if(window.pollCalls&&['poll','state'].includes(method))window.pollCalls.push(method);
  if(method==='poll'&&args.id==='activity-process')return structuredClone(project.processes[0]);
  if(method==='usage'&&usageFixture){
    if(args.action==='reset'){if(window.usageResetFailure)throw Error('usage_save_failed');await new Promise(r=>setTimeout(r,100));window.usageWasReset=true;window.usageResetAt=Date.now();return usageSnapshot();}
    if(args.action==='account'){window.quotaCalls=(window.quotaCalls||0)+1;await new Promise(r=>setTimeout(r,window.quotaDelay??3200));window.quotaFixture={version:2,fetchedAt:Date.now(),error:null,data:{windows:[{id:'primary',seconds:18000,remaining:75,resetsAt:Date.now()+3600000}]}};window.quotaFinished=Date.now();}
    else window.usagePolls=(window.usagePolls||0)+1;
    return usageSnapshot();
  }

  if(decisionSequence){
   if(method==='startAgent')return {taskId:project.tasks[0].id,state:project.tasks[0].state};
   if(method==='cancelProposal'){project.proposals.find(row=>row.id===args.proposalId).state='cancelled';return {state:'cancelled'};}
   if(method==='saveQuestionDraft'){project.tasks[0].question.draft=args.draft;return {saved:true};}
   if(method==='answerAgent'){
    window.decisionSequenceCalls.push({method,...args});const task=project.tasks[0],q=task.question;
    task.questionHistory=[...(task.questionHistory||[]),{...q,answer:{text:args.choice.text||q.options.find(option=>option.id===args.choice.optionId)?.label}}];task.question=null;task.state='review';return {accepted:true};
   }
   if(method==='decideSetupAction')window.decisionSequenceCalls.push({method,...args});
  }
  if(decisionFixture){
   if(method==='saveQuestionDraft'){project.tasks[0].question.draft=args.draft;return {saved:true};}
   if(method==='answerAgent'){if(window.decisionSendFailure)throw Error('model_unavailable');window.decisionCalls.push({method,...args});project.tasks[0].question=null;project.tasks[0].state='review';return {accepted:true};}
   if(method==='decideSetupAction')window.decisionCalls.push({method,...args});
  }
  if(method==='conversationHistory')return args.taskId?structuredClone(project.tasks.find(task=>task.id===args.taskId)):searchConversations(project.tasks,args);
  if(mailFlow){
    (window.mailFlowCalls||=[]).push({method,...args});
    if(method==='downloadMail')return {previewOnly:true};
    if(method==='mail'){
      if(args.action==='history')return {messages:flowMails,total:flowMails.length};
      if(args.action==='status')return {connected:true,autoWiki:false,counts:{received:47},progress:{}};
      if(args.action==='facets')return {saved:[],senders:[],tags:[]};
      if(args.action==='updateLocal')return args.patch;
      if(args.action==='read'){const mail=flowMails.find(row=>row.id===args.id);return {id:mail.id,sourceHash:mail.sourceHash,mail,local:{tags:[],pinned:false}};}
      if(args.action==='evidence'){if(window.mailEvidenceFailure===args.id)throw Error('mail_source_changed');if(window.mailEvidenceWait)await new Promise(resolve=>{window.releaseMailEvidence=resolve;});const mail=flowMails.find(row=>row.id===args.id);return {id:mail.id,sourceHash:mail.sourceHash,title:mail.subject,from:mail.from,date:mail.date};}
      if(args.action==='search'){
        const rows=flowMails.filter(row=>args.filters?.mailbox!=='sent').filter(row=>!args.query||`${row.subject} ${row.from} ${row.text}`.includes(args.query));
        const size=args.limit||20,total=rows.length,page=Math.max(1,Math.min(args.page||1,Math.ceil(total/size))),offset=(page-1)*size;
        return {results:rows.slice(offset,offset+size).map(row=>({...row,title:row.subject,sourceId:row.id,excerpt:row.text,attachmentCount:row.attachments.length})),total,totalPages:Math.ceil(total/size),page,offset,currentCursor:'fixture-'+page,nextCursor:offset+size<total?'fixture-next':null,unavailable:[]};
      }
    }
  }
  if(new URLSearchParams(location.search).has('modals')){
    if(method==='mail'){// the mail page searches and loads facets on open (2026-10-02)
      if(args.action==='search'||args.action==='query')return {scope:'personal-mail',query:args.query||'',filters:{},sort:'newest',results:[],total:0,totalPages:0,page:0,offset:0,currentCursor:null,nextCursor:null,reset:false,scanned:0,collected:0,saved:0,pending:0,unavailable:[],viewKey:'fixture',signature:'fixture'};
      if(args.action==='facets')return {saved:[],senders:[],tags:[]};
      return structuredClone(modalMail);
    }
    if(method==='listSkills'&&new URLSearchParams(location.search).has('builtin-commands'))return {skills:[],issues:[],truncated:false};
 if(method==='listSkills')return {skills:[{name:'보고서 작성',description:'회사 양식과 출처를 확인해 보고서를 작성해요.',path:'.nubi/skill/report/SKILL.md'},...Array.from({length:window.skillFixtureCount||0},(_,i)=>({name:`검토 스킬 ${String(i+1).padStart(2,'0')}`,description:'문서의 핵심 내용을 검토해요.',path:`.nubi/skill/review-${i}/SKILL.md`}))],issues:[],truncated:false};
    if(method==='skillTrash')return {items:[]};// the custom skill view loads the trash with the list (2026-10-02)
    if(method==='skillMarketplace'){(window.marketplaceCalls||=[]).push(args);if(args.operation==='install'){await new Promise(resolve=>setTimeout(resolve,window.skillDownloadDelay||0));window.skillDownloaded=args.id;}const result={credentialsReady:true,loginRequired:false,items:[{id:'simple-addition',name:'simple-addition',title:'간단 덧셈',version:'1.2.0',description:'두 수를 더하고 계산 과정을 설명해요.',state:'installed',updateAvailable:true,commit:'c1'},{id:'report-review',name:'report-review',title:'보고서 검토',version:'1.0.0',description:'보고서의 근거와 양식을 확인해요.',state:'available',commit:'c1'}],installed:[{id:'simple-addition',name:'simple-addition',version:'1.0.0',state:'installed'}]};result.items.push(...Array.from({length:window.skillFixtureCount||0},(_,i)=>({id:`catalog-${i}`,name:`catalog-${i}`,title:`공유 스킬 ${String(i+1).padStart(2,'0')}`,description:'프로젝트 자료를 검토해요.',state:'available',version:'1.0.0',commit:'c1'})));if(window.skillDownloaded){const item=result.items.find(item=>item.id===window.skillDownloaded);if(item){item.state='installed';item.updateAvailable=false;result.installed.push({id:item.id,name:item.name,title:item.title,version:item.version,state:'installed'});}}return result;}// the AI Workspace tab lists the company catalog beside what this project installed (2026-10-07)
    if(method==='wikiUpdate'){if(new URLSearchParams(location.search).has('wiki-inventory')&&!project.wikiFiles.length)return {status:{state:'unknown',reason:'no_wiki_pages'},updates:[]};const state=window.modalWikiState||'current';return {status:{state:state==='current'?'current':'outdated',lastUpdate:{updatedAt:'2026-10-01'},changedFiles:['src/index.ts'],uncommitted:['draft.txt'],stalePages:[{path:'openwiki/업무-지침.md',freshness:'source_changed'}]},updates:['ready','failed'].includes(state)?[{id:'fixture-update',state,...(wikiChatFixture&&state==='failed'?{canResume:true,fingerprint:'fixture'}:{}),changes:[{path:'openwiki/업무-지침.md',change:'modified'}],error:'model_unavailable'}]:[]};}
    if(method==='knowledgeStatus')return {state:'none'};
  }
  if(method==='computer'&&new URLSearchParams(location.search).has('connection')){
    window.connectionCalls.push(structuredClone(args));const task=project.tasks[0],request=task.computerConnectionRequest;
    if(args.taskId!==task.id)throw Error('wrong_task');
    if(args.method==='windows'&&window.connectionFail)throw Error('computer_command_failed');
    if(args.method==='windows')return {windows:[{hwnd:77,title:'업무 메신저',processName:'Messenger'}]};
    if(args.requestId!==request.id)throw Error('wrong_request');
    if(args.method==='save_connection_draft')request.draft=args.draft;
    if(args.method==='answer_connection'){request.state='answered';task.state='review';task.messages.push({role:'user',content:args.text});}
    if(args.method==='bind'){project.computer.binding={taskId:task.id,processName:'Messenger',windowTitle:'업무 메신저'};request.state='connected';}
    if(args.method==='continue_connection'){request.state='resolved';task.state='review';task.messages.push({role:'assistant',content:'연결한 창에서 같은 작업을 이어가는 합성 응답입니다.'});}
    if(args.method==='cancel_connection'){request.state='cancelled';task.state='cancelled';project.computer.binding=null;}
    return structuredClone(project.computer);
  }
  if(method==='analysisHistory'){
    if(realtimeActions){const review=project.tasks[0].resultReview;return {records:review?[{...review,id:'live-review',kind:'review'}]:[],next:null};}
    if(reviewFailureFixture)return {records:[{kind:'review',id:'review-failure',runId:'review-failed-run',state:'failed',reason:reviewFailureFixture}],next:null};
    const mode=new URLSearchParams(location.search).get('document');
    if(mode==='history-error'&&historyFailure){historyFailure=false;throw Error('fixture_history_failure');}
    const task=project.tasks.find(item=>item.id===args.taskId);
    if(new URLSearchParams(location.search).has('progress'))return {records:[{...task.resultReview,kind:'review',id:'review-progress',state:'ready'},{kind:'roles',id:'progress-run',runId:'progress-run',state:'complete',workers:[1,2].map(index=>({id:`mail-worker-${index}`,tool:'analysis_research',status:'done',analysis:{task:`선택 메일 ${index}의 원문과 개인 위키 비교`,phase:'finished',reads:1,calls:2,delivered:true,outcome:'complete',summary:`메일 ${index} 대조 결과`,sources:[{id:`mail-evidence-${index}`,tool:'read_personal_mail',kind:'mail',historical:true,read:true}]}}))}],next:null};
    const latest=task?.documentAnalysis;
    if(!latest)return {records:[],next:null};
    if(mode==='history-resume')return {records:[{kind:'roles',id:'role-run',runId:'role-run',state:'interrupted',workers:task.trace.map(worker=>({...worker,status:'interrupted',analysis:{...worker.analysis,phase:'finished'}}))}],next:null};
    if(mode==='history-handoff'){
      const role={kind:'roles',id:'old-role',state:handoffFinished?'partial':'running',workers:[{id:'old-worker',tool:'analysis_review',status:handoffFinished?'done':'running',analysis:{task:'이전 분담의 저장 결과 확인',phase:handoffFinished?'finished':'reading',outcome:'partial',delivered:handoffFinished,calls:2,reads:1,uncertainties:handoffFinished?['저장 후 다시 열기는 미확인입니다.']:[],nextStep:handoffFinished?'파일을 다시 열어 값을 확인합니다.':''}}]};
      const review={kind:'review',id:'review-fixture',state:'revise',round:1,advisoryCount:1,omittedHandoffs:1,omittedUnresolvedHandoffs:1,nextStep:'저장된 결과를 다시 확인합니다.',checks:[{requirementId:'fixture',state:'unknown',detail:'파일 재열기 근거가 없습니다.'}]};
      return {records:args.before?[role]:[{...latest,kind:'document'},review],updates:args.refresh?.some(item=>item.kind==='roles'&&item.id===role.id)?[role]:[],next:args.before?null:'older'};
    }
    if(mode?.startsWith('history')){
      const previous=index=>({...latest,kind:'document',id:'previous-'+index,state:'partial',question:'이전 문서 조사 '+index,phase:'synthesis_finished',workers:[{taskId:'older-'+index,role:'research',phase:'finished',outcome:'partial',summary:'이전 조사 기록 '+index}],coverage:{unreadRanges:[{documentId:'guide',start:12000,end:18000}]}});
      if(args.before)return {records:[previous(2)],next:null};
      return {records:[{...latest,kind:'document'},{kind:'roles',id:'role-run',runId:'role-run',state:task.state==='running'?'running':'interrupted',workers:task.state==='running'?task.trace.map(worker=>({...worker,at:'2026-09-25T01:00:00.000Z',status:'running',analysis:{...worker.analysis,calls:0,reads:0}})):task.trace},previous(1)],next:'older'};
    }
    return {records:[{...latest,kind:'document'}],next:null};
  }
  if(method==='provider'){
    const {action='status',input={}}=args;
    if(action==='refresh'){window.catalogCalls=(window.catalogCalls||0)+1;await new Promise(resolve=>setTimeout(resolve,window.catalogDelay||0));if(window.catalogFailure)throw Error('network');catalogAt++;}
    if(action==='login'){if(new URLSearchParams(location.search).has('security-policy'))(window.policyLoginCalls||=[]).push(input.provider);selected=input.provider;pending=selected;setTimeout(()=>{pending=null;connected=true;},200);}
    if(action==='cancel'){pending=null;connected=false;}
    if(action==='select')selected=input.provider;
    if(action==='model')model=input.model;
    if(action==='disconnect')connected=false;
    return status();
  }
  if(method==='fabrix'){
    if(args.method==='TEST_FABRIX')return {testId:args.testId,modelCount:2};
    if(args.method==='CONNECT_FABRIX'){selected='fabrix';connected=true;const task=project.tasks[0];if(task){task.state='running';setTimeout(()=>{task.messages.push({role:'assistant',content:'연결 후 대기 중인 오류 분석을 확인한 합성 결과입니다.'});task.state='review';},400);}return {connected:true};}
    return {cancelled:true};
  }
  if(method==='decideSetupAction'){const action=project.setupActions.find(a=>a.id===args.id);if(args.decision==='approve'&&action.privilege==='administrator'&&args.elevationConsent!==true)throw Error('elevation_approval_required');action.state=args.decision==='approve'?'started':'rejected';if(action.state==='started')project.tasks[0].messages.push({role:'assistant',content:'합성 관리자 승인 전달을 확인했습니다. 실제 UAC 실행은 하지 않았습니다.'});return action;}
  if(method==='poll'&&new URLSearchParams(location.search).has('command-analysis'))return structuredClone(project.processes.find(row=>row.id===args.id));
  if(method==='stopAgent'){project.tasks[0].state='cancelled';if(project.tasks[0].context)project.tasks[0].context.phase='ready';if(project.tasks[0].documentAnalysis)project.tasks[0].documentAnalysis.state='cancelled';return project.tasks[0];}
  // Automatic approval (2026-09-30): the mode is kept; nothing is waiting, so nothing is approved automatically.
  if(method==='allowCommand'){const action=project.setupActions.find(a=>a.id===args.id);const policy=window.approvalPolicy||={mode:'ask',allowedCommands:[]};if(!policy.allowedCommands.some(item=>item.profile===action.profile&&item.script===action.script))policy.allowedCommands.push({profile:action.profile,script:action.script});return structuredClone(window.approvalPolicy);}
  if(method==='approvalPolicy')return structuredClone(window.approvalPolicy||={mode:'ask',allowedCommands:[{profile:'bash',script:'npm test'}]});
  if(method==='setApprovalMode'){(window.approvalPolicy||={mode:'ask',allowedCommands:[]}).mode=args.mode;(window.approvalCalls||=[]).push(args.mode);return structuredClone(window.approvalPolicy);}
  if(method==='removeAllowedCommand'){window.approvalPolicy.allowedCommands=window.approvalPolicy.allowedCommands.filter(item=>item.script!==args.script);return structuredClone(window.approvalPolicy);}
  if(method==='autoApprovals'){(window.autoApprovalChecks||=[]).push(args.taskId);return {mode:window.approvalPolicy?.mode||'ask',proposals:[],command:null};}
  if(method==='deleteTask'){(window.deletedTasks||=[]).push(args.taskId);project.tasks=project.tasks.filter(task=>task.id!==args.taskId);return {deleted:args.taskId};}
  if(method==='overview'||method==='state'){if(realtimeActions&&window.liveReadsGate)await window.liveReadsGate;if(commandStatusRace&&method==='state')window.commandStateReads++;if(new URLSearchParams(location.search).has('noproject'))throw Error('project_missing');if(project.conversationNavigation)project.conversationNavigation.tasks=project.tasks;return structuredClone(project);}
  if(new URLSearchParams(location.search).has('message-footer')){
    if(method==='regenerateAnswer'){window.redoCalls=(window.redoCalls||0)+1;const task=project.tasks.find(t=>t.id===args.taskId);task.messages.pop();task.state='running';task.responseTiming={elapsedMs:0,startedAt:new Date().toISOString(),runId:'redo-fixture'};setTimeout(()=>{task.messages.push({id:'redone',role:'assistant',content:'새로 확인한 답변이에요.',at:new Date().toISOString()});task.state='review';},1200);return {state:'running'};}
    if(method==='createTask'){const task={id:'other-task',request:args.request,state:'draft',createdAt:new Date().toISOString(),messages:[],trace:[],criteria:[]};project.tasks.push(task);return structuredClone(task);}
    if(method==='startAgent'){const task=project.tasks.find(t=>t.id===args.taskId);window.startCalls=(window.startCalls||0)+1;await new Promise(r=>setTimeout(r,1500));task.state='running';task.responseTiming={runId:task.id,startedAt:new Date().toISOString(),elapsedMs:0};return {state:'running'};}
  }
  if(method==='createTask'){const task={id:'fixture-task',request:args.request,requestDocuments:args.documentReferences,documentReferences:args.documentReferences,requirementId:'REQ-fixture',criteria:[],state:'draft',messages:[],trace:[]};project.tasks=[task];return task;}
  if(method==='agentInput'&&new URLSearchParams(location.search).has('queue-layout')){
    const task=project.tasks[0],item=task.inbox.find(item=>item.id===args.id);
    if(args.action==='steer'&&item){item.mode='steer';setTimeout(()=>{task.inbox=[];task.messages.push({role:'user',inputId:item.id,content:item.text,at:new Date().toISOString(),runId:'queue-run'},{role:'assistant',content:'추가 요청까지 반영했습니다. 이 화면은 배치 확인용 예시입니다.',at:new Date().toISOString(),runId:'queue-run'});task.state='review';},1800);}
    return structuredClone(task);
  }
  if(method==='agentInput'&&window.commandReviewRace){const task=project.tasks[0];task.inbox=[{id:args.id,text:args.text,mode:'queue',createdAt:Date.now(),runId:args.runId}];window.commandReviewAdmissions=(window.commandReviewAdmissions||0)+1;return structuredClone(task);}
  if(method==='startAgent'){if(window.commandReviewRace){const task=project.tasks[0];task.state='running';task.checkpoint={runId:'command-review-race'};throw Error('agent_busy');}if(window.slowStart)await new Promise(resolve=>setTimeout(resolve,1500));const task=project.tasks[0];const runId=`fixture-run-${(task.runCount=(task.runCount||0)+1)}`;// activity is shown per run: the plan and messages carry the run id (2026-10-02)
    task.workPlan={runId,steps:[{text:'현재 문구 확인',expected_outcome:'변경할 문구와 유지할 조건을 확인합니다.',status:'in_progress'},{text:'수정안과 확인 결과 정리',expected_outcome:'변경안과 아직 확인하지 못한 결과를 구분합니다.',status:'pending'}]};if(args.answer)task.messages.push({role:'user',content:args.answer,runId});task.messages.push({role:'assistant',content:'**핵심 내용을 먼저 보여줍니다.**\n\n이 응답은 화면 흐름 검증용 합성 응답입니다. **실제 모델 결과가 아닙니다.**',runId});task.state='review';return {taskId:task.id,state:'review'};}
  throw new Error('fixture_method_invalid');
}
const fixtureRoot=document.getElementById('root');
// Use the actual Electron style scope; the all-surfaces host already owns it.
if(new URLSearchParams(location.search).has('integrated')&&!fixtureRoot.closest('.desktop-shell')){const shell=document.createElement('div');shell.className='desktop-shell';shell.dataset.layout='split';fixtureRoot.replaceWith(shell);shell.append(fixtureRoot);fixtureRoot.className='desktop-agent';}
// Exercise the real titlebar portal as well as the rail fallback.
if(new URLSearchParams(location.search).has('toolbar')&&!document.getElementById('toolbar')){const shell=fixtureRoot.closest('.desktop-shell');shell.dataset.toolbar='true';shell.dataset.platform='darwin';const toolbar=document.createElement('div');toolbar.id='toolbar';toolbar.className='desktop-titlebar';shell.prepend(toolbar);}
const wikiFixture=new URLSearchParams(location.search).has('wiki-progress')?{id:'wiki-fixture',state:'running',stage:'generating',startedAt:new Date(Date.now()-60000).toISOString(),stageStartedAt:new Date(Date.now()-30000).toISOString(),completed:3,total:10,percent:30}:undefined;
function WorkbenchFixture(){useModalDismissalPolicy();const [operation,setOperation]=useState(null);const [sources,setSources]=useState(null),[wiki,setWiki]=useState(wikiFixture);window.setWikiFixture=setWiki;if(wikiChatFixture)window.setWikiChatJob=job=>{project.wikiChatBlocked=!!job;project.wikiChatJob=job;setWiki(job);};return <><Workbench onActivityChange={realtimeActions?setOperation:undefined} renameProject={new URLSearchParams(location.search).has('chapters')?async()=>{}:undefined} openTerminal={context=>{window.openedTerminal=context;}} projects={wikiChatFixture?[{id:'fixture',name:'검증 프로젝트',root:'/fixture/current'},{id:'background-wiki',name:'백그라운드 프로젝트',root:'/fixture/background'}]:[]} switchProject={wikiChatFixture?async id=>{window.wikiProjectSwitches.push(id);}:undefined} showAnalysisHistory={new URLSearchParams(location.search).has('document')} wikiInitialization={wiki} openTeamWorkspace={async()=>{(window.nativeViewCalls||=[]).push('team-workspace');}} openMailSources={mailFlow?references=>{window.mailSourceCalls=references;setSources(references);}:undefined} toolbarHost={document.getElementById("toolbar")} hostLayout={new URLSearchParams(location.search).has('integrated')?'integrated':undefined} workspaceView={['solution','modals','integrated'].some(key=>new URLSearchParams(location.search).has(key))?async view=>{(window.nativeViewCalls||=[]).push(view);}:undefined} api={api} openCurrent={async()=>new URLSearchParams(location.search).has('noproject')?null:(commandRecordRace||documentChatFixture||wikiChatFixture||sendTransition||new URLSearchParams(location.search).has('wiki-inventory')||new URLSearchParams(location.search).has('long-chat-live'))?structuredClone(project):project} chooseFolder={()=>{}} openPath={path=>{window.openedPath=path;}} review={()=>{}} reviewApplied={async(row,taskId)=>{window.appliedComparison={path:row.path,taskId};}} apply={async id=>{const proposal=project.proposals.find(p=>p.id===id);if(realtimeActions)return window.beginLiveAction('apply',()=>{proposal.state='applied';});if(proposal)proposal.state='applied';}} openURI={()=>{}} openBrowser={()=>{}} cloneRepository={async url=>{(window.cloneCalls||=[]).push(url);return {cancelled:true};}} ghesAccount={modalsVariant?ghesAccount:undefined} ghesUpdate={modalsVariant?async()=>({state:'unchecked'}):undefined} ghesRepositories={modalsVariant?async()=>({cancelled:true}):undefined}/>{realtimeActions&&operation&&createPortal(<footer className="desktop-mail-progress" aria-label="작업 상태"><WorkspaceOperationStatus activity={operation}/></footer>,fixtureRoot.parentElement)}{sources&&createPortal(<aside className="desktop-pane"><header><strong>메일 원문</strong><WorkspaceAction action="close" label="원문 닫기" onClick={()=>setSources(null)}/></header><MailSourcePane references={sources} api={api}/></aside>,fixtureRoot.parentElement)}</>;}
export {api as fixtureApi,project as fixtureProject};
if(!window.__nubiExternalFixture)createRoot(fixtureRoot).render(new URLSearchParams(location.search).has('pointer')?<ComputerPointerUiFixture/>:new URLSearchParams(location.search).has('keyboard')?<ComputerKeyboardUiFixture/>:new URLSearchParams(location.search).has('controls')?<ComputerControlUiFixture/>:new URLSearchParams(location.search).has('computer')?<ComputerUiFixture/>:<WorkbenchFixture/>);
