import './ui-source-loader.mjs';
import test, {afterEach, after} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
const dom=new JSDOM('<!doctype html><html lang="ko"><head><title>Office source tests</title></head><body></body></html>',{url:'https://office.test',pretendToBeVisual:true});
for(const name of ['window','document','navigator','HTMLElement','Element','Node','MutationObserver','getComputedStyle','innerWidth','innerHeight'])Object.defineProperty(globalThis,name,{configurable:true,value:dom.window[name]});
globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
dom.window.HTMLElement.prototype.scrollIntoView=function(){};
const React=await import('react');
const {render,screen,fireEvent,waitFor,cleanup,act}=await import('@testing-library/react');
const {default:axe}=await import('axe-core');
const {TaskActivity}=await import('../src/TaskActivity.jsx');
const {TaskDock}=await import('../src/TaskDock.jsx');
const {OfficeQuestion}=await import('../src/OfficeQuestion.jsx');
const {OfficeTransaction}=await import('../src/OfficeTransaction.jsx');
const {OfficeDocumentResult}=await import('../src/OfficeDocumentResult.jsx');
const {TemplatePreservation}=await import('../src/TemplatePreservation.jsx');
const {ActionApproval}=await import('../../../extensions/aipro-chat/src/ActionApproval.jsx');
const {taskView}=await import('../src/task-view.js');
const {TaskRecovery}=await import('../src/TaskRecovery.jsx');
const h=React.createElement;
afterEach(cleanup);after(()=>dom.window.close());
const steps=[{id:'one',title:'양식 확인',state:'done'},{id:'two',title:'내용 작성',state:'waiting'}];
const run={state:'running',phase:'awaiting_input',plan:{steps,completed:1,total:2},activity:[{id:'ask',kind:'input',state:'running',title:'필요한 입력 확인',startedAt:Date.now()}]};

test('worker progress exposes assigned ranges and reduction status without treating queued work as completed',async()=>{
  const nodes=[{id:'partition:1',phase:'partition',title:'구간 1',scope:'분석 항목 1~30',state:'done',summary:'근거 2 / 충돌 0 / 미확인 0'},
    {id:'partition:2',phase:'partition',title:'구간 2',scope:'분석 항목 31~60',state:'running'},
    {id:'requirement:0',phase:'reduction',title:'요구사항 1',scope:'보고서의 조건 대조',state:'pending'}];
  const running={state:'running',phase:'reviewing_result',reviewWorkers:{nodes}};
  const view=render(h(TaskActivity,{run:running,latest:true}));
  assert.ok(screen.getByText('구간 검토 1/2 / 통합 검토 0/1'));
  assert.ok(screen.getAllByText('분석 항목 31~60').length);
  assert.ok(screen.getByText('워커별 역할과 결과'));
  assert.equal((await axe.run(view.container,{rules:{'color-contrast':{enabled:false}}})).violations.length,0);
  view.rerender(h(TaskActivity,{run:{...running,state:'cancelled'},latest:true}));
  assert.equal(view.container.querySelectorAll('.status-spinner').length,0);
  assert.ok(screen.getByText('구간 검토 1/2 / 통합 검토 0/1'));
  assert.ok(screen.getAllByText('미완료').length);
});

test('dynamic roles show dependencies and missing evidence without claiming partial completion',async()=>{
  const nodes=[
    {id:'source',taskId:'source',phase:'delegation',title:'수식 근거 담당',scope:'합계 수식의 원문 대조',state:'done',summary:'합계 근거 확인'},
    {id:'style',taskId:'style',phase:'delegation',title:'양식 보존 담당',scope:'문서 서식과 병합 범위 확인',state:'waiting',summary:'추가 원문이 필요합니다.',missing:['머리글 원문','반복 표의 마지막 행']},
    {id:'merge',taskId:'merge',phase:'delegation',title:'결과 통합 담당',scope:'분석 근거를 요청 조건에 연결',state:'blocked',dependsOn:['source','style']}
  ];
  const running={state:'running',phase:'executing',delegationWorkers:{nodes}};
  const view=render(h(TaskActivity,{run:running,latest:true}));
  const region=screen.getByRole('region',{name:'역할별 분석 워커'});
  assert.ok(screen.getByText('분석 1/3 / 확인 필요 1 / 대기 1'));
  const details=screen.getByText('역할과 작업 순서').closest('details');
  assert.equal(details.open,false);
  assert.ok([...region.querySelectorAll('.office-trace-detail')].some(node=>node.textContent==='확인 필요: 머리글 원문'&&!node.closest('details')));
  assert.ok(screen.getByText('확인 필요: 반복 표의 마지막 행').closest('details'));
  await act(async()=>{fireEvent.click(details.querySelector('summary'));await new Promise(resolve=>setTimeout(resolve,0));});assert.equal(details.open,true);
  assert.ok(screen.getByText('선행: 수식 근거 담당, 양식 보존 담당'));
  assert.equal(region.querySelector('[data-worker-id="merge"]').dataset.state,'blocked');
  assert.equal(region.querySelectorAll('.status-spinner').length,0);
  assert.equal((await axe.run(view.container,{rules:{'color-contrast':{enabled:false}}})).violations.length,0);
  for(const state of ['cancelled','failed','done']){
    view.rerender(h(TaskActivity,{run:{...running,state},latest:true}));
    assert.equal(region.querySelectorAll('.status-spinner').length,0);
    assert.equal(region.querySelector('[data-worker-id="source"]').dataset.state,'done');
    assert.equal(region.querySelector('[data-worker-id="style"]').dataset.state,'unconfirmed');
    assert.equal(region.querySelector('[data-worker-id="merge"]').dataset.state,'unconfirmed');
    assert.ok(screen.getByText('분석 1/3'));
  }
});

test('waiting plan pauses spinners and the action remains discoverable outside the log',()=>{
  const view=render(h(TaskActivity,{run,latest:true}));
  assert.equal(screen.getByText('답변 대기',{selector:'#activity-now-label'}).textContent,'답변 대기');
  assert.equal(view.container.querySelectorAll('.status-spinner').length,0);
  assert.equal(view.container.querySelector('.task-plan').dataset.status,'awaiting_user');
  assert.equal(view.container.querySelector('.task-plan details').open,false);
  assert.equal(view.container.querySelector('.agent-trace').open,false);
  let located=0;const dock=render(h(TaskDock,{run,input:{},onLocate:()=>located++}));
  assert.ok(!screen.queryByRole('button',{name:'질문 보기'}));
  dock.rerender(h(TaskDock,{run,input:{},interactionVisible:false,onLocate:()=>located++}));
  fireEvent.click(screen.getByRole('button',{name:'질문 보기'}));assert.equal(located,1);
});
test('receipt and network wait take priority over a stale input or approval phase',()=>{
  assert.equal(taskView(run,{input:{sending:true}}).label,'답변 전달 확인 중');
  assert.equal(taskView({...run,recovery:{state:'waiting'}},{input:{sending:true}}).state,'retry_wait');
  assert.equal(taskView({...run,phase:'awaiting_approval',recovery:{state:'waiting'}}).state,'retry_wait');
  assert.equal(taskView({...run,recovery:{state:'paused'}},{input:{sending:true}}).state,'awaiting_recovery');
});

test('old activity folds without losing errors or inflating verified completion',()=>{
  const events=Array.from({length:20},(_,i)=>({id:String(i),kind:'tool',state:i===0?'error':'done',title:`실행 ${i}`,startedAt:1,endedAt:2}));
  const view=render(h(TaskActivity,{run:{...run,phase:'executing',activity:events},latest:true}));
  assert.equal(view.container.querySelectorAll('#activity-feed > li').length,3);
  const details=screen.getByText('이전 진행 기록 17개').closest('details');assert.equal(details.open,false);assert.ok(details.textContent.includes('실행 0'));
  fireEvent.click(details.querySelector('summary'));
  assert.equal(details.open,true);assert.equal(screen.getByText('1/2 완료').textContent,'1/2 완료');
});
test('read-only completion and unsupported requests do not claim writes or empty status',()=>{
  const view=render(h(TaskActivity,{run:{state:'done',writes:0,activity:[]},latest:true}));
  assert.ok(screen.getByText('분석을 마쳤습니다. 셀을 변경하지 않았습니다.'));
  view.rerender(h(TaskActivity,{run:{state:'unsupported',activity:[]},latest:true}));
  assert.ok(screen.getByText('지원 범위 확인 필요'));
});
test('question retains rejected text and permits correction before receipt acknowledgement',async()=>{
  let calls=0,ack;
  render(h(OfficeQuestion,{question:{id:'q',text:'필요한 내용을 알려주세요.',kind:'text',options:[],inputLimit:10000},onDraft:async()=>{},onChoose:async()=>{if(++calls===1)throw new Error('input_context_limit');await new Promise(resolve=>ack=resolve);return true;}}));
  const field=screen.getByRole('textbox',{name:'직접 답변'});assert.equal(field.maxLength,10000);
  fireEvent.change(field,{target:{value:'보존할 입력'}});fireEvent.click(screen.getByRole('button',{name:'답변 보내기'}));
  await screen.findByText(/핵심 내용만 남겨/);assert.equal(field.value,'보존할 입력');assert.equal(field.disabled,false);
  fireEvent.change(field,{target:{value:'수정한 내용'}});fireEvent.click(screen.getByRole('button',{name:'답변 보내기'}));
  await waitFor(()=>assert.equal(field.disabled,true));assert.equal(field.value,'수정한 내용');
  await act(async()=>ack());assert.equal(field.disabled,false);
});
test('mapping approval displays actual zero and false values',()=>{
  render(h(OfficeTransaction,{approval:{payload:{kind:'template_mapping',title:'항목 연결',summary:'확인하세요',target:'A1:B1',verification:'실제 값',fields:[{id:'a',label:'수량',address:'A1',valueType:'number',currentValue:0},{id:'b',label:'확정',address:'B1',valueType:'boolean',currentValue:false}]}},onDecision:()=>{},onOpen:()=>{}}));
  assert.ok(screen.getByText('현재 값: 0'));assert.ok(screen.getByText('현재 값: false'));assert.equal(screen.queryByText('현재 값: 비어 있음'),null);
});
test('approval highlights the exact target before disclosure and preserves concise inline emphasis',()=>{
  const view=render(h(OfficeTransaction,{approval:{payload:{kind:'save',title:'저장할까요?',summary:'수식 **12개**를 확인했습니다.',target:'수능 성적표.xlsx',verification:'계산 결과 일치'}},onDecision(){}}));
  assert.equal(screen.getByText('수능 성적표.xlsx').closest('details'),null);
  assert.equal(view.container.querySelector('.office-decision-summary strong').textContent,'12개');
  assert.ok(screen.getByRole('button',{name:'확인 후 저장'}),'consequential actions retain an explicit label');
});
test('result location is optional detail and preservation differences remain explicit without color',()=>{
  render(h(OfficeDocumentResult,{title:'성적표',detail:'저장됨',path:'C:\\보고서\\성적표.xlsx',onOpen(){}}));
  const toggle=screen.getByRole('button',{name:'저장 위치'}),location=document.getElementById(toggle.getAttribute('aria-controls'));
  assert.equal(location.hidden,true);fireEvent.click(toggle);assert.equal(location.hidden,false);assert.equal(toggle.getAttribute('aria-expanded'),'true');
  fireEvent.click(toggle);assert.equal(location.hidden,true);
  render(h(TemplatePreservation,{report:{differenceCount:2,checks:[{id:'f',label:'수식',status:'unverified'}],differences:[]}}));
  assert.ok(screen.getByText('차이 2건'));
  assert.ok(screen.getByText(/그림, 차트, 인쇄 모양, NASCA 암호화/));
  assert.equal(screen.getByText('별도 확인이 필요합니다.').tagName,'STRONG');
  assert.equal(screen.getByText('별도 확인이 필요합니다.').closest('details'),null);
});
test('completed traces fold automatically while explicitly opened records stay open',()=>{
  const view=render(h(TaskActivity,{run:{...run,phase:'executing'},latest:true}));
  assert.equal(view.container.querySelector('.agent-trace').open,true);
  view.rerender(h(TaskActivity,{run:{...run,state:'done'},latest:true}));
  const trace=view.container.querySelector('.agent-trace');assert.equal(trace.open,false);
  fireEvent.click(trace.querySelector('summary'));
  fireEvent(trace,new dom.window.Event('toggle'));assert.equal(trace.open,true);
  view.rerender(h(TaskActivity,{run:{...run,state:'done',metrics:{elapsedMs:2000}},latest:true}));
  assert.equal(trace.open,true);
});
test('shared browser approval keeps preview separate from a locked explicit decision',async()=>{
  let calls=0,finish;
  render(h(ActionApproval,{question:{text:'내용을 반영할까요?',hasEditableDraft:false,summary:'검토한 내용',preview:[{label:'제목',value:'성적표'}],action:'확인 후 반영'},canApprove:true,onApprove:async()=>{calls++;await new Promise(resolve=>finish=resolve);},onReject:async()=>{}}));
  fireEvent.click(screen.getByText('내용 확인'));assert.equal(calls,0);
  const apply=screen.getByRole('button',{name:'확인 후 반영'});
  fireEvent.click(apply);fireEvent.click(apply);assert.equal(apply.disabled,true);
  // The shared approval confirms any required permission before calling the handler.
  await waitFor(()=>assert.equal(calls,1));
  await act(async()=>finish());assert.equal(calls,1);assert.equal(apply.disabled,false);
});
test('recovery actions lead to inspection without repeating a mutation',()=>{
  const actions=[];const view=render(h(TaskRecovery,{code:'write_uncertain',run:{writes:1},onAction:a=>actions.push(a)}));
  fireEvent.click(screen.getByRole('button',{name:'변경 기록 확인'}));assert.deepEqual(actions,['history']);assert.equal(screen.queryByRole('button',{name:/재시도/}),null);
  view.rerender(h(TaskRecovery,{code:'tls_untrusted',onAction:a=>actions.push(a)}));fireEvent.click(screen.getByRole('button',{name:'연결과 모델 확인'}));assert.deepEqual(actions,['history','connection']);
});

test('axe source DOM checks waiting, approval, recovery and failure surfaces',async()=>{
  for(const phase of ['awaiting_input','awaiting_approval','awaiting_recovery','failed']){
    const state=phase==='failed'?'failed':'running';
    const view=render(h('main',null,h(TaskDock,{run:{...run,phase,state},onLocate:()=>{}}),h(TaskActivity,{run:{...run,phase,state},latest:true}),
      phase==='awaiting_input'?h(OfficeQuestion,{question:{id:'axe',text:'인원은 몇 명인가요?',kind:'text',options:[]},onDraft:async()=>{},onChoose:async()=>true}):
      phase==='failed'?h(TaskRecovery,{code:'write_uncertain',run:{writes:1},onAction:()=>{}}):
      h(OfficeTransaction,{approval:{payload:{kind:phase==='awaiting_recovery'?'recovery':'save',title:'변경 내용을 확인하세요',summary:'확인된 초안',target:'현재 문서',verification:'계산 확인'}},onDecision:()=>{},onOpen:()=>{}})));
    const result=await axe.run(view.container,{rules:{'color-contrast':{enabled:false}}});
    assert.deepEqual(result.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],phase);
    view.unmount();
  }
});

// This exercises the real App and WebView RPC bridge against a scripted host.
// It is not a Windows WebView2/Excel integration test.
test('App preserves the answer until acknowledged and exposes the pending question from the composer',{timeout:5000},async()=>{
  globalThis.__APP_VERSION__='source-test';
  dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  dom.window.HTMLElement.prototype.scrollIntoView=function(){};
  let receive,attempts=0,releaseAck,accepted=false,refreshes=0,selections=0,templates=0,starts=0,failRead=false;
  const selected=()=>({scopeId:`selection-${selections}`,documentId:'book',worksheet:'성적표',address:selections===1?'B4':'C4',values:[[85]],displayTexts:[['85점']],formulas:[['']],formats:{},properties:{}});
  let intersectionChanged,observedInteraction;
  globalThis.IntersectionObserver=class {constructor(callback){this.callback=callback;}observe(target){if(target.getAttribute('aria-label')==='답변할 질문'){intersectionChanged=this.callback;observedInteraction=target;}}disconnect(){}};
  const session={connected:true,provider:'aipro',model:'fixture-qwen',models:[{id:'fixture-qwen',label:'Scripted model'}],providers:[{id:'aipro',connected:true},{id:'chatgpt',connected:false},{id:'fabrix',connected:false},{id:'aipro-cli',connected:false},{id:'compatible',connected:false}]};
  const snapshot={...run,id:'ui-run',kind:'document',action:{name:'request_input',callId:'pending-question',payload:{text:'인원은 몇 명인가요?',options:[],kind:'text',inputLimit:10000}},metrics:{}};
  globalThis.chrome={webview:{addEventListener:(_type,fn)=>{receive=fn;},postMessage:async({id,method,payload})=>{
    try{
      let result;
      if(method==='session')result=session;
      else if(method==='selection'){selections++;result=selected();}
      else if(method==='read'){assert.equal(payload.scopeId,selected().scopeId);if(failRead){failRead=false;throw new Error('office_timeout');}result=selected();}
      else if(method==='template_open'){templates++;result={cancelled:true};}
      else if(method==='refreshModels'){if(++refreshes===1)throw new Error('request_failed');result=session;}
      else if(method==='history')result=[];
      else if(method==='runStart'||method==='runStatus'){if(method==='runStart'){starts++;assert.equal(payload.mode,'auto');assert.equal(payload.scope.scopeId,selected().scopeId);}result=accepted?{...snapshot,state:'failed',error:'goal_incomplete',action:null}:snapshot;}
      else if(method==='toolResult'){
        assert.equal(payload.callId,'pending-question');
        if(++attempts===1)throw new Error('input_context_limit');
        await new Promise(resolve=>releaseAck=resolve);accepted=true;result={accepted:true};
      }else if(method==='runCancel')result={...snapshot,state:'cancelled',action:null};
      else throw new Error('unexpected_test_method');
      receive({data:{id,ok:true,result}});
    }catch(cause){receive({data:{id,ok:false,error:cause.message}});}
  }}};
  const {default:App}=await import('../src/App.jsx');
  render(h(App));
  const request=await screen.findByRole('textbox',{name:'Excel 작업 요청'});
  assert.ok(!screen.queryByRole('button',{name:/할 일 선택/}));
  assert.ok(!screen.queryByText('새 Excel 문서'));
  assert.ok(!screen.queryByRole('button',{name:'등록 양식 사본 열기'}));
  assert.ok(!screen.queryByRole('button',{name:'컨텍스트 사용량'}));
  assert.deepEqual([...request.closest('form').querySelectorAll('button')].map(button=>button.getAttribute('aria-label')),['Excel 양식 등록과 관리','모델 변경','전송']);
  assert.equal(selections,0,'opening chat does not take a stale selection snapshot');
  fireEvent.change(request,{target:{value:'점수 형식을 맞춰줘'}});
  fireEvent.click(screen.getByRole('button',{name:'더 보기'}));
  fireEvent.click(screen.getByRole('button',{name:'선택한 셀 확인'}));
  await screen.findByText('성적표!B4');assert.equal(selections,1);
  fireEvent.click(screen.getByRole('button',{name:'선택한 셀 다시 읽기'}));
  await screen.findByText('성적표!C4');assert.equal(selections,2);
  failRead=true;fireEvent.click(screen.getByRole('button',{name:'선택한 셀 다시 읽기'}));
  await screen.findByText('Excel 응답을 확인하지 못했습니다. 변경 기록과 실제 셀을 확인해 주세요.');
  assert.ok(!screen.queryByRole('button',{name:'이 셀에 요청하기'}),'a failed read cannot reuse stale cell details');
  fireEvent.click(screen.getByRole('button',{name:'선택한 셀 다시 읽기'}));
  fireEvent.click(await screen.findByRole('button',{name:'이 셀에 요청하기'}));
  await waitFor(()=>assert.equal(request.value,'성적표!C4 셀의 점수 형식을 맞춰줘'));
  assert.equal(starts,0,'inspecting a cell only prepares a draft');
  fireEvent.click(screen.getByRole('button',{name:'더 보기'}));
  fireEvent.click(screen.getByRole('button',{name:'등록 양식 사본 열기'}));
  await waitFor(()=>assert.equal(screen.getByRole('button',{name:'등록 양식 사본 열기'}).disabled,false));
  assert.equal(templates,1);assert.equal(starts,0);assert.equal(request.value,'성적표!C4 셀의 점수 형식을 맞춰줘');
  fireEvent.click(screen.getByRole('button',{name:'변경 기록'}));
  await screen.findByText('변경 기록이 없습니다');
  fireEvent.click(screen.getByRole('button',{name:'닫기'}));
  fireEvent.click(screen.getByRole('button',{name:'모델 변경'}));
  await screen.findByText('연결 요청에 실패했습니다. 설정을 확인해 주세요.');
  assert.ok(screen.getByRole('button',{name:'Scripted model'}));
  assert.deepEqual(screen.getAllByRole('tab').map(tab=>tab.textContent),['AI Pro','ChatGPT','FabriX']);
  assert.equal(screen.queryByRole('button',{name:'직접 연결 설정'}),null);
  assert.equal(refreshes,1);
  assert.ok(screen.getByRole('button',{name:'모델 목록 새로고침'}).closest('.cx-panel-footer'));
  assert.ok(screen.getByRole('button',{name:'AI Pro 로그아웃'}).closest('.cx-panel-footer'));
  assert.equal(document.querySelector('.provider-toolbar .provider-account-actions'),null);
  fireEvent.click(screen.getByRole('button',{name:'모델 목록 새로고침'}));
  await waitFor(()=>assert.ok(!screen.queryByText('연결 요청에 실패했습니다. 설정을 확인해 주세요.'), 'catalog error clears'));
  assert.equal(refreshes,2);fireEvent.click(screen.getByRole('button',{name:'닫기'}));
  fireEvent.click(screen.getByRole('button',{name:'대화 이력'}));
  fireEvent.click(screen.getByRole('button',{name:'새 대화'}));
  await waitFor(()=>assert.ok(document.activeElement===request, 'composer regains focus'));
  fireEvent.change(request,{target:{value:'인원별 성적표를 작성해줘'}});fireEvent.submit(request.closest('form'));
  const answer=await screen.findByRole('textbox',{name:'직접 답변'});
  assert.equal(request.disabled,true);assert.equal(request.parentElement.hidden,true);assert.equal(document.querySelector('#conversation').hasAttribute('aria-busy'),false);
  assert.ok(document.activeElement!==answer);
  assert.ok(!screen.queryByRole('button',{name:'질문 보기'}));
  await waitFor(()=>assert.ok(intersectionChanged));
  await act(async()=>intersectionChanged([{target:observedInteraction,isIntersecting:false}]));
  fireEvent.click(screen.getByRole('button',{name:'질문 보기'}));assert.equal(document.activeElement.getAttribute('aria-label'),'답변할 질문');
  await act(async()=>intersectionChanged([{target:observedInteraction,isIntersecting:true}]));
  assert.ok(!screen.queryByRole('button',{name:'질문 보기'}));
  fireEvent.change(answer,{target:{value:'20명'}});fireEvent.click(screen.getByRole('button',{name:'답변 보내기'}));
  await screen.findByText(/핵심 내용만 남겨/);assert.equal(answer.value,'20명');assert.equal(answer.disabled,false);
  fireEvent.change(answer,{target:{value:'10명'}});fireEvent.click(screen.getByRole('button',{name:'답변 보내기'}));
  await waitFor(()=>assert.ok(releaseAck));assert.ok(screen.getByText('답변 전달 확인 중',{selector:'#activity-now-label'}));assert.equal(answer.value,'10명');assert.equal(answer.disabled,true);
  await act(async()=>releaseAck());
  await waitFor(()=>assert.equal(screen.queryByRole('textbox',{name:'직접 답변'}),null));
  assert.ok(screen.getByText('10명'));assert.equal(attempts,2);
  assert.equal(screen.getByText('확인한 내용 1개').closest('details').open,false);
  fireEvent.click(screen.getByText('확인한 내용 1개'));assert.equal(screen.getByText('10명').closest('details').open,true);
  await waitFor(()=>assert.equal(request.disabled,false));assert.equal(request.parentElement.hidden,false);
  delete globalThis.IntersectionObserver;
});

test('terminal and recovery traces expose evidence without stale spinners or successful cancellation icons',()=>{
  const source={...run,phase:'executing',plan:{steps:[steps[0],{...steps[1],state:'running'}]}};
  const view=render(h(TaskActivity,{run:source,latest:true}));
  assert.ok(view.container.querySelector('.status-spinner'));
  for(const state of ['failed','cancelled','done','unsupported']){
    view.rerender(h(TaskActivity,{run:{...source,state},latest:true}));
    assert.equal(view.container.querySelectorAll('.status-spinner').length,0,state);
    assert.ok(view.container.textContent.includes('결과 미확인'),state);
    assert.equal(view.container.querySelectorAll('.activity-duration').length,0,state);
    if(state==='failed')assert.equal(view.container.querySelector('.agent-trace').open,true);
    if(state==='cancelled')assert.equal(view.container.querySelector('.agent-trace').dataset.state,'stopped');
  }
  view.rerender(h(TaskActivity,{run:{...source,recovery:{state:'paused'}},latest:true}));
  assert.equal(view.container.querySelector('.agent-trace').open,true);
  assert.equal(view.container.querySelector('.agent-trace').dataset.state,'attention');
  assert.equal(view.container.querySelectorAll('.status-spinner').length,0);
});

test('Python approval discloses exact code and local permissions with an explicit execution action',()=>{
  const decisions=[];const code='def transform(input): return 42';
  const view=render(h(OfficeTransaction,{approval:{payload:{kind:'python_execute',title:'이 Python 코드를 실행할까요?',summary:'로컬 사용자 권한으로 실행됩니다.',target:'현재 스킬',verification:'Office 반영은 별도 확인합니다.',code,codeSha256:'codehash',inputSha256:'inputhash',packages:['jinja2==3.1.6']}},onDecision:value=>decisions.push(value)}));
  assert.ok(screen.getByRole('region',{name:'Python 실행 확인'}));
  const disclosure=screen.getByText('실행할 Python 코드').closest('details');fireEvent.click(disclosure.querySelector('summary'));assert.ok(screen.getByText(code));
  assert.ok(view.container.textContent.includes('inputhash'));assert.equal(screen.queryByRole('button',{name:'확인 후 적용'}),null);
  fireEvent.click(screen.getByRole('button',{name:'코드 실행 허용'}));assert.deepEqual(decisions,[true]);
});

test('Office viewport preview fences old captures and does not turn UIA review into visual verification',async()=>{
  const {OfficeViewPreview}=await import('../src/OfficeViewPreview.jsx');let finish;
  const base={id:'first',host:'excel',target:'A1',current:true,imageStatus:'captured',imageSha256:'hash',review:{imageViewed:false,status:'complete'}};
  const v=render(h(OfficeViewPreview,{view:base,call:()=>new Promise(r=>{finish=r;})}));
  fireEvent.click(screen.getByText('작업 위치와 화면'));
  assert.ok(screen.getByText(/UI 요소 검토/));
  fireEvent.click(screen.getByRole('button',{name:'화면 보기'}));
  v.rerender(h(OfficeViewPreview,{view:{...base,id:'second',target:'B1',imageStatus:'unavailable'},call:async()=>({})}));
  await act(async()=>finish({id:'first',sha256:'hash',data:'iVBORw0KGgoAAA='}));
  assert.equal(screen.queryByRole('img'),null);assert.ok(screen.getByText(/B1 \/ 화면 이미지 미확인/));assert.equal(screen.queryByRole('button',{name:'화면 보기'}),null);
});

test('Office mouse approval identifies the target and provides a distinct action',()=>{
  const decisions=[];
  render(h(OfficeTransaction,{approval:{payload:{kind:'office_input',host:'word',title:'Office 화면을 조작할까요?',summary:'레이아웃: 클릭',target:'레이아웃',verification:'실행 전 대상과 창 확인'}},onDecision:value=>decisions.push(value)}));
  assert.ok(screen.getByText('레이아웃: 클릭'));assert.equal(screen.queryByRole('button',{name:'확인 후 적용'}),null);
  fireEvent.click(screen.getByRole('button',{name:'확인 후 조작'}));assert.deepEqual(decisions,[true]);
});

test('preservation checks retain meaning without color and do not render empty separators',()=>{
  const view=render(h(TemplatePreservation,{report:{differenceCount:1,checks:[{id:'a',label:'수식',status:'preserved'},{id:'b',label:'병합',status:'changed',note:'B2:C2에서 병합 차이 확인'},{id:'c',label:'인쇄',status:'unverified',note:'Office에서 미리보기 필요'}],differences:[]}}));
  const states=[...view.container.querySelectorAll('.office-check-list > li')];
  assert.deepEqual(states.map(el=>el.dataset.state),['met','changed','unverified']);
  for(const [index,label] of ['일치','차이 있음','미확인'].entries()){assert.ok(states[index].querySelector('svg'));assert.ok(states[index].textContent.includes(label));}
  assert.ok(screen.getByText('Office에서 미리보기 필요'));assert.equal(screen.queryByText('/'),null);
});

test('approval and recovery cancellation have visible action names instead of ambiguous close icons',()=>{
  const view=render(h(OfficeTransaction,{approval:{payload:{kind:'save',title:'저장 확인'}},onDecision(){}}));
  assert.equal(screen.getByRole('button',{name:'취소'}).textContent,'취소');
  view.rerender(h(OfficeTransaction,{approval:{payload:{kind:'recovery',title:'진행 확인'}},onDecision(){}}));
  assert.equal(screen.getByRole('button',{name:'작업 중지'}).textContent,'작업 중지');
});

test('connection form explains required administrator-provided fields with persistent Korean labels',async()=>{
  const {ConnectionDialog}=await import('../src/OfficeDialogs.jsx');
  render(h(ConnectionDialog,{provider:'fabrix',onClose(){},onConnected(){}}));
  assert.ok(screen.getByText(/관리자에게 받은 연결 정보/));
  for(const name of ['서버 주소','클라이언트 키','API 토큰']){const field=screen.getByLabelText(name);assert.equal(field.required,true);assert.ok(document.querySelector(`label[for="${field.id}"]`));}
  assert.equal(screen.getByLabelText('서버 주소').type,'url');assert.equal(screen.getByLabelText('API 토큰').type,'password');
});
