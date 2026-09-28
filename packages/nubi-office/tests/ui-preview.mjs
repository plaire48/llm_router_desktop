// Static rendering of current source components for layout/accessibility review.
// No product bundle, worker, native host or installer is built or loaded.
import './ui-source-loader.mjs';
import {officeHost} from '../worker/office-hosts.mjs';
import {dialogSnapshot,closeFixtures} from './ui-dialog-fixtures.mjs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const {CxAppShell}=await import('@e2e/cx-design-system');
const {TaskActivity}=await import('../src/TaskActivity.jsx');
const {ContentDetails}=await import('../src/ContentDetails.jsx');
const {OfficeComposer}=await import('../src/OfficeComposer.jsx');
const {OfficeDocumentResult}=await import('../src/OfficeDocumentResult.jsx');
const {OfficeTools}=await import('../src/OfficeTools.jsx');
const {DeckDisclosure}=await import('../../../extensions/aipro-chat/src/DeckSurfaces.jsx');
const {Welcome}=await import('../../../extensions/aipro-chat/src/Welcome.jsx');
const {OfficeQuestion}=await import('../src/OfficeQuestion.jsx');
const {OfficeTransaction}=await import('../src/OfficeTransaction.jsx');
const {NubiLogo}=await import('../../../extensions/aipro-chat/src/AgentMark.jsx');
const {NubiHeaderActions,NubiLogin}=await import('../../../extensions/aipro-chat/src/NubiSurfaces.jsx');
const {ModelSelection}=await import('../../../extensions/aipro-chat/src/ChatControls.jsx');
const {ConnectionDialog,ChangeHistory,OfficeUsage,OfficeHelp,PROVIDER_NAMES}=await import('../src/OfficeDialogs.jsx');
const {ConversationHistory}=await import('../../../extensions/aipro-chat/src/ConversationHistory.jsx');
const {OfficeSkills}=await import('../src/OfficeSkills.jsx');
const {OfficeTemplates}=await import('../src/OfficeTemplates.jsx');
const {screen,fireEvent,waitFor}=await import('@testing-library/react');
const {SelectionDetails}=await import('../src/SelectionDetails.jsx');
const {AmbientScene}=await import('../../../extensions/aipro-chat/src/Atmosphere.jsx');
const require=createRequire(import.meta.url),h=React.createElement,noop=()=>{},nubi=new URL('../../../extensions/aipro-chat/',import.meta.url);
const css=await Promise.all([readFile(new URL('../node_modules/@e2e/cx-design-system/dist/styles.css',import.meta.url),'utf8'),...['design/agent-deck.css','src/app.css','src/surfaces.css','src/code.css','src/interaction-forms.css','src/approval.css','src/deck-surfaces.css'].map(path=>readFile(new URL(path,nubi),'utf8')),readFile(new URL('../src/office.css',import.meta.url),'utf8')]);
const run={id:'synthetic-preview',kind:'document',state:'running',phase:'awaiting_input',writes:1,plan:{steps:[{id:'plan',title:'요구사항과 문서 구성 정리',state:'done'},{id:'sheet',title:'수능 성적표 작성',state:'waiting'},{id:'verify',title:'문서 전체 검토와 보완',state:'pending'},{id:'save',title:'Excel 파일 저장과 전달',state:'pending'}]},activity:Array.from({length:3},(_,i)=>({id:String(i),kind:'tool',state:'done',title:['성적표에 필요한 항목을 정리했습니다.','영역별 점수와 등급 입력 칸을 구성했습니다.','합계 수식의 참조를 확인했습니다.'][i%3],startedAt:0,endedAt:1000})),metrics:{elapsedMs:24000}};
const question={id:'question',text:'성적표에 몇 명의 학생을 넣을까요?',kind:'choice',options:[{id:'one',label:'한 명씩 작성',description:'개인 성적표 양식으로 만들어요.'},{id:'many',label:'여러 명을 한 표로',description:'학생별 성적을 비교할 수 있어요.'}],draft:'',inputLimit:10000};
const modelFixture=JSON.parse(await readFile(new URL('tests/fixtures/aipro-models.json',nubi),'utf8'));
const modelData={activeProvider:'aipro',settings:{modelId:'QWEN3.8-27B-FP8-256K'},catalog:{models:modelFixture.modelList.map(model=>({name:model.name,displayName:model.display_name||model.name,contextLength:model.context_length,maxInputTokens:model.max_input_tokens}))},connections:{aipro:{present:true}},report:{}};
const officeIntro={title:'엑셀을 누비는 AI Agent, 누비',description:h(React.Fragment,null,'작은 뱁새가 엑셀을 누비며',h('br'),'문서 작성부터 수식과 서식까지 대신합니다.')};
// Complete saved API fixture; this preview is not a live account catalog.
function shell(children){return h(CxAppShell,{brand:h(NubiLogo),actions:h(NubiHeaderActions,{history:{},usage:{},settings:{label:'더 보기',title:'더 보기'}})},children);}
function composer(state,approval,draft=''){return h(OfficeComposer,{data:modelData,hostName:state?.host==='word'?'Word':undefined,draft,busy:!!state,blocked:!!state,run:state,input:state?.phase==='awaiting_input'?{}:null,approval,onLocate:noop,onSend:noop,onStop:noop,onDraft:noop,onModels:noop});}
const targetQuestion={id:'target-question',text:'새 성적표를 만들까요, 현재 양식을 채울까요?',kind:'choice',options:[{id:'new',label:'새 문서로 만들기'},{id:'current',label:'현재 양식 채우기'}],inputLimit:10000};
function markup(scenario){
  if(scenario==='login')return renderToStaticMarkup(shell(h(React.Fragment,null,h(AmbientScene),h(NubiLogin,{mood:'still',intro:officeIntro,onLogin:noop}))));
  if(['empty','draft'].includes(scenario))return renderToStaticMarkup(shell(h(React.Fragment,null,h(AmbientScene),h('section',{className:'chat-page is-empty'},h('div',{className:'conversation-wrap'},h('div',{className:'conversation'},h('div',{className:'conversation-content'},h(Welcome,{mood:'still',intro:officeIntro})))),composer(null,null,scenario==='draft'?'수능 성적표를 만들어줘. 점수와 등급을 입력할 수 있게 해줘.':'')))));
  if(scenario==='result')return renderToStaticMarkup(shell(h('section',{className:'chat-page'},h('div',{className:'conversation-wrap'},h('div',{id:'conversation',className:'conversation'},h('div',{className:'conversation-content'},h('article',{className:'message message-assistant assistant'},h(OfficeDocumentResult,{title:'수능 성적표',detail:'Excel 문서 / 저장됨',path:'예시 / 수능 성적표.xlsx',onOpen:noop}),h('p',null,'요청한 항목과 수식을 반영했습니다.'))))),composer(null))));
  const recovery=scenario==='recovery',approval=scenario==='approval'?{payload:{kind:'save',title:'성적표를 저장할까요?',summary:'입력 항목과 합계 수식, 셀 서식을 확인했습니다.',target:'수능 성적표.xlsx / 개인 성적표',verification:'입력값과 수식 계산 결과를 다시 읽어 확인했습니다.',documentId:'synthetic-preview'}}:recovery?{payload:{kind:'recovery',title:'진행 상태를 다시 확인할까요?',summary:'세 차례 연결을 확인했지만 응답을 받지 못했습니다.',target:'현재 작업과 전달 대기 중인 실행 결과',verification:'다시 시도해도 셀 변경, 저장 도구를 재실행하지 않습니다.'}}:null;
  const working=['working','workers','delegation'].includes(scenario);
  const state={...run,...(scenario==='delegation'?{host:'word',kind:'office',writes:0,plan:{steps:[{id:'observe',title:'보고서 원문 확인',state:'done'},{id:'delegate',title:'역할별 분석과 결과 통합',state:'running'},{id:'write',title:'요청 조건에 맞춰 보고서 작성',state:'pending'}]},delegationWorkers:{nodes:[{id:'evidence',taskId:'evidence',phase:'delegation',title:'수치 근거 검토',scope:'분기 매출과 합계 원문 대조',state:'done',summary:'원문 근거 3개 확인'},{id:'format',taskId:'format',phase:'delegation',title:'양식 보존 분석',scope:'열 너비와 병합 범위 확인',state:'running'},{id:'missing',taskId:'missing',phase:'delegation',title:'입력 항목 확인',scope:'보고서에 필요한 사용자 입력 정리',state:'waiting',missing:['작성할 분기와 대상 부서를 알려주세요.']},{id:'merge',taskId:'merge',phase:'delegation',title:'결과 통합',scope:'근거를 종합해 작성할 항목 정리',state:'blocked',dependsOn:['evidence','format','missing']}]}}:{}),...(scenario==='workers'?{reviewWorkers:{nodes:[{id:'partition:1',phase:'partition',title:'구간 1',scope:'분석 항목 1~30',state:'done',summary:'근거 2 / 충돌 0 / 미확인 0'},{id:'partition:2',phase:'partition',title:'구간 2',scope:'분석 항목 31~60',state:'running'},{id:'partition:3',phase:'partition',title:'구간 3',scope:'분석 항목 61~90',state:'running'},{id:'requirement:0',phase:'reduction',title:'요구사항 1',scope:'요청한 조건과 원문 근거 대조',state:'pending'}]}}:{}),...(scenario==='target'?{plan:undefined,writes:0,activity:[{id:'route-1',kind:'model',state:'done',title:'요청의 작업 대상을 확인했습니다.',startedAt:0,endedAt:1000}]}:{}),...(scenario==='delegation'?{activity:[{id:'read',kind:'tool',state:'done',title:'보고서 양식과 원문을 확인했습니다.',startedAt:0,endedAt:1000},{id:'delegate',kind:'tool',state:'running',title:'역할별 근거를 확인하는 중',startedAt:Date.now()}]}:working?{activity:run.activity.map((event,index)=>index===2?{...event,state:'running',title:'점수와 등급 열의 서식을 맞추는 중',endedAt:undefined,startedAt:Date.now()}:event)}:{}),phase:working?'executing':recovery?'awaiting_recovery':approval?'awaiting_approval':run.phase};
  return renderToStaticMarkup(shell(h('section',{className:'chat-page'},
    h('div',{className:'conversation-wrap'},h('div',{id:'conversation',className:'conversation'},h('div',{className:'conversation-content'},
      h('article',{className:'message message-user user'},h('div',{className:'message-content'},scenario==='delegation'?'현재 양식을 바탕으로 분기 보고서를 작성해줘. 원문 근거와 서식을 확인해줘.':scenario==='target'?'성적표를 준비해줘. 새 문서로 할지 지금 양식을 쓸지는 아직 못 정했어.':'수능 성적표 양식을 만들어줘. 점수와 등급을 입력할 수 있게 해줘.')),
      h('article',{className:'message message-assistant assistant'},h(TaskActivity,{run:state,latest:true,approval}),approval?h(OfficeTransaction,{approval,onDecision:noop,onOpen:noop}):!working&&h(OfficeQuestion,{question:scenario==='target'?targetQuestion:question,onDraft:async()=>{},onChoose:async()=>true}))))),composer(state,approval))));
}
const skillFixture={id:'00000000-0000-4000-8000-000000000099',host:'word',revision:1,name:'분기 보고서',instructions:'요약, 성과, 다음 계획 순서로 작성합니다.',questions:[{question:'주요 성과를 알려주세요.',choices:[],input_mode:'long_text'}]};
const skillCall=async method=>{assert.equal(method,'document_skill_list');return {host:'word',entries:[skillFixture],unreadable:0};};
const templateCall=async method=>{assert.equal(method,'template_catalog_list');return {host:'word',entries:[{id:'00000000-0000-4000-8000-000000000098',host:'word',name:'업무 보고서',summary:'분기 업무 보고 양식',revision:1,itemCount:12,inputCount:4,sourceFile:'업무 보고서.docx',available:true}],unreadable:0};};
const modalElements={
  skills:h(OfficeSkills,{host:'word',hostName:'Word',call:skillCall,onClose:noop,onUse:noop}),
  'skills-empty':h(OfficeSkills,{host:'word',hostName:'Word',call:async()=>({host:'word',entries:[],unreadable:0}),onClose:noop,onUse:noop}),
  'skills-paste-error':h(OfficeSkills,{host:'word',hostName:'Word',call:skillCall,onClose:noop,onUse:noop}),
  'skills-editor':h(OfficeSkills,{host:'word',hostName:'Word',call:skillCall,onClose:noop,onUse:noop}),
  'templates-input-error':h(OfficeTemplates,{host:'word',hostName:'Word',call:templateCall,onRegister:noop,onUse:noop,onClose:noop}),
  templates:h(OfficeTemplates,{host:'word',hostName:'Word',call:templateCall,onRegister:noop,onUse:noop,onSkills:noop,onClose:noop}),
  help:h(OfficeHelp,{host:'word',onClose:noop}),
  'word-fields':h(ContentDetails,{host:'word',scope:{name:'부서별 업무 신청서',nextOffset:null,items:[{id:'cc-42',kind:'field',title:'사업부',showingPlaceholder:true,text:'입력하세요',editable:true},{id:'cc-43',kind:'field',title:'요청 내용',text:'분기 보고서 작성',editable:true}]},onClose:noop,onRefresh:noop,onRequest:noop}),
  tools:h(OfficeTools,{version:'source-preview',onSelection:noop,onTemplate:noop,onHistory:noop,onHelp:noop,onClose:noop},h(DeckDisclosure,{title:'연결 진단',icon:'link'},h('p',null,'AI Pro 연결됨'))),
  usage:h(OfficeUsage,{usage:[{prompt_tokens:4000,completion_tokens:500}],latest:{prompt_tokens:4000,completion_tokens:500},model:'Qwen 3.8 27B',onClose:noop}),
  'cells-error':h(SelectionDetails,{error:'Excel 응답을 확인하지 못했습니다. 선택한 셀을 다시 읽어주세요.',onRefresh:noop,onClose:noop}),
  models:h(ModelSelection,{data:modelData,providerLabels:PROVIDER_NAMES,onRefresh:async()=>true,onSelect:async()=>true,onClose:noop}),
  'changes-unrecoverable':h(ChangeHistory,{items:[{id:'unrecoverable',worksheet:'성적표',address:'B4:C4',workbook:'성적표.xlsx',restored:false,partial:true,recoverable:false,previewTotal:12,preview:[{cell:'B4',field:'value',before:0,after:85}]}],onRestore:noop,onClose:noop}),
  'connection-input-error':h(ConnectionDialog,{provider:'fabrix',onClose:noop,onConnected:noop}),
  connection:h(ConnectionDialog,{provider:'fabrix',onClose:noop,onConnected:noop}),
  history:h(ConversationHistory,{conversations:[{id:'synthetic-chat',title:'수능 성적표 작성',current:true,provider:'aipro',updatedAt:Date.UTC(2026,8,23,3),messages:[]}],providerLabels:PROVIDER_NAMES,onAction:async()=>{},onClose:noop}),
  cells:h(SelectionDetails,{scope:{worksheet:'성적표',address:'B4',values:[[85]],displayTexts:[['85점']],formulas:[['']],formats:{numberFormat:[['0"점"']]},properties:{locked:[[false]],mergedAddress:[[null]]}},onRefresh:noop,onRequest:noop,onClose:noop}),
  changes:h(ChangeHistory,{items:[{id:'synthetic-change',worksheet:'성적표',address:'B4:C4',workbook:'성적표.xlsx',restored:false,preview:[{cell:'B4',field:'value',before:0,after:85},{cell:'C4',field:'numberFormat',before:'General',after:'0.0'}]}],onRestore:noop,onClose:noop})
};
for(const host of ['word','powerpoint'])modalElements[host+'-tools']=h(OfficeTools,{version:'source-preview',selectionLabel:officeHost(host).selection,onSelection:noop,onHelp:noop,onClose:noop});
const snapshots=new Map();
const preservationApproval={payload:{kind:'template_preservation',title:'양식 차이를 확인해 주세요',summary:'입력한 값은 유지하고 양식 변경을 확인합니다.',target:'분기 보고서.xlsx / B2:F20',verification:'관찰한 셀 속성을 비교했습니다.',preservation:{target:'보고서 B2:F20',differenceCount:1,expectedValueChanges:12,checks:[{id:'formulas',label:'수식',status:'preserved'},{id:'merge',label:'병합 범위',status:'changed',note:'B2:C2의 병합이 달라졌습니다.'},{id:'print',label:'인쇄 모양',status:'unverified',note:'Office에서 인쇄 미리보기를 확인하세요.'}],differences:[{address:'B2:C2',field:'병합 범위',before:'B2:C2',after:'병합 없음'}]}}};
for(const state of ['preservation','preservation-details'])snapshots.set(state,renderToStaticMarkup(shell(h('section',{className:'chat-page'},h('div',{className:'conversation-wrap'},h('div',{className:'conversation'},h('div',{className:'conversation-content'},h(OfficeTransaction,{approval:preservationApproval,onDecision:noop})))),composer(null)))));

for(const host of ['word','powerpoint']){
  const profile=officeHost(host),intro={title:profile.subject+'를 누비는 AI Agent, 누비',description:h(React.Fragment,null,'작은 뱁새가 '+profile.subject+'를 누비며',h('br'),profile.description)};
  const input=h(OfficeComposer,{hostName:profile.name,data:modelData,onSend:noop,onDraft:noop,onModels:noop});
  snapshots.set(host+'-empty',renderToStaticMarkup(shell(h(React.Fragment,null,h(AmbientScene),h('section',{className:'chat-page is-empty'},h('div',{className:'conversation-wrap'},h('div',{className:'conversation'},h('div',{className:'conversation-content'},h(Welcome,{mood:'still',intro})))),input)))));
  const approval={payload:{host,kind:'edit',title:profile.name+'에 반영할 내용을 확인해 주세요',summary:host==='word'?'보고서의 제목 문단을 수정합니다.':'선택한 슬라이드의 제목을 수정합니다.',target:host==='word'?'보고서 제목':'슬라이드 1 제목',verification:'원본 확인 후 반영하고 결과를 다시 읽습니다. 화면과 인쇄 결과는 별도 확인이 필요합니다.'}};
  snapshots.set(host+'-approval',renderToStaticMarkup(shell(h('section',{className:'chat-page'},h('div',{className:'conversation-wrap'},h('div',{className:'conversation'},h('div',{className:'conversation-content'},h(OfficeTransaction,{approval,onDecision:noop})))),input))));
}
for(const [key,element] of Object.entries(modalElements))snapshots.set(key,await dialogSnapshot(shell(h(React.Fragment,null,h('section',{className:'chat-page'},h('div',{className:'conversation-wrap'}),composer(null)),element)),null,async()=>{
  if(key.startsWith('skills'))await waitFor(()=>assert.equal(screen.getByRole('button',{name:'ZIP 등록'}).disabled,false));
  if(key==='skills-editor'||key==='skills-paste-error'){fireEvent.click(screen.getByRole('button',{name:'분기 보고서 수정'}));await screen.findByRole('textbox',{name:'문서 형식과 작성 규칙 (필수)'});}
  if(key==='skills-paste-error'){const field=screen.getByLabelText('문서 형식과 작성 규칙 (필수)');fireEvent.paste(field,{clipboardData:{getData:()=> '가'.repeat(8001)}});}
  if(key==='templates-input-error'){fireEvent.click(await screen.findByRole('button',{name:'업무 보고서 이름 변경'}));fireEvent.change(screen.getByLabelText('양식 이름 (필수)'),{target:{value:' '}});fireEvent.click(screen.getByRole('button',{name:'이름 저장'}));}
  if(key==='connection-input-error'){fireEvent.change(screen.getByLabelText('서버 주소'),{target:{value:'서버주소'}});fireEvent.click(screen.getByRole('button',{name:'연결'}));}
  if(key==='templates')await screen.findByText('업무 보고서');
}));
for(const [key,feedback,modal] of [
  ['toast',{message:'모델을 적용했습니다.'},false],
  ['toast-modal',{message:'모델 목록을 불러왔습니다.'},true],
  ['toast-error',{message:'연결하지 못했습니다. 입력한 내용은 유지됩니다.',error:true},true]
])snapshots.set(key,await dialogSnapshot(shell(h(React.Fragment,null,h('section',{className:'chat-page'},h('div',{className:'conversation-wrap'}),composer(null)),modal?modalElements.models:null)),feedback));
// jsdom has no text layout; give this short two-line fixture enough height.
// Real auto-sizing and overflow are checked in question-autogrow.browser.mjs.
Object.defineProperty(window.HTMLTextAreaElement.prototype,'scrollHeight',{configurable:true,get(){return this.value?.includes('성과:')?100:44;}});
for(const state of ['question-long','question-error']){
  const q={...question,kind:'text',options:[],inputMode:'long_text',text:'이번 분기 성과와 다음 계획을 알려주세요.',draft:'성과: 처리 시간 20% 단축\n다음 계획: 적용 부서 확대'};
  snapshots.set(state,await dialogSnapshot(shell(h('section',{className:'chat-page'},h('div',{className:'conversation-wrap'},h('div',{className:'conversation'},h('div',{className:'conversation-content'},h(OfficeQuestion,{question:q,onDraft:async()=>{},onChoose:async()=>{throw new Error('input_context_limit');}})))),composer(run))),null,async()=>{
    if(state==='question-error'){fireEvent.click(screen.getByRole('button',{name:'답변 보내기'}));await screen.findByRole('alert');}
  }));
}
closeFixtures();
const server=createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://localhost').pathname;
    if(path==='/style.css'){res.setHeader('content-type','text/css');return res.end(css.join('\n'));}
    if(/^\/fonts\/[a-z0-9-]+\.woff2$/.test(path)){res.setHeader('content-type','font/woff2');return res.end(await readFile(new URL('../node_modules/@e2e/cx-design-system/dist'+path,import.meta.url)));}
    if(/^\/icons\/[a-z0-9-]+\.(webp|svg)$/.test(path)){res.setHeader('content-type',path.endsWith('.svg')?'image/svg+xml':'image/webp');return res.end(await readFile(new URL('public'+path,nubi)));}
    if(path==='/'||['empty','draft','result','input','working','workers','delegation','login','approval','recovery','target',...snapshots.keys()].includes(path.slice(1))){res.setHeader('content-type','text/html; charset=utf-8');return res.end(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>누비 Office 소스 화면 예시</title><link rel="stylesheet" href="/style.css"></head><body><div id="root">${snapshots.get(path.slice(1)) || markup(path==='/'?'input':path.slice(1))}</div></body></html>`);}
    res.writeHead(404).end();
  }catch{res.writeHead(500).end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
const directory=new URL('../verification/',import.meta.url);await mkdir(directory,{recursive:true});
const checks=[];
const htmlReference=JSON.parse(await readFile(new URL('../design/html-reference.json',import.meta.url),'utf8'));
let referenceCheck;
try{
  const page=await browser.newPage({reducedMotion:'reduce'});
  for(const state of ['login','empty','draft','result','working','workers','delegation','input','approval','recovery','target',...snapshots.keys()])for(const [width,height] of [[320,850],[380,850],[1100,850],...(['login','empty','draft'].includes(state)?[[320,600]]:[])]){
    await page.setViewportSize({width,height});await page.emulateMedia({reducedMotion:state.startsWith('toast')?'no-preference':'reduce'});await page.goto(`http://127.0.0.1:${server.address().port}/${state}`);await page.evaluate(()=>document.fonts.ready);
    if(state==='preservation-details')await page.locator('.office-preservation summary').click();
    if(!referenceCheck){
      const colors=await page.evaluate(names=>Object.fromEntries(names.map(name=>[name,getComputedStyle(document.documentElement).getPropertyValue(`--deck-${name}`).trim().toLowerCase()])),Object.keys(htmlReference.palette));
      assert.deepEqual(colors,Object.fromEntries(Object.entries(htmlReference.palette).map(([key,value])=>[key,value.toLowerCase()])),'shared colors match the supplied HTML');
      referenceCheck={source:htmlReference.source,sha256:htmlReference.sha256,paletteTokens:Object.keys(colors).length,matched:true};
    }
    let introduction;
    if(['login','empty','draft'].includes(state)||['word-empty','powerpoint-empty'].includes(state)){
      const intro=page.locator('.agent-intro');assert.ok(await intro.isVisible(),'introduction stays visible');
      assert.ok(await intro.locator('p').isVisible(),'brand description is not removed');
      if(state!=='login')assert.ok(await page.locator('.welcome-title').isVisible(),'separate invitation stays visible');
      const box=await intro.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width,'introduction fits the pane');
      introduction={title:await intro.locator('h1').innerText(),description:await intro.locator('p').innerText(),invitation:state==='login'?null:await page.locator('.welcome-title .visually-hidden').innerText()};
    }
    let entranceToast;
    if(state.startsWith('toast')){await page.evaluate(()=>{for(const element of document.querySelectorAll('.deck-dialog'))for(const animation of element.getAnimations()){animation.pause();animation.currentTime=50;}});
      entranceToast=await page.locator('.cx-toast-region').boundingBox();assert.ok(entranceToast&&entranceToast.y>=0&&entranceToast.y<=26,'toast stays at the top during modal entrance');
      await page.emulateMedia({reducedMotion:'reduce'});
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${state}/${width}: page overflow`);
    if(['working','input','approval','recovery'].includes(state)){
    const dock=page.getByRole('complementary',{name:'현재 작업'});assert.ok(await dock.isVisible());
    const box=await dock.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width&&box.y>=0&&box.y+box.height<=height,'dock within viewport');
    }
    await page.evaluate(()=>{const list=document.querySelector('#conversation');if(list)list.scrollTop=list.scrollHeight;});
    await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')});
    const audit=await page.evaluate(()=>window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}));
    const type=await page.evaluate(()=>{
      const metric=selector=>{const element=document.querySelector(selector);if(!element)return null;const s=getComputedStyle(element);return {font:s.fontFamily,size:s.fontSize,line:s.lineHeight,weight:s.fontWeight,color:s.color};};
      return {fieldError:metric('.cx-kit-field-error'),input:metric('.aipro-message-input'),title:metric('.cx-panel-heading h2'),question:metric('.interaction-heading p'),status:metric('.office-dock-status'),plan:metric('.task-plan-label'),model:metric('.model-option-text'),action:metric('.approval-actions .cx-kit-button'),tool:metric('.office-tool-action')};
    });
    if(Object.hasOwn(modalElements,state)||['toast-modal','toast-error'].includes(state))assert.ok(type.title,`${state}: dialog title must be rendered`);
    for(const [key,value] of Object.entries(type))if(value)assert.equal(value.size,key==='title'?'16px':'14px',`${state}/${width}: ${key} typography`);
    const iconControls=await page.locator('[data-icon-only="true"]').evaluateAll(elements=>elements.map(el=>({name:el.getAttribute('aria-label'),hint:el.getAttribute('title')})));
    for(const control of iconControls){assert.ok(control.name?.trim(),`${state}: icon needs an accessible action name`);assert.ok(control.hint?.trim(),`${state}: icon needs a discoverable hint`);}
    if(state==='changes-unrecoverable'){
      assert.ok(await page.getByText('자동 복원 불가',{exact:true}).isVisible());
      const footer=page.locator('.office-change-card > footer');
      assert.ok(await footer.evaluate(el=>el.scrollWidth<=el.clientWidth),'restore warning and button fit the card');
    }
    const identity=await page.evaluate(()=>{
      const body=getComputedStyle(document.body),dialog=document.querySelector('.deck-dialog');
      return {font:body.fontFamily,dialog:dialog?{background:getComputedStyle(dialog).backgroundColor,radius:getComputedStyle(dialog).borderRadius}:null,
        fields:[...document.querySelectorAll('.deck-dialog input:not([type="hidden"]), .deck-dialog textarea, .deck-dialog select')].map(el=>{const s=getComputedStyle(el);return {tag:el.tagName,font:s.fontFamily,size:s.fontSize,line:s.lineHeight,color:s.color};})};
    });
    assert.match(identity.font,/Noto Sans KR/,'bundled Korean font');
    if(identity.dialog){assert.equal(identity.dialog.background,'rgb(255, 255, 255)');assert.equal(identity.dialog.radius,'20px');}
    for(const field of identity.fields){assert.equal(field.font,identity.font,`${state}: shared field font`);assert.equal(field.size,'14px',`${state}: shared field size`);assert.equal(field.line,'22px',`${state}: shared field line height`);}
    const composerBox=await page.locator('.composer').count()?await page.locator('.composer').boundingBox():null;
    if(composerBox){assert.ok(composerBox.y>=0&&composerBox.y+composerBox.height<=height+1,'composer within viewport');assert.equal(await page.locator('.composer button').count(),3,'composer only exposes templates, model and send/stop');}
    let toast;
    if(state.startsWith('toast')){
      toast=await page.locator('.cx-toast-region').boundingBox();assert.ok(toast&&toast.y>=0&&toast.y<=26&&toast.x>=0&&toast.x+toast.width<=width,'toast stays at the viewport top');
      assert.ok(toast.y+toast.height<425,'toast is visually above the main content, not at the composer bottom');
      if(state!=='toast')assert.ok(await page.locator('.cx-toast-region').evaluate(el=>!!el.closest('[role="dialog"]')),'modal toast stays in the accessible dialog portal');
    }
    if(state==='models')assert.equal(await page.locator('.model-option').count(),modelFixture.modelList.length);
    checks.push({state,width,height,type,identity,iconControls,...(introduction?{introduction}:{}),composer:composerBox,...(toast?{toast,entranceToast}:{}),overflow:false,violations:audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),incomplete:audit.incomplete.map(v=>v.id)});
    await page.screenshot({path:fileURLToPath(new URL(`usability-${state}-${width}${height===850?'':`-h${height}`}.png`,directory))});
  }
  await writeFile(new URL('usability-preview.json',directory),JSON.stringify({kind:'static-source-components-in-chromium',generatedAt:new Date().toISOString(),htmlReference:referenceCheck,checks,notVerified:['Interactive browser runtime','Windows WebView2','Excel 2016 COM','Word 2016 COM','PowerPoint 2016 COM','Live Qwen','NASCA']},null,2)+'\n');
  console.log(JSON.stringify(checks,null,2));assert.ok(checks.every(c=>c.violations.length===0),'axe violations require review');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
