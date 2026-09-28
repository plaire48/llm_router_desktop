// Static source DOM preview only. No product bundle or installer build.
import '../tests/ui-source-loader.mjs';
import {JSDOM} from 'jsdom';
import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
const dom=new JSDOM('<!doctype html><html lang="ko"><body><div id="root"></div></body></html>',{url:'https://nubi.test',pretendToBeVisual:true});
for(const key of ['window','document','navigator','HTMLElement','Element','Node','MutationObserver','getComputedStyle','innerWidth','innerHeight'])Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]});
globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);globalThis.IS_REACT_ACT_ENVIRONMENT=true;globalThis.__APP_VERSION__='source-preview';
dom.window.matchMedia=()=>({matches:true,addEventListener(){},removeEventListener(){}});dom.window.HTMLElement.prototype.scrollIntoView=function(){};
let receive;
const entries=[{id:'f00dbabe-0000-4000-8000-000000000001',host:'word',name:'분기 업무 보고서',summary:'부서, 보고 기간, 주요 성과와 다음 분기 계획을 작성하는 양식입니다.',revision:1,itemCount:24,inputCount:6,sourceFile:'분기 업무 보고서.docx',available:true},{id:'f00dbabe-0000-4000-8000-000000000002',host:'word',name:'회의록',summary:'회의 제목, 참석자, 논의 내용과 후속 업무를 작성합니다.',revision:1,itemCount:15,inputCount:5,sourceFile:'회의록.docx',available:true}];
globalThis.chrome={webview:{addEventListener:(_event,fn)=>receive=fn,postMessage:({id,method})=>{
 const result=['session','refreshModels'].includes(method)?{host:'word',provider:'aipro',connected:true,model:'fixture-qwen',models:[{id:'fixture-qwen',label:'Qwen 3.8 27B (UI 예시)'}],providers:[{id:'aipro',connected:true}]}:method==='template_catalog_list'?{host:'word',entries,unreadable:0}:method==='history'?[]:undefined;
 if(result===undefined)throw new Error('Unexpected preview action');queueMicrotask(()=>receive({data:{id,ok:true,result}}));
}}};
const React=await import('react'),{render,screen,fireEvent,waitFor,cleanup}=await import('@testing-library/react'),{default:App}=await import('../src/App.jsx');
render(React.createElement(App),{container:document.querySelector('#root')});
await screen.findByRole('textbox',{name:'Word 작업 요청'});
const styles=['node_modules/@e2e/cx-design-system/dist/styles.css','../../extensions/aipro-chat/design/agent-deck.css','../../extensions/aipro-chat/src/app.css','../../extensions/aipro-chat/src/surfaces.css','../../extensions/aipro-chat/src/code.css','../../extensions/aipro-chat/src/interaction-forms.css','../../extensions/aipro-chat/src/approval.css','../../extensions/aipro-chat/src/deck-surfaces.css','src/office.css'];
const root=new URL('../',import.meta.url),links=styles.map(path=>`<link rel="stylesheet" href="${new URL(path,root)}">`).join('');
async function snapshot(name){
 const markup='<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>누비 양식 UI 소스 미리보기</title>'+links+'<style>.office-tone-preview{padding:var(--cx-space-4);overflow:auto}</style></head><body>'+document.body.innerHTML.replaceAll('src="./icons/', 'src="'+new URL('../../extensions/aipro-chat/public/icons/',root).href)+'</body></html>';
 await writeFile(new URL(name+'.html',import.meta.url),markup);
}
const names=[]; await snapshot('office-tone-welcome'); names.push('office-tone-welcome');
fireEvent.click(screen.getByRole('button',{name:'Word 양식 등록과 관리'}));await screen.findByText('분기 업무 보고서');await snapshot('office-tone-catalog');names.push('office-tone-catalog');
fireEvent.click(screen.getByRole('button',{name:'분기 업무 보고서 스냅샷 정보'}));await snapshot('office-tone-template-info');names.push('office-tone-template-info');
fireEvent.click(screen.getByRole('button',{name:'닫기'}));fireEvent.click(screen.getByRole('button',{name:'모델 변경'}));await screen.findByRole('dialog');await waitFor(()=>{if(screen.getByRole('button',{name:'모델 목록 새로고침'}).disabled)throw new Error('Model refresh still pending');});await snapshot('office-tone-models');names.push('office-tone-models');
cleanup();
const {TaskActivity}=await import('../src/TaskActivity.jsx'),{OfficeTransaction}=await import('../src/OfficeTransaction.jsx'),{OfficeQuestion}=await import('../src/OfficeQuestion.jsx'),{OfficeDocumentResult}=await import('../src/OfficeDocumentResult.jsx');
const h=React.createElement,previewRun={id:'preview',host:'excel',state:'running',phase:'executing',kind:'document',plan:{steps:[{id:'one',title:'양식과 입력 항목 확인',state:'done'},{id:'two',title:'점수 입력과 수식 작성',state:'running'},{id:'three',title:'계산 결과 확인과 저장',state:'pending'}]},activity:[{id:'a1',kind:'tool',state:'done',title:'양식 읽기',detail:'성적표 A1:H25 / 수식 12개 확인',startedAt:1000,endedAt:2200},{id:'a2',kind:'tool',state:'running',title:'수식 작성과 확인',detail:'성적표 F6:F12 / 합계와 평균',startedAt:Date.now()}]};
function component(children){render(h('main',{className:'app-shell'},h('section',{className:'office-tone-preview'},...children)));}
component([h(TaskActivity,{run:previewRun,latest:true})]);await snapshot('office-tone-progress');names.push('office-tone-progress');cleanup();
component([h(TaskActivity,{run:{...previewRun,phase:'awaiting_input'},latest:true}),h(OfficeQuestion,{question:{id:'question',kind:'choice',text:'성적표에 어떤 점수를 표시할까요?',options:[{id:'a',label:'원점수와 등급'},{id:'b',label:'표준점수와 백분위'}]},onChoose:async()=>true,onDraft:async()=>{}})]);await snapshot('office-tone-question');names.push('office-tone-question');cleanup();
component([h(TaskActivity,{run:{...previewRun,state:'failed'},latest:true}),h(OfficeTransaction,{approval:{payload:{kind:'recovery',title:'진행을 멈추고 확인을 기다립니다',summary:'모델 응답이 길이 제한에서 끊겼습니다. 확인된 양식은 유지됩니다.',target:'성적표 F6:F12',verification:'작성 중인 수식을 나누어 다시 요청합니다.'}},onDecision(){}})]);await snapshot('office-tone-recovery');names.push('office-tone-recovery');cleanup();
component([h(OfficeTransaction,{approval:{payload:{host:'excel',kind:'save',title:'성적표를 저장할까요?',summary:'입력 항목과 수식을 검토했습니다.',target:'수능 성적표.xlsx',verification:'요구사항과 계산 결과를 확인했습니다.'}},onDecision(){}}),h(OfficeDocumentResult,{host:'excel',title:'수능 성적표',detail:'문서 카드 예시',path:'C:\\문서\\수능 성적표.xlsx',onOpen(){}})]);await snapshot('office-tone-approval');names.push('office-tone-approval');cleanup();dom.window.close();
const browser=await chromium.launch({headless:true,channel:'chrome'});const measurements=[];
for(const width of [360,480]){
 const page=await browser.newPage({viewport:{width,height:850},deviceScaleFactor:1,reducedMotion:'reduce'});
 for(const name of names){
  await page.goto(new URL(name+'.html',import.meta.url).href);await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:fileURLToPath(new URL(name+'-'+width+'.png',import.meta.url)),fullPage:true});
  measurements.push({name,width,measurements:await page.evaluate(()=>({horizontalOverflow:document.documentElement.scrollWidth>innerWidth,fontSize:getComputedStyle(document.querySelector('input')||document.body).fontSize,cardHeight:document.querySelector('.office-template-card')?.getBoundingClientRect().height,animations:document.querySelector('.office-template-list')?getComputedStyle(document.querySelector('.office-template-list')).animationName:undefined,dialog:document.querySelector('[role="dialog"]')?.getBoundingClientRect().toJSON(),font:getComputedStyle(document.body).fontFamily}))});
 }
 await page.close();
}
const motionPage=await browser.newPage({viewport:{width:360,height:850},reducedMotion:'no-preference'});
await motionPage.goto(new URL('office-tone-catalog.html',import.meta.url).href);
measurements.push({name:'motion',animation:await motionPage.locator('.office-template-list').evaluate(el=>({name:getComputedStyle(el).animationName,iterations:getComputedStyle(el).animationIterationCount,duration:getComputedStyle(el).animationDuration}))});
// Optional local reference only; the user's deck is never copied into the repository.
if(process.argv[2]){
 const reference=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
 await reference.goto(pathToFileURL(process.argv[2]).href);await reference.evaluate(()=>{const slides=[...document.querySelectorAll('.slide')];slides.forEach((s,i)=>s.classList.toggle('active',i===3));});await reference.evaluate(()=>document.fonts.ready);await reference.locator('.slide.active').evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished)));await reference.screenshot({path:fileURLToPath(new URL('office-tone-reference.png',import.meta.url))});
}
await browser.close();
for(const sample of measurements){
 if(sample.measurements){assert.equal(sample.measurements.horizontalOverflow,false,`${sample.name} at ${sample.width}px`);assert.equal(sample.measurements.fontSize,'14px');if(sample.measurements.animations)assert.equal(sample.measurements.animations,'none');}
 if(sample.name==='motion'){assert.equal(sample.animation.name,'deck-rise');assert.equal(sample.animation.iterations,'1');assert.equal(sample.animation.duration,'0.4s');}
}
await writeFile(new URL('office-tone-measurements.json',import.meta.url),JSON.stringify(measurements,null,2)+'\n');console.log(JSON.stringify(measurements,null,2));
