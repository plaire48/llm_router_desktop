import {build} from 'esbuild';
import {chromium} from 'playwright';
import {mkdir,mkdtemp,writeFile,readFile,cp,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const root=process.cwd(),directory=await mkdtemp(path.join(os.tmpdir(),'nubi-wiki-portal-ui-')),output=root+'/verification/wiki-portal';await mkdir(output,{recursive:true});
const style=`import '@e2e/cx-design-system/styles.css';import '${root}/electron-app/workbench.css';import '${root}/design/workspace-identity.css';import '${root}/electron-app/shell.css';import '${root}/electron-app/ios-tokens.css';import '${root}/design/workspace-typography.css';import '${root}/design/workspace-density.css';import '${root}/design/workspace-dialogs.css';`;
const entry=`import React,{useState}from'react';import{createRoot}from'react-dom/client';import{DetailPanel}from'@e2e/cx-design-system';import{MailLibrary}from'${root}/ui/MailLibrary.jsx';import{MailHistory}from'${root}/ui/MailHistory.jsx';${style}
window.portalCalls=[];const status={connected:false,autoWiki:false,protocol:'portal',counts:{received:0,attention:0},progress:{},catalogs:[],folders:[{id:'1',name:'받은메일함',mailbox:'inbox'},{id:'2',name:'보낸메일함',mailbox:'sent'},{id:'3',name:'임시보관함',mailbox:'draft'},{id:'4',name:'스팸함',mailbox:'spam'}]};
const api=async(method,args={})=>{window.portalCalls.push({method,...args});if(args.action==='status')return {...status};if(args.action==='portalLogin'){status.connected=true;return {...status};}if(args.action==='history')return {total:0,messages:[]};if(args.action==='facets')return {senders:[],tags:[],roles:[],attachments:[]};if(args.action==='search')return {total:0,totalPages:0,page:0,offset:0,results:[],filters:{},scanned:0,collected:0,saved:0,pending:0,unavailable:[],retrieval:{},unreadAttachments:0};if(args.action==='approvals')return {page:args.page,total:2,hasNext:args.page===1,items:[{id:'approval-'+args.page,lineId:'line',subject:'실제 연결 경로 검증용 결재 '+args.page,submittedAt:'2026-10-13T09:00:00Z'}]};if(args.action==='approvalRead')return {id:args.id,subject:'결재 원문 확인',mail:{text:'본문',presentation:{html:'<table><tr><td>양식을 유지한 결재 본문</td></tr></table><img src="https://example.invalid/tracking.png"><script>alert(1)</script>',images:[]}}};return {...status};};
window.addEventListener('nubi-mail-login',()=>void api('mail',{action:'portalLogin'}));
function Fixture(){const[settings,setSettings]=useState(true);return <main className="desktop-shell">{settings&&<DetailPanel className="deck-dialog nubi-panel" title="메일 설정" variant="modal" onClose={()=>setSettings(false)}><MailLibrary api={api}/></DetailPanel>}<div className="desktop-agent"><div className="nubi-workbench" data-host-layout="integrated"><div className="nubi-workbench-content"><MailHistory api={api} onSettings={()=>setSettings(true)}/></div></div></div></main>;}createRoot(document.getElementById('root')).render(<Fixture/>);`;
await writeFile(directory+'/portal.jsx',entry);
const options={bundle:true,format:'esm',platform:'browser',nodePaths:[root+'/node_modules'],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,root+'/node_modules/'+name])),'@e2e/cx-design-system/styles.css':root+'/node_modules/@e2e/cx-design-system/dist/styles.css'},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}};
await build({...options,entryPoints:[root+'/tests/shared-ui-fixture.jsx'],outfile:directory+'/wiki.js'});await build({...options,entryPoints:[directory+'/portal.jsx'],outfile:directory+'/portal.js'});
await cp(path.resolve(root,'../../extensions/aipro-chat/public/icons'),directory+'/icons',{recursive:true});for(const name of ['wiki','portal'])await writeFile(directory+'/'+name+'.html',`<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="${name}.css"><div id="root"></div><script type="module" src="${name}.js"></script></html>`);
const server=createServer(async(req,res)=>{try{const file=path.resolve(directory,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(directory+path.sep))throw Error();res.setHeader('content-type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser,page;const errors=[],checks=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:1100,height:900}});page.on('pageerror',error=>errors.push(error.message));const base='http://127.0.0.1:'+server.address().port;
 await page.goto(base+'/wiki.html?catalog&wiki-chat&integrated');const input=page.locator('textarea[aria-label="작업 요청"]');await input.fill('보존할 초안');
 const job={id:'writing',projectId:'fixture',state:'running',stage:'generating',startedAt:new Date(Date.now()-90000).toISOString(),completed:3,total:10,percent:30};await page.evaluate(job=>window.setWikiChatJob(job),job);const progress=page.getByRole('region',{name:'프로젝트 위키 작성',exact:true});await progress.waitFor();assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await input.inputValue(),'보존할 초안');assert.equal(await input.isDisabled(),true);assert.match(await progress.innerText(),/검증 프로젝트/);assert.match(await progress.innerText(),/30%/);assert.match(await progress.innerText(),/1분/);assert.equal(await progress.locator('.nubi-wiki-project-identity > svg').count(),1);
 for(const width of [1100,440]){await page.setViewportSize({width,height:900});assert(await progress.evaluate(node=>{const box=node.getBoundingClientRect(),bar=node.querySelector('[role=progressbar]').getBoundingClientRect();return node.scrollWidth<=node.clientWidth+1&&bar.left>=box.left&&bar.right<=box.right&&bar.bottom<=box.bottom;}));await page.screenshot({path:output+'/progress-form-'+width+'.png',animations:'disabled'});}await page.setViewportSize({width:1100,height:900});
 await page.getByRole('button',{name:'설정',exact:true}).click();const runningSettings=page.getByRole('dialog',{name:'설정',exact:true});await runningSettings.waitFor();await page.keyboard.press('Escape');await runningSettings.waitFor({state:'hidden'});assert(await input.isDisabled(),'only conversation admission stays blocked after closing settings');
 await page.evaluate(()=>document.querySelector('form.composer').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.deepEqual(await page.evaluate(()=>window.wikiChatCalls),[]);const reveal=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await reveal.count())await reveal.click();
 assert(await page.getByRole('status',{name:'검증 프로젝트 위키 작성 중',exact:true}).isVisible());assert(await page.getByRole('status',{name:'백그라운드 프로젝트 위키 갱신 중',exact:true}).isVisible());
 await page.getByRole('button',{name:'백그라운드 프로젝트 대화 펼치기',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.wikiProjectSwitches),['background-wiki']);
 await page.screenshot({path:output+'/wiki-writing.png',animations:'disabled'});
 await page.evaluate(()=>window.setWikiChatJob(null));await progress.waitFor({state:'hidden'});assert.equal(await input.inputValue(),'보존할 초안');assert.equal(await input.isDisabled(),false);
 // A real pre-admission rejection restores the draft, without an uncertain bubble.
 await page.evaluate(()=>{window.wikiSilentLock=true;});await input.press('Enter');await page.getByText('위키 작성이 끝나면 이 프로젝트에서 대화할 수 있어요.',{exact:true}).waitFor();assert.equal(await input.inputValue(),'보존할 초안');assert.equal(await page.locator('.nubi-outgoing-message').count(),0);
 await page.evaluate(()=>{window.wikiSilentLock=false;window.setWikiChatJob(null);});checks.push('actual Workbench blocks writer admissions, shows the shared progress icon and real counts, preserves and restores drafts');
 // Rebuild/refresh starts from a completed Wiki, with no initialization prop
 // update. The admission promise deliberately waits like a slow remote sync.
 for(const mode of ['reset','refresh','resume']){
  await page.goto(base+'/wiki.html?catalog&wiki-chat&integrated&modals');
  await input.fill('재작성 중 보존할 초안');
  await page.evaluate(mode=>{window.modalWikiState=mode==='resume'?'failed':'outdated';},mode);
  await page.getByRole('button',{name:'위키 설정',exact:true}).first().click();
  const settings=page.getByRole('dialog',{name:'위키 설정',exact:true});
  if(mode==='reset'){
    await settings.getByRole('button',{name:'위키 다시 만들기',exact:true}).click();
    await page.getByRole('alertdialog',{name:'위키를 다시 만들까요?',exact:true}).getByRole('button',{name:'다시 만들기',exact:true}).click();
  }else await settings.getByRole('button',{name:mode==='resume'?'이어서 갱신':'동기화 및 갱신',exact:true}).click();
  await progress.waitFor();assert(await input.isDisabled());assert.equal(await page.getByRole('dialog').count(),0);
  await page.evaluate(()=>window.releaseWikiAdmission());
  await progress.locator('[role=progressbar][aria-valuenow="25"]').waitFor();assert(await input.isDisabled());
  await page.screenshot({path:output+'/wiki-'+mode+'.png',animations:'disabled'});
  await page.evaluate(()=>window.setWikiChatJob(null));await progress.waitFor({state:'hidden'});
  assert.equal(await input.isDisabled(),false);assert.equal(await input.inputValue(),'재작성 중 보존할 초안');
  assert.deepEqual(await page.evaluate(()=>window.wikiChatCalls),[]);
 }
 checks.push('rebuild, refresh and resume immediately block chat and use the same inline progress surface through delayed admission and completion');
 for(const width of [1100,440]){
  await page.setViewportSize({width,height:900});await page.goto(base+'/portal.html');const settings=page.getByRole('dialog',{name:'메일 설정'});await settings.getByRole('button',{name:'포털 로그인',exact:true}).waitFor();assert.equal(await settings.locator('input[type=password]').count(),0);assert.equal(await settings.getByText('수신 구분',{exact:true}).count(),0);await settings.getByRole('button',{name:'포털 로그인',exact:true}).click();await settings.getByText('사내 포털 연결됨',{exact:true}).waitFor();assert((await page.evaluate(()=>window.portalCalls)).some(call=>call.action==='portalLogin'));await page.screenshot({path:output+'/portal-settings-'+width+'.png',animations:'disabled'});await settings.getByRole('button',{name:'닫기',exact:true}).click();
  for(const name of ['받은 메일함','보낸 메일함','임시 보관함','스팸 메일함']){const tab=page.getByRole('tab',{name,exact:true});await tab.click();assert.equal(await tab.getAttribute('aria-selected'),'true');}
  await page.waitForFunction(()=>window.portalCalls.some(call=>call.action==='search'&&call.filters.mailbox==='spam'));
  await page.getByRole('tab',{name:'결재',exact:true}).click();await page.getByRole('button',{name:'실제 연결 경로 검증용 결재 1',exact:true}).click();await page.getByRole('heading',{name:'결재 원문 확인'}).waitFor();const frame=page.frameLocator('iframe[title="메일 본문"]');await frame.getByText('양식을 유지한 결재 본문',{exact:true}).waitFor();assert.equal(await frame.locator('script').count(),0);assert.equal(await frame.locator('img').count(),1);await page.screenshot({path:output+'/approval-body-'+width+'.png',animations:'disabled'});await page.getByRole('button',{name:'다음 결재 페이지',exact:true}).click();await page.getByRole('button',{name:'실제 연결 경로 검증용 결재 2',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'다음 결재 페이지',exact:true}).isDisabled(),true);await page.screenshot({path:output+'/approvals-'+width+'.png',animations:'disabled'});checks.push(width+'px: portal-only login, all server folders, isolated search, paged approvals and sanitized HTML with body images');
 }
 assert.deepEqual(errors,[]);await writeFile(output+'/checks.json',JSON.stringify({scope:'actual React/CX components with local API fixtures; no company login/server verification',checks,errors},null,2));console.log(checks.join('\n'));
}catch(error){await page?.screenshot({path:output+'/failure.png'}).catch(()=>{});throw error;}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
