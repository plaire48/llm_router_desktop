import {_electron as electron,chromium} from 'playwright';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readdir,access,rm,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {rendererBundleOptions} from './renderer-bundle.mjs';


// No extension: direct CDP + temporary Chromium profile + real Electron renderer/port.
// The source is a local test site, not a company account or production SSO.
const require=createRequire(import.meta.url),base=path.resolve('.'),temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-content-')),out=path.resolve('verification/direct-browser-content-2026-10-23');
await mkdir(out,{recursive:true});await mkdir(path.join(temporary,'app'));
const checks=[],errors=[],timings=[];
const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;font:18px system-ui;color:#191f28;background:#fff}.header{background:#e8f1fe;padding:28px 32px}main{padding:32px}button,input{font:inherit;padding:12px;margin:8px 12px 8px 0}input{width:400px}#menu{position:fixed;display:none;background:#191f28;color:white;padding:14px;border-radius:8px;z-index:2}.bottom{margin-top:1100px;padding:30px;background:#eef8f5}</style><div class="header"><h1>업무 포털</h1><p id="session"></p></div><main><button id="count">처리 0</button><input id="text" aria-label="업무 내용" placeholder="업무 내용을 입력하세요"><p id="mirror">입력 대기</p><a id="link" href="/next">다음 업무</a><div class="bottom">스크롤한 원래 페이지</div></main><div id="menu">사이트 우클릭 메뉴</div><script>let n=0;count.onclick=()=>count.textContent='처리 '+(++n);text.oninput=()=>mirror.textContent=text.value||'입력 대기';document.addEventListener('contextmenu',e=>{if(e.target.id==='count'){e.preventDefault();menu.style.cssText='display:block;left:'+e.clientX+'px;top:'+e.clientY+'px'}});document.addEventListener('click',e=>{if(e.target.id!=='count')menu.style.display='none'});fetch('/identity').then(r=>r.json()).then(x=>session.textContent=x.authenticated?'기존 세션 유지':'로그인 필요')</script></html>`;
const server=createServer((req,res)=>{
 if(req.url==='/identity'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({authenticated:(req.headers.cookie||'').includes('nubi_qa=verified')}));return;}
 if(req.url==='/start'){res.setHeader('Set-Cookie','nubi_qa=verified; HttpOnly; SameSite=Lax; Path=/');res.writeHead(302,{Location:'/work'});res.end();return;}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);
});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
let app,browser,viewer,source;
const modulePath=name=>path.join(base,'electron-app',name);
try{

 const options=rendererBundleOptions();await build({...options,entryPoints:['tests/external-content-fixture.jsx'],outdir:path.join(temporary,'app/frontend'),entryNames:'renderer',minify:false});
 await cp('../../extensions/aipro-chat/public/icons',path.join(temporary,'app/frontend/icons'),{recursive:true});
 await writeFile(path.join(temporary,'app/frontend/index.html'),'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="renderer.css"><style>body{margin:0}button{cursor:pointer}</style><div id="root"></div><script type="module" src="renderer.js"></script>');
 const electronMain=`const {app,BrowserWindow,ipcMain,clipboard,Menu}=require('electron');
const {ExternalBrowserHost}=require(${JSON.stringify(modulePath('external-browser-host.cjs'))});
const {BrowserHost}=require(${JSON.stringify(modulePath('browser-host.cjs'))});
const {BrowserRouter}=require(${JSON.stringify(modulePath('browser-router.cjs'))});
const {createExternalBrowserContentPort}=require(${JSON.stringify(modulePath('external-browser-content-port.cjs'))});
const {ChromeDirectConnection}=require(${JSON.stringify(modulePath('chrome-direct-connection.cjs'))});
let window,external,router,port,menu,qaClipboard='',connectUrl='';
const nativeBuild=Menu.buildFromTemplate.bind(Menu);Menu.buildFromTemplate=items=>{menu={items,instance:nativeBuild(items)};return menu.instance};
app.whenReady().then(()=>{
window=new BrowserWindow({width:1120,height:850,webPreferences:{preload:${JSON.stringify(modulePath('preload.cjs'))},contextIsolation:true,sandbox:true,nodeIntegration:false}});
external=new ExternalBrowserHost({onChange:state=>window.webContents.send('nubi:host-event',{type:'external_browser_changed',state})});
const internal=new BrowserHost(window,{partition:'qa-only'});router=new BrowserRouter({internal,external,launch:{preference:{mode:'external'},status:()=>({mode:'external'}),open:async url=>{connectUrl=url;return {opened:true}}}});
port=createExternalBrowserContentPort({browser:external,router,window,Menu,clipboard:{readText:()=>qaClipboard,writeText:value=>qaClipboard=value},directFactory:()=>new ChromeDirectConnection({portFile:${JSON.stringify(path.join(temporary,'chrome-state/DevToolsActivePort'))}})});
ipcMain.handle('nubi:request',async(event,method,args={})=>{
if(event.sender!==window.webContents)throw Error('renderer_invalid');
if(method==='browserMirror')return port.request(args);
if(method==='browserConnection'){if(args.action==='status')return router.configuration();if(args.action==='pair')return external.pair();if(args.action==='focus')return external.focus(args.tabId);if(args.action==='disconnect'){await external.stop();return router.configuration();}}
if(method==='browser')return router.ui(args);
if(method==='qa'){if(args.action==='launch')return {url:connectUrl};if(args.action==='state')return {mirror:external.mirror.current&&{...external.mirror.current},state:router.configuration()};if(args.action==='clipboard')return {text:qaClipboard};if(args.action==='menu')return menu?.items.map(x=>({label:x.label,type:x.type}));if(args.action==='menuClick'){menu?.instance.closePopup(window);menu?.items.find(x=>x.label===args.label)?.click?.();return {clicked:true}}if(args.action==='capture')return port.capture(async()=>({captured:true}));if(args.action==='automation')return external.request('check',{tabId:external.active});if(args.action==='inputText'){return external.command('cdp',{tabId:external.active,documentId:external.tab(external.active).automationDocument,method:'Input.insertText',params:{text:args.text}})}}
throw Error('method_invalid')});
window.loadFile(${JSON.stringify(path.join(temporary,'app/frontend/index.html'))});
});app.on('before-quit',()=>{port?.dispose();external?.dispose()});`;
 await writeFile(path.join(temporary,'app/main.cjs'),electronMain);
 app=await electron.launch({executablePath:require('electron'),args:[path.join(temporary,'app/main.cjs'),'--user-data-dir='+path.join(temporary,'electron-state')],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});
 viewer=await app.firstWindow();viewer.setDefaultTimeout(15000);viewer.on('pageerror',error=>errors.push(error.message));
 const request=(method,args)=>viewer.evaluate(({method,args})=>window.nubi.request(method,args),{method,args});
 await viewer.getByRole('heading',{name:'외부 브라우저와 함께 작업하세요'}).waitFor();
 let executable=process.env.NUBI_TEST_CHROMIUM;
 if(!executable){const cache=path.join(os.homedir(),'Library/Caches/ms-playwright');for(const name of (await readdir(cache)).filter(x=>/^chromium-\d+$/.test(x)).sort((a,b)=>Number(b.split('-')[1])-Number(a.split('-')[1]))){const candidate=path.join(cache,name,'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');try{await access(candidate);executable=candidate;break;}catch{}}}
 browser=await chromium.launchPersistentContext(path.join(temporary,'chrome-state'),{executablePath:executable,headless:false,viewport:null,args:['--remote-debugging-port=0']});

 source=browser.pages()[0]||await browser.newPage();await source.goto(origin+'/start');await source.getByText('기존 세션 유지').waitFor();const originalViewport=await source.evaluate(()=>({width:innerWidth,height:innerHeight,outerWidth,outerHeight}));
 await viewer.screenshot({path:path.join(out,'connection-electron.png')});
 const frames=path.join(out,'journey-frames');await mkdir(frames,{recursive:true});let recording=true;const journey=[],recordedAt=performance.now();
 const record=(async()=>{while(recording){const name=String(journey.length).padStart(4,'0')+'.png';await viewer.screenshot({path:path.join(frames,name)});journey.push({file:name,time:performance.now()-recordedAt});await new Promise(resolve=>setTimeout(resolve,45));}})();
 await viewer.getByRole('button',{name:'브라우저 연결',exact:true}).click();await viewer.waitForTimeout(400);
 await viewer.bringToFront();await viewer.locator('[data-mirror-phase=ready]').waitFor();await viewer.waitForTimeout(350);recording=false;await record;await writeFile(path.join(out,'journey.json'),JSON.stringify(journey));
 const initialViewport=await source.evaluate(()=>({width:innerWidth,height:innerHeight})),initialCanvas=await viewer.locator('canvas').boundingBox();assert(Math.abs(initialViewport.width-initialCanvas.width)<2);assert(Math.abs(initialViewport.height-initialCanvas.height)<2);
 assert.equal(await viewer.locator('.desktop-browser-toolbar:visible,.nubi-native-browser-bar:visible,.nubi-external-address:visible').count(),0);checks.push('확장 설치 없는 연결 버튼이 기존 Chromium 탭에 직접 연결');
 const clickSource=async(selector,button='left')=>{
  const box=await source.locator(selector).boundingBox(),target=await viewer.locator('canvas').boundingBox(),viewport=await source.evaluate(()=>({width:innerWidth,height:innerHeight}));assert(box&&target);
  await viewer.mouse.click(target.x+(box.x+box.width/2)/viewport.width*target.width,target.y+(box.y+box.height/2)/viewport.height*target.height,{button});
 };
 for(let i=1;i<=5;i++){const started=performance.now();await clickSource('#count');await source.getByRole('button',{name:'처리 '+i,exact:true}).waitFor();timings.push(performance.now()-started);}
 checks.push('사이드바 클릭 5회가 원래 탭에 각각 한 번 반영');
 await clickSource('#text');await viewer.keyboard.type('abc');await source.waitForFunction(()=>document.querySelector('#text').value==='abc');
 await viewer.keyboard.insertText(' 한글');await source.waitForFunction(()=>document.querySelector('#text').value==='abc 한글');checks.push('Electron 키보드 영문과 한글 입력이 원래 Chromium 입력칸에 반영');
 await viewer.locator('textarea.nubi-external-keyboard').evaluate(node=>{node.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));node.value='조합';node.dispatchEvent(new CompositionEvent('compositionupdate',{bubbles:true,data:'조합'}));node.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'조합'}));});
 await source.waitForFunction(()=>document.querySelector('#text').value==='abc 한글조합');checks.push('합성 IME composition 종료가 원본에 중복 없이 한 번 입력됨');
 await clickSource('#count','right');await source.locator('#menu').waitFor({state:'visible'});checks.push('사이트 자체 우클릭 메뉴가 원본과 콘텐츠 화면에 표시');
 await viewer.screenshot({path:path.join(out,'content-electron.png')});
 await clickSource('#text','right');await viewer.waitForTimeout(250);const menu=await request('qa',{action:'menu'});assert(menu.some(x=>x.label==='붙여넣기'));await request('qa',{action:'menuClick',label:'전체 선택'});await viewer.waitForTimeout(200);await request('qa',{action:'menuClick',label:'복사'});await viewer.waitForTimeout(200);assert.equal((await request('qa',{action:'clipboard'})).text,'abc 한글조합');
 checks.push('기본 우클릭 메뉴를 Electron 메뉴에 연결하고 원본 편집 명령 실행');
 const canvas=await viewer.locator('canvas').boundingBox();await viewer.mouse.move(canvas.x+canvas.width/2,canvas.y+canvas.height/2);await viewer.mouse.wheel(0,500);await source.waitForFunction(()=>scrollY>0);checks.push('사이드바 휠 입력이 원래 페이지 스크롤에 반영');
 await viewer.getByRole('button',{name:'패널 전환',exact:true}).click();await viewer.waitForTimeout(200);assert.equal((await request('qa',{action:'state'})).mirror,null);assert.equal(source.isClosed(),false);const restored=await source.evaluate(()=>({width:innerWidth,height:innerHeight,outerWidth,outerHeight}));assert.equal(restored.width,originalViewport.width);assert.equal(restored.outerWidth,originalViewport.outerWidth);assert.equal(restored.outerHeight,originalViewport.outerHeight);assert(restored.height<=originalViewport.height&&restored.height>=originalViewport.height-80,'Chrome debugger banner may reduce the native content height');await viewer.getByRole('button',{name:'패널 전환',exact:true}).click();await viewer.locator('[data-mirror-phase=ready]').waitFor();checks.push('패널 숨김에서 중계 중단과 원본 크기 복원, 재진입에서 같은 탭으로 복귀');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(760,900));await viewer.waitForTimeout(400);await viewer.locator('[data-mirror-phase=ready]').waitFor();const narrow=await source.evaluate(()=>({width:innerWidth,height:innerHeight})),narrowCanvas=await viewer.locator('canvas').boundingBox();assert(narrow.width<500);assert(Math.abs(narrow.width-narrowCanvas.width)<2);assert(Math.abs(narrow.height-narrowCanvas.height)<2);await viewer.mouse.move(narrowCanvas.x+narrowCanvas.width/2,narrowCanvas.y+100);await viewer.mouse.wheel(0,-3000);await source.waitForFunction(()=>scrollY===0);await viewer.waitForTimeout(200);await viewer.screenshot({path:path.join(out,'content-narrow-electron.png')});checks.push('좁은 패널에서 원본 탭을 같은 CSS 크기로 표시해 글자를 축소하지 않음');
 await viewer.getByRole('button',{name:'검증 모달',exact:true}).click();await viewer.waitForTimeout(200);assert.equal((await request('qa',{action:'state'})).mirror,null);await viewer.getByRole('button',{name:'모달 닫기',exact:true}).click();await viewer.locator('[data-mirror-phase=ready]').waitFor();checks.push('모달 뒤에서는 화면 중계와 입력 중단 후 정상 재개');
 await viewer.emulateMedia({reducedMotion:'reduce'});const reduced=await viewer.locator('canvas').evaluate(n=>({animation:getComputedStyle(n).animationName,transform:getComputedStyle(n).transform}));assert(['none','nubi-motion-fade'].includes(reduced.animation));assert.equal(reduced.transform,'none');await viewer.emulateMedia({reducedMotion:'no-preference'});checks.push('공통 브랜드 모션과 동작 줄이기의 정적 또는 짧은 페이드 적용');
 await source.goto(origin+'/sso/login');await viewer.waitForFunction(async()=>{const s=await window.nubi.request('browserConnection',{action:'status'}),t=s.tabs.find(t=>t.id===s.active);return t?.protected&&document.querySelector('canvas')?.dataset.documentId===t.documentId;});await viewer.locator('[data-mirror-phase=ready]').waitFor();await assert.rejects(()=>request('qa',{action:'capture'}),/auth_protected/);await assert.rejects(()=>request('qa',{action:'automation'}),/auth_protected/);checks.push('로그인 페이지는 사용자에게 표시하되 모델 자동화와 앱 화면 캡처 차단');
 await source.goto(origin+'/work');await viewer.locator('[data-mirror-phase=ready]').waitFor();await source.getByText('기존 세션 유지').waitFor();checks.push('원본 탐색 뒤 새 문서에 재연결하고 기존 HttpOnly 세션 유지');
 await browser.close();browser=null;await viewer.getByRole('heading',{name:'외부 브라우저와 함께 작업하세요'}).waitFor();assert.equal(await viewer.locator('.desktop-browser-toolbar:visible').count(),0);checks.push('브라우저 종료 뒤 연결 안내를 표시하며 내부 웹뷰로 우회하지 않음');
 assert.deepEqual(errors,[]);
 const report={checks,timings:{measurement:'Test interaction round trip including locator reads and Electron click to original Chromium DOM update; excludes frame presentation and is not a product latency benchmark',samplesMs:timings},scope:'actual temporary Chromium without extensions + actual Electron modules + local synthetic authenticated site; clipboard adapter is in memory',unverified:['Windows and Samsung browser including its connection permission UI','company SSO and mail APIs','physical Korean IME and native file picker','installer and real model workflow']};await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){await writeFile(path.join(out,'failure.txt'),String(error.stack||error));if(source&&!source.isClosed())await source.screenshot({path:path.join(out,'failure-source.png')}).catch(()=>{});if(viewer)await viewer.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}
finally{await browser?.close().catch(()=>{});await Promise.race([app?.close().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,5000))]);await new Promise(resolve=>server.close(resolve));await rm(temporary,{recursive:true,force:true});}
