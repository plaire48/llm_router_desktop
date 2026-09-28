import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {createProviders} from '../worker/providers.mjs';
import {createWorker} from '../worker/main.mjs';
import {contract, valueCheck, verdict} from './harness-fixtures.mjs';
import {fetchModelCatalog} from '../../office-legacy-aipro/server/auth.mjs';

const dotnet=process.env.NUBI_DOTNET||'dotnet';
const recording=process.env.NUBI_RECORD_PROGRESS==='1';
const recoveryScenario=process.env.NUBI_RECOVERY_DEMO==='1';
const modelScenario=process.env.NUBI_MODEL_DEMO==='1';
const modelFixture=modelScenario?JSON.parse(await readFile(new URL('../../../extensions/aipro-chat/tests/fixtures/aipro-models.json',import.meta.url),'utf8')):null;
const fixtureToken='eyJhbGciOiJSUzI1NiJ9.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+300})).toString('base64url')+'.signature';
let modelListRequests=0, catalogMode='reported-five';
const reportedIds=new Set(['glm-5.2','QWEN3-CODER-480B-A35B-INSTRUCT-FP8-128K_rag','QWEN3-CODER-128K_general','qwen3.8-27b','gpt-oss-120b']);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const host=spawn(dotnet,['native/Nubi.Office.Tests/bin/Release/net8.0/Nubi.Office.Tests.dll','--rpc'],{stdio:['pipe','pipe','inherit']});
const pending=new Map();let serial=0;
createInterface({input:host.stdout}).on('line',line=>{const msg=JSON.parse(line),p=pending.get(msg.id);pending.delete(msg.id);msg.ok?p.resolve(msg.result):p.reject(new Error(msg.error));});
const native=(method,payload)=>new Promise((resolve,reject)=>{const id=String(++serial);pending.set(id,{resolve,reject});host.stdin.write(JSON.stringify({id,method,payload})+'\n');});
let clarificationHistorySeen=false,planShownBeforeWrite=false,failStatus=false,recoveryEvidenceSeen=false,lastRunStatus,onRecovery=async()=>{};
const fetchImpl=async(url,options)=>{
  if(modelScenario&&url==='https://aipro.sdsdev.co.kr/api/models'){assert.equal(options.headers.Authorization,`Bearer ${fixtureToken}`);modelListRequests++;if(catalogMode==='failure')throw new Error('network_failed');return Response.json(catalogMode==='reported-five'?{modelList:modelFixture.modelList.filter(item=>reportedIds.has(item.name))}:modelFixture);}
  // Test-only response latency lets the live UI be observed; production has no staged progress.
  await pause(recording?1000:120);
  const {messages}=JSON.parse(options.body),done=messages.filter(m=>m.role==='tool').length;
  const system=messages[0].content;
  if(system.startsWith('NUBI_')) {
    const payload=JSON.parse(messages[1].content);
    if(system.startsWith('NUBI_RECOVERY_PLANNER')){
      assert.equal(payload.failure.code,'invalid_format');assert.equal(payload.observation.values[0][0],42);assert.equal(payload.observation.formats.bold[0][0],false);
      assert.equal(payload.plan.completed,2);assert.equal((await native('history',{})).length,1);recoveryEvidenceSeen=true;
      await onRecovery();
      return Response.json({choices:[{message:{content:JSON.stringify({decision:'revise',summary:'굵게 표시 입력의 형식이 잘못되어 적용되지 않았습니다.',nextAction:'완료한 값 변경은 유지하고, 굵게 표시 입력을 고쳐 다시 적용하겠습니다.',question:''})},finish_reason:'stop'}]});
    }
    let task=contract([valueCheck(42),{address:'A1',field:'bold',operator:'equals',expected:true}],{summary:'A1을 42로 바꾸고 굵게 표시합니다.',steps:[{id:'inspect',title:'선택 범위와 기존 수식 확인',kind:'inspect',checkIndexes:[]},{id:'value',title:'A1 값을 42로 변경',kind:'edit',checkIndexes:[0]},{id:'style',title:'A1을 굵게 표시',kind:'edit',checkIndexes:[1]},{id:'verify',title:'변경 결과와 원래 요청 재확인',kind:'verify',checkIndexes:[0,1]}]});
    if(payload.request.includes('세율')) task=contract([],{intent:'clarify',questions:['적용할 세율은 얼마인가요?']});
    if(payload.request==='10%') {task=contract([{address:'B1',field:'value',operator:'equals',expected:0.1}]); clarificationHistorySeen=payload.history.some(m=>m.role==='user'&&m.content.includes('세율'));}
    const content=system.startsWith('NUBI_TASK_PLANNER')?JSON.stringify(task):verdict(payload).content;
    return Response.json({choices:[{message:{content},finish_reason:'stop'}]});
  }
  const followup=messages.some(m=>m.role==='user'&&m.content==='10%');
  const name=done===0?'read_selection':done===1||!followup&&(done===2||recoveryScenario&&done===3)?'apply_changes':done===(followup?2:recoveryScenario?4:3)?'verify_selection':null;
  if(recoveryScenario&&done===3){const failure=JSON.parse(messages.filter(m=>m.role==='tool').at(-1).content);assert.equal(failure.recovery.state,'retrying');assert.equal(failure.error,'invalid_format');}
  const arguments_=name==='apply_changes'?{plan:JSON.stringify({operations:followup?[{type:'set_values',address:'B1',values:[[0.1]]}]:done===1?[{type:'set_values',address:'A1',values:[[42]]}]:[{type:'format_range',address:'A1',bold:recoveryScenario&&done===2?'yes':true}]})}:{};
  return Response.json({choices:[{message:name?{content:null,tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name,arguments:JSON.stringify(arguments_)}}]}:{content:'A1을 42로 바꾸고 굵게 표시했습니다. 셀을 다시 읽어 결과를 확인했습니다.'},finish_reason:name?'tool_calls':'stop'}]});
};
const provider=createProviders({fetchImpl,...(modelScenario?{startLogin:async()=>({result:fetchModelCatalog(fixtureToken,fetchImpl).then(catalog=>({token:fixtureToken,...catalog})),cancel(){}})}:{})});
const approvedCalls=new Set();
const worker=createWorker(provider);
if(modelScenario){await worker.dispatch('login',{provider:'aipro'});while(provider.status().pending)await pause(10);}
else if(recording)await worker.dispatch('connect',{provider:'aipro-cli',baseUrl:'https://example.test/v1',token:'synthetic-test-token',model:'UI 검증 모델'});
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname;const file=resolve('dist/web','.'+(path==='/'?'/taskpane.html':path));if(!file.startsWith(resolve('dist/web')+'/'))throw new Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));await mkdir('verification',{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});const errors=[];
const context=await browser.newContext({viewport:{width:380,height:850},...(recording?{recordVideo:{dir:'verification/recordings',size:{width:380,height:850}}}:{})});
const page=await context.newPage();
try {
  await (async()=>{
  page.on('pageerror',e=>errors.push(e.message));
  onRecovery=async()=>{
    await page.waitForFunction(()=>document.querySelector('#activity-feed .recovery.running'));
    assert.equal(await page.locator('.plan-step[data-step-id="style"]').getAttribute('data-state'),'recovering');
    await page.screenshot({path:'verification/recovery-diagnosing-380.png'});
  };
  await page.exposeBinding('__officeCall',async(_,{method,payload})=>{
    if(method==='runStatus'&&failStatus){failStatus=false;throw new Error('worker_disconnected');}
    if(method==='toolResult'&&payload.result?.displayed&&!planShownBeforeWrite){
      assert.equal(await page.locator('#task-panel').isVisible(),true);assert.equal((await native('history',{})).length,0);
      assert.equal(await page.locator('#plan-progress').textContent(),'0/4 완료');
      await page.screenshot({path:'verification/plan-before-380.png'});planShownBeforeWrite=true;
    }
    if(method==='apply'&&(await native('history',{})).length===1){
      assert.equal(await page.locator('#plan-progress').textContent(),'2/4 완료');
      assert.equal(await page.locator('.plan-step[data-step-id="style"]').getAttribute('data-state'),'running');
      assert.equal(await page.locator('#activity-feed .activity-row.running').count(),1);
      assert.ok(await page.locator('#task-panel .activity-row.done').count()>5);
      assert.equal(await page.locator('.message.assistant .message-content').isVisible(),false);
      assert.equal(await page.locator('#activity-now-label').textContent(),'진행 중');
      await page.screenshot({path:'verification/plan-running-380.png'});
      await page.screenshot({path:'verification/activity-running-380.png'});
      if(!recording){
        await page.locator('#conversation').evaluate(view=>{view.scrollTop=0;view.dispatchEvent(new Event('scroll'));});
        await page.locator('#follow-latest').waitFor({state:'visible'});
        await pause(300);assert.equal(await page.locator('#conversation').evaluate(view=>view.scrollTop),0);
        await page.locator('#follow-latest').click();
        assert.ok(await page.locator('#conversation').evaluate(view=>view.scrollHeight-view.scrollTop-view.clientHeight<3));
      }
    }
    if(recording&&['read','apply'].includes(method))await pause(700);
    const result=await (['selection','read','apply','restore','history','focus'].includes(method)?native(method,payload):worker.dispatch(method,payload));
    if(method==='runStatus'){lastRunStatus=result;if(result.action?.name==='request_approval'&&!approvedCalls.has(result.action.callId)){approvedCalls.add(result.action.callId);void page.getByRole('button',{name:'확인 후 적용',exact:true}).click().catch(()=>{});}}
    return result;
  });
  await page.addInitScript(()=>{const handlers=[];window.chrome={webview:{addEventListener:(type,fn)=>handlers.push(fn),postMessage:async req=>{let reply;try{reply={id:req.id,ok:true,result:await window.__officeCall(req)};}catch(e){reply={id:req.id,ok:false,error:e.message.replace(/^.*?:\s*/,'')};}handlers.forEach(fn=>fn({data:reply}));}}};});
  async function captureSurface(name) {
    for(const width of [320,380,1100]) {
      await page.setViewportSize({width,height:850});await page.evaluate(()=>document.fonts.ready);await pause(80);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),name+' horizontal overflow');
      const dialog=page.getByRole('dialog');
      if(await dialog.count()) {
        const metrics=await dialog.evaluate(el=>{const r=el.getBoundingClientRect();return {within:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,title:getComputedStyle(el.querySelector('h2')).fontSize,inputs:[...el.querySelectorAll('input,textarea')].map(input=>getComputedStyle(input).fontSize),unlabelled:[...el.querySelectorAll('button')].filter(button=>!(button.getAttribute('aria-label')||button.textContent||button.title).trim()).length};});
        assert.ok(metrics.within,name);assert.equal(metrics.title,'16px',name);assert.ok(metrics.inputs.every(size=>size==='14px'),name);assert.equal(metrics.unlabelled,0,name);
      }
      await page.screenshot({path:`verification/components-${name}-${width}.png`,animations:'disabled'});
    }
    await page.setViewportSize({width:380,height:850});
  }
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.locator('.aipro-login, .composer').waitFor();
  if(modelScenario){
    await page.getByRole('button',{name:'모델 변경',exact:true}).click();
    assert.equal(await page.locator('.model-option').count(),5);
    assert.match(await page.locator('.model-catalog-count').textContent(),/서버 수신 5개 · 표시 5개/);
    await page.getByRole('textbox',{name:'모델 검색',exact:true}).fill('aipro-fast-model');
    assert.equal(await page.locator('.model-option').count(),0);await page.screenshot({path:'verification/models-received-five-380.png'});
    catalogMode='all';await page.getByRole('button',{name:'모델 목록 새로고침',exact:true}).click();
    await page.getByRole('button',{name:'aipro-fast-model',exact:true}).waitFor();
    assert.match(await page.locator('.model-catalog-count').textContent(),/서버 수신 10개 · 표시 10개/);
    await page.screenshot({path:'verification/models-fast-found-380.png'});
    await page.getByRole('button',{name:'aipro-fast-model',exact:true}).click();assert.equal(provider.status().model,'aipro-fast-model');
    await page.getByRole('button',{name:'모델 변경',exact:true}).click();
    catalogMode='failure';await page.getByRole('button',{name:'모델 목록 새로고침',exact:true}).click();
    await page.getByText('목록을 새로 읽지 못했습니다. 이전 목록을 표시합니다.',{exact:true}).waitFor();
    assert.equal(await page.locator('.model-option').count(),10);assert.equal(provider.status().model,'aipro-fast-model');
    catalogMode='all';await page.getByRole('button',{name:'모델 목록 새로고침',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.model-option:disabled'));
    const displayed=await page.locator('.model-option').evaluateAll(options=>options.map(option=>({label:option.getAttribute('aria-label')})));
    assert.equal(modelListRequests,4);assert.deepEqual(displayed.map(model=>model.label),modelFixture.modelList.map(model=>model.display_name || model.name));
    assert.equal(provider.status().provider,'aipro');
    await page.getByRole('textbox',{name:'모델 검색',exact:true}).fill('glm');assert.equal(await page.locator('.model-option').count(),2);
    await page.getByRole('textbox',{name:'모델 검색',exact:true}).fill('');
    await page.getByRole('tab',{name:'AI Pro',exact:true}).focus();await page.keyboard.press('ArrowRight');
    await page.waitForFunction(()=>document.querySelector('[role=tab][aria-selected=true]')?.textContent==='ChatGPT');
    await page.locator('.provider-connect-button').waitFor({state:'visible'});
    await page.getByRole('tab',{name:'AI Pro',exact:true}).click();
    for(const width of [320,380]){await page.setViewportSize({width,height:850});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await pause(300);await page.screenshot({path:`verification/aipro-models-${width}.png`});}

    for(const item of modelFixture.modelList){await page.getByRole('button',{name:item.display_name || item.name,exact:true}).click();assert.equal(provider.status().model,item.name);await page.getByRole('button',{name:'모델 변경',exact:true}).click();}
    await page.getByRole('button',{name:'GLM-5.2-512K',exact:true}).click();await pause(300);
    await writeFile('verification/model-catalog-checks.json',JSON.stringify({checkedAt:new Date().toISOString(),source:'saved API response fixture',requestPath:'/api/models',provider:'aipro',received:modelFixture.modelList.length,displayed:displayed.length,models:modelFixture.modelList.map(model=>({id:model.name,label:model.display_name||model.name})),allSelectable:true,reportedFiveSourceCount:true,refreshFiveToTen:true,failedRefreshRetainsSelection:true,fastSearchAndSelection:true,classificationFilter:false,liveApiCalled:false},null,2));
  }
  await pause(1500);await page.screenshot({path:`verification/${provider.status().connected?'welcome':'login'}-380.png`});
  if(!recording&&!modelScenario){
  await page.getByRole('button',{name:'다른 연결',exact:true}).click();await captureSurface('connections');
  for(const name of ['FabriX','OpenAI 호환']) {await page.getByRole('dialog').getByRole('button',{name,exact:true}).click();await captureSurface(name==='FabriX'?'fabrix':'compatible');await page.keyboard.press('Escape');await page.getByRole('button',{name:'다른 연결',exact:true}).click();}
  await page.getByRole('button',{name:'AI Pro CLI',exact:true}).click();await captureSurface('cli');await page.locator('#credentials').waitFor({state:'visible'});
  await page.locator('#endpoint').fill('https://example.test/v1');await page.locator('#token').fill('synthetic-test-token');await page.locator('#model-id').fill('Test Model');await page.locator('#credentials').getByRole('button',{name:'연결',exact:true}).click();
  }
  await page.locator('#credentials').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'설정',exact:true}).click();await pause(350);await page.screenshot({path:'verification/settings-380.png'});await page.keyboard.press('Escape');assert.equal(await page.getByRole('button',{name:'설정',exact:true}).evaluate(button=>button===document.activeElement),true);
  await page.getByRole('button',{name:'작업 방식',exact:true}).click();
  if(!recording)await captureSurface('mode-document');
  await page.getByRole('tab',{name:'분석만',exact:true}).click();await page.keyboard.press('Escape');
  if(!recording){
    await page.getByRole('button',{name:'셀 값과 서식',exact:true}).click();await page.getByRole('dialog',{name:'셀 값과 서식',exact:true}).waitFor();
    await page.getByLabel('확인할 셀',{exact:true}).selectOption('3');assert.match(await page.getByRole('dialog').textContent(),/=SUM\(A1:B1\)/);
    await page.getByRole('dialog').getByText('글꼴과 정렬',{exact:true}).click();await captureSurface('cell-properties');
    await page.getByRole('dialog').getByText('양식 속성과 입력 제한',{exact:true}).click();await captureSurface('cell-rules');
    await page.getByRole('button',{name:'이 셀에 요청하기',exact:true}).click();assert.match(await page.locator('#request').inputValue(),/Sheet1!B2/);await page.locator('#request').fill('');
    await page.getByRole('button',{name:'사용량',exact:true}).click();await captureSurface('usage-empty');await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'설정',exact:true}).click();await captureSurface('settings');
    await page.getByRole('button',{name:/도움말/}).click();await captureSurface('help');
    await page.getByRole('dialog').locator('summary').first().click();await captureSurface('help-expanded');await page.keyboard.press('Escape');
    assert.ok(await page.getByRole('button',{name:/도움말/}).evaluate(button=>button===document.activeElement));
    await page.getByRole('button',{name:'변경 기록',exact:true}).click();await captureSurface('history-empty');await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'작업 방식',exact:true}).click();await captureSurface('mode-analyze');await page.getByRole('tab',{name:'셀 수정',exact:true}).click();await captureSurface('mode-edit');await page.keyboard.press('Escape');
  }
  await page.getByRole('button',{name:'컨텍스트 사용량',exact:true}).click();await page.getByRole('dialog').waitFor({state:'visible'});assert.match(await page.getByRole('dialog').textContent(),/사용량 미제공/);await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'작업 방식',exact:true}).click();await page.getByRole('tab',{name:'셀 수정',exact:true}).click();await page.keyboard.press('Escape');await page.locator('#request').fill('A1을 42로 바꾸고 굵게 해줘');await page.getByRole('button',{name:'전송',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('conversation')?.getAttribute('aria-busy')==='false');assert.match(await page.locator('.message.assistant').textContent(),/42/);
  assert.match(await page.locator('#task-result').textContent(),/셀 조건과 AI 검토/);
  assert.match(await page.locator('#trace-list').textContent(),/수정할 내용 검토/);
  assert.match(await page.locator('#trace-list').textContent(),/요청 전체 재검토/);
  assert.equal(await page.locator('#plan-progress').textContent(),'4/4 완료');
  assert.equal(await page.locator('#activity-feed .activity-row.running').count(),0);
  assert.equal(await page.locator('#activity-now-label').textContent(),'작업 완료');
  assert.equal(await page.locator('#activity-now.working').count(),0);
  if(recoveryScenario){
    assert.equal(recoveryEvidenceSeen,true);assert.equal(lastRunStatus.recoveries[0].state,'verified');
    assert.equal((await native('history',{})).length,2);assert.equal(lastRunStatus.writes,2);
    assert.match(await page.locator('#activity-feed').textContent(),/수정 후 다시 진행합니다/);
    await page.screenshot({path:'verification/recovery-complete-380.png'});
    await writeFile('verification/recovery-checks.json',JSON.stringify({checkedAt:new Date().toISOString(),scenario:'Native engine rejects invalid bold value; AI receives error and fresh cells, revises input; corrected write and independent review finish without repeating completed value edit.',nativeValidation:'real WorkbookEngine.Compile',providerResponses:'synthetic',excelCom:'simulated',writes:lastRunStatus.writes,plan:lastRunStatus.plan,recoveries:lastRunStatus.recoveries,activity:lastRunStatus.activity,realModelAccuracy:null,errors},null,2));
  }
  if(recording){await pause(2500);assert.deepEqual(errors,[]);return;}
  await page.getByRole('button',{name:'대화 이력',exact:true}).click();await page.getByRole('button',{name:'A1을 42로 바꾸고 굵게 해줘 열기',exact:true}).waitFor();await pause(300);await page.screenshot({path:'verification/conversations-380.png'});await page.keyboard.press('Escape');
  const records=await native('history',{});assert.equal(records.length,2);assert.equal(records[0].restored,false);
  for(const width of [320,380,600]){await page.setViewportSize({width,height:850});await page.screenshot({path:`verification/applied-${width}.png`});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.setViewportSize({width:380,height:850});await page.getByRole('button',{name:'설정',exact:true}).click();await page.getByRole('button',{name:'변경 기록',exact:true}).click();await page.getByRole('button',{name:'이 작업 되돌리기',exact:true}).first().waitFor();await page.screenshot({path:'verification/history-380.png'});await captureSurface('history');
  await page.getByRole('button',{name:'이 작업 되돌리기',exact:true}).first().click();await page.getByRole('button',{name:'복원 완료',exact:true}).waitFor();
  await page.getByRole('button',{name:'이 작업 되돌리기',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-restored="true"]').length===2);
  const state=await native('selection',{});assert.equal(state.values[0][0],1);assert.equal((await native('history',{}))[0].restored,true);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'새 대화',exact:true}).click();
  await page.locator('#request').fill('회사 세율을 B1에 입력해줘');await page.getByRole('button',{name:'전송',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('conversation')?.getAttribute('aria-busy')==='false');
  assert.match(await page.locator('.message.assistant').textContent(),/세율은 얼마/);
  assert.equal((await native('history',{})).length,2);
  await page.screenshot({path:'verification/clarification-380.png'});await captureSurface('question');
  await page.locator('#request').fill('별도로 보관할 초안');await page.getByRole('textbox',{name:'직접 답변',exact:true}).fill('10%');await page.getByRole('button',{name:'답변 보내기',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('conversation')?.getAttribute('aria-busy')==='false');
  assert.equal(await page.locator('#request').inputValue(),'별도로 보관할 초안');assert.equal(await page.locator('.question-card[data-answered=true]').count(),1);assert.equal(clarificationHistorySeen,true);assert.equal((await native('selection',{})).values[0][1],0.1);
  const beforeCancel=(await native('history',{})).length;
  await page.getByRole('button',{name:'새 대화',exact:true}).click();
  await page.locator('#request').fill('A1을 42로 바꾸고 굵게 해줘');await page.getByRole('button',{name:'전송',exact:true}).click();
  await page.locator('#plan-overview').waitFor({state:'visible'});await page.getByRole('button',{name:'중지',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('conversation')?.getAttribute('aria-busy')==='false');
  assert.match(await page.locator('.message.assistant').textContent(),/작업을 중지/);
  assert.equal(await page.locator('.plan-step[data-state="paused"]').count(),1);
  assert.equal((await native('history',{})).length,beforeCancel);
  assert.equal(await page.locator('#activity-feed .activity-row.running').count(),0);
  assert.equal(await page.locator('#activity-now-label').textContent(),'작업 중지');
  await page.screenshot({path:'verification/plan-paused-380.png'});
  await page.getByRole('button',{name:'새 대화',exact:true}).click();failStatus=true;
  await page.locator('#request').fill('A1을 42로 바꾸고 굵게 해줘');await page.getByRole('button',{name:'전송',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('conversation')?.getAttribute('aria-busy')==='false');
  assert.match(await page.locator('.message.assistant').textContent(),/모델 연결이 종료/);
  assert.equal(await page.locator('#activity-feed .activity-row.running').count(),0);
  assert.equal(await page.locator('#activity-now-label').textContent(),'확인이 필요합니다.');
  assert.equal((await native('history',{})).length,beforeCancel);
  assert.deepEqual(errors,[]);
  await writeFile('verification/local-checks.json',JSON.stringify({checkedAt:new Date().toISOString(),browserUi:true,realPiLoop:true,realWorkbookEngine:true,excelCom:'simulated',providers:'synthetic',widths:[320,380,600,1100],componentGallery:true,questionFormPreservesComposer:true,mutationAndRestore:true,clarificationAndResume:true,taskReviewVisible:true,planShownBeforeWrite,sequentialStepProgress:true,liveActivityBeforeFinalReply:true,scrollHistoryAndFollowLatest:true,activitySettlesOnCompletionAndStop:true,activitySettlesOnConnectionFailure:true,userStopVisible:true,windowsVstoInstalled:false,realProvidersVerified:false,errors},null,2));
  console.log('PASS: browser UI → shared provider/Pi → .NET WorkbookEngine → readback → restore (Excel COM and LLM responses simulated).');
  })();
} catch(error) { await page.screenshot({path:'verification/browser-failure.png'}).catch(()=>{}); console.error('Browser errors:',errors); throw error; } finally {
  worker.dispose();await context.close();
  if(recording){const path=`verification/${modelScenario?'models':recoveryScenario?'recovery':'activity'}-demo.webm`;await page.video().saveAs(path);await page.video().delete();console.log(`Saved actual UI recording with synthetic provider/COM: ${path}`);}
  await browser.close();server.close();host.stdin.end();host.kill();
}
