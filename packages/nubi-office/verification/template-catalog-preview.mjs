// Static source DOM preview only. No product bundle or installer build.
import '../tests/ui-source-loader.mjs';
import {JSDOM} from 'jsdom';
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
 const result=method==='session'?{host:'word',provider:'aipro',connected:true,model:'fixture-qwen',models:[{id:'fixture-qwen',label:'Qwen 3.8 27B (UI 예시)'}],providers:[{id:'aipro',connected:true}]}:method==='template_catalog_list'?{host:'word',entries,unreadable:0}:method==='history'?[]:undefined;
 if(result===undefined)throw new Error('Unexpected preview action');queueMicrotask(()=>receive({data:{id,ok:true,result}}));
}}};
const React=await import('react'),{render,screen,fireEvent,cleanup}=await import('@testing-library/react'),{default:App}=await import('../src/App.jsx');
render(React.createElement(App),{container:document.querySelector('#root')});
await screen.findByRole('textbox',{name:'Word 작업 요청'});
const styles=['node_modules/@e2e/cx-design-system/dist/styles.css','../../extensions/aipro-chat/design/agent-deck.css','../../extensions/aipro-chat/src/app.css','../../extensions/aipro-chat/src/surfaces.css','../../extensions/aipro-chat/src/code.css','../../extensions/aipro-chat/src/interaction-forms.css','../../extensions/aipro-chat/src/approval.css','../../extensions/aipro-chat/src/deck-surfaces.css','src/office.css'];
const root=new URL('../',import.meta.url),links=styles.map(path=>`<link rel="stylesheet" href="${new URL(path,root)}">`).join('');
async function snapshot(name){
 const markup='<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>누비 양식 UI 소스 미리보기</title>'+links+'</head><body>'+document.body.innerHTML.replaceAll('src="./icons/', 'src="'+new URL('../../extensions/aipro-chat/public/icons/',root).href)+'</body></html>';
 await writeFile(new URL(name+'.html',import.meta.url),markup);
}
await snapshot('template-composer');
fireEvent.click(screen.getByRole('button',{name:'Word 양식 등록과 관리'}));await screen.findByText('분기 업무 보고서');await snapshot('template-catalog');cleanup();dom.window.close();
const browser=await chromium.launch({headless:true,channel:'chrome'});const measurements=[];
for(const width of [360,480]){
 const page=await browser.newPage({viewport:{width,height:850},deviceScaleFactor:1,reducedMotion:'reduce'});
 for(const name of ['template-composer','template-catalog']){
  await page.goto(new URL(name+'.html',import.meta.url).href);await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:fileURLToPath(new URL(name+'-'+width+'.png',import.meta.url)),fullPage:true});
  measurements.push({name,width,measurements:await page.evaluate(()=>({horizontalOverflow:document.documentElement.scrollWidth>innerWidth,dialog:document.querySelector('[role="dialog"]')?.getBoundingClientRect().toJSON(),font:getComputedStyle(document.body).fontFamily}))});
 }
 await page.close();
}
await browser.close();console.log(JSON.stringify(measurements,null,2));
