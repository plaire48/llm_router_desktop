import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
import {captureDesign} from './design-rules.mjs';
import {assertDialogIdentity,assertDialogChrome} from './identity-browser.mjs';
import {build,stop as stopBuildService} from 'esbuild';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/wave2');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.webp':'file','.woff2':'file','.woff':'file','.svg':'dataurl'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nubi Wave 2</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

let browser,browserServer;const errors=[],checks=[];
const waitForAdmission=page=>page.locator('.nubi-conversation-scroll[data-admission="complete"][aria-busy="false"]').waitFor();
try {
 browserServer=await chromium.launchServer({channel:'chrome',headless:true});
 browser=await chromium.connect(browserServer.wsEndpoint());
 // Exercise the real Workbench relocation, not a longer wait for a collapsed receipt.
 if(!process.argv.includes('--routines-only'))for(const width of [1280,440])for(const expanded of [true,false]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?integrated&command-record-race');
  const opener=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();
  await page.getByRole('button',{name:'대화 검색',exact:true}).click();await page.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').first().click();
  const record=page.locator('.nubi-command-record').filter({has:page.locator('strong[title="명령 결과 확인"]')});await record.waitFor();
  assert.equal(await record.getAttribute('open'),null,'new records start collapsed');
  assert.equal(await record.locator('.nubi-terminal-output').count(),0,'collapsed output is not mounted');
  const original=await record.elementHandle();
  await record.locator('summary').focus();await page.keyboard.press('Enter');
  await record.locator('.nubi-terminal-output').waitFor();
  if(!expanded){await record.locator('summary').click();await page.waitForFunction(()=>!document.querySelector('.nubi-command-record').open);}
  await page.evaluate(()=>window.finishCommandTurn());
  await page.getByText('명령 기록을 확인했습니다.',{exact:true}).waitFor();
  assert.equal(await original.evaluate(node=>node.isConnected),false,'turn completion actually remounts the command record');
  await page.screenshot({path:path.join(dir,`command-record-${width}-${expanded?'open':'closed'}.png`)});
  assert.equal(await record.evaluate(node=>node.open),expanded,'user expansion survives final-answer remount');
  assert.equal(await record.locator('.nubi-terminal-output').count(),expanded?1:0,'output mounting follows the retained choice');
  const other=page.locator('.nubi-command-record').filter({has:page.locator('strong[title="다른 명령 기록"]')});
  assert.equal(await other.getAttribute('open'),null,'another action ID does not inherit expansion');
  assert.equal(await other.locator('.nubi-terminal-output').count(),0);
  if(expanded){assert.match(await record.innerText(),/command-output/);await record.getByRole('button',{name:'터미널 열기',exact:true}).click();assert.equal(await page.evaluate(()=>window.openedTerminal.processId),'command-process');}
  checks.push({scene:'command-record-remount',width,expanded,realRemount:true,keyboard:true,independentAction:true});await page.close();
 }
 if(!process.argv.includes('--routines-only'))for(const width of [1280,440])for(const state of ['checking','running','stopping']){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?integrated&command-status-race='+state);
  const opener=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();
  await page.getByRole('button',{name:'대화 검색',exact:true}).click();await page.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').first().click();
  const record=page.locator('.nubi-command-record').filter({has:page.locator('strong[title="명령 결과 확인"]')});await record.locator('summary').click();await record.locator('.nubi-terminal-state[data-state="'+state+'"]').waitFor();
  await page.evaluate(()=>window.finishCommandTurn());await page.getByText('명령 기록을 확인했습니다.',{exact:true}).waitFor({timeout:6000}).catch(async error=>{await page.screenshot({path:path.join(dir,'command-status-failure.png')});throw error;});
  await page.evaluate(()=>window.finishCommandProcess()); // No push/visibility event: only the continuing snapshot poll can learn completion.
  await record.locator('.nubi-terminal-state[data-state="completed"]').waitFor({timeout:4000});
  assert.match(await record.locator('.nubi-terminal-output').innerText(),/command-output/);assert.equal(await record.locator('.nubi-terminal-exit').innerText(),'exit 0');assert.equal(await record.getByRole('button',{name:'명령 중지',exact:true}).count(),0);assert.equal(await record.evaluate(n=>n.open),true);
  const reads=await page.evaluate(()=>window.commandStateReads);await page.waitForTimeout(1200);assert.equal(await page.evaluate(()=>window.commandStateReads),reads,'final snapshot stops command-only polling');
  await page.screenshot({path:path.join(dir,`command-status-${width}-${state}.png`)});checks.push({scene:'command-status-after-turn',width,state,completed:true,pollStopped:true});await page.close();
 }
 if(!process.argv.includes('--command-record-only')){
 if(!process.argv.includes('--routines-only')){
 for(const width of [1280,440]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?integrated&chapters');
  const opener=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();
  const projectRow=page.locator('.nubi-saved-project[data-current="true"]>.nubi-sidebar-project-row');
  assert(await projectRow.evaluate(row=>{const clear=n=>getComputedStyle(n).backgroundColor==='rgba(0, 0, 0, 0)';return !clear(row)&&clear(row.querySelector('.nubi-sidebar-project'))&&clear(row.querySelector('summary'));}),'project name and more action must share one row background');
  await page.getByRole('button',{name:'대화 검색',exact:true}).click();await page.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').first().click();
  const nav=page.getByRole('navigation',{name:'챕터 목차'});await nav.waitFor({timeout:10000});
  assert.equal(await page.locator('.nubi-chapter[role="separator"]').count(),3);
  assert.equal(await nav.getByRole('button').count(),3);
  const assertSeparated=async()=>assert(await nav.evaluate(node=>{const a=node.getBoundingClientRect(),b=node.closest('.nubi-conversation-wrap').querySelector('.nubi-conversation-scroll').getBoundingClientRect();return a.right<=b.left+1||a.left>=b.right-1||a.bottom<=b.top+1||a.top>=b.bottom-1;}),'chapter navigation must have its own space outside the transcript');
  await assertSeparated();
  await waitForAdmission(page);
  const before=await page.locator('.message').allTextContents();
  for(const index of [2,0,1]){
   await nav.getByRole('button').nth(index).click();
   await page.waitForFunction(id=>{const node=document.getElementById(id),box=node?.getBoundingClientRect(),scroll=node?.closest('.nubi-conversation-scroll')?.getBoundingClientRect();return box&&scroll&&box.top>=scroll.top-1&&box.bottom<=scroll.bottom+1;},'chapter-fixture-chapter-'+index);
  }
  await assertSeparated();
  await waitForAdmission(page);
  assert.deepEqual(await page.locator('.message').allTextContents(),before);
  assert(await nav.evaluate(node=>{const box=node.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth;}));
  await captureDesign(page,{path:path.join(dir,'chapters-'+width+'.png'),animations:'disabled'});
  checks.push({scene:'chapters',width,dividers:3,buttons:3,historyPreserved:true});await page.close();
 }
 for(const many of [false,true]){
 const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'reduce'});
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port+'/?integrated&chapters&chapters-long'+(many?'&chapters-many':''));
 const opener=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();
 await page.getByRole('button',{name:'대화 검색',exact:true}).click();await page.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').first().click();
 const nav=page.getByRole('navigation',{name:'챕터 목차'});await nav.waitFor();
 if(many)assert(await nav.evaluate(node=>node.getBoundingClientRect().height<=innerHeight/2),'chapter contents must leave room for the conversation');
 await nav.getByRole('button').first().click();
 await page.waitForFunction(()=>{const node=document.getElementById('chapter-fixture-chapter-0'),box=node?.getBoundingClientRect(),scroll=node?.closest('.nubi-conversation-scroll')?.getBoundingClientRect();return box&&scroll&&box.top>=scroll.top-1&&box.bottom<=scroll.bottom+1;});
 await waitForAdmission(page);
 assert.equal(await page.locator('.message').count(),87);
 await captureDesign(page,{path:path.join(dir,many?'chapters-many.png':'chapters-long.png'),animations:'disabled'});
 checks.push({scene:many?'chapters-many':'chapters-long',messages:86,renderedMessages:87,admissionComplete:true,historyRevealed:true});await page.close();
 }
 for(const width of [1280,440]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?integrated&sidebar-archive');
  const openSidebar=async()=>{const opener=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();};
  await openSidebar();await page.getByRole('status',{name:'읽지 않음',exact:true}).waitFor();
  assert.equal(await page.getByRole('status',{name:'읽지 않음',exact:true}).count(),1);
  assert.equal(await page.locator('.nubi-session-row').first().getAttribute('data-session-id'),'pinned');
  await page.waitForFunction(()=>localStorage.getItem('nubi-pinned-tasks:fixture')===null);
  await page.locator('[data-session-id="pinned"] summary').click();assert(await page.getByRole('button',{name:'고정한 대화 보관',exact:true}).isDisabled());await page.keyboard.press('Escape');
  await page.locator('[data-session-id="unread"] .nubi-session-select').click();
  await openSidebar();await page.waitForFunction(()=>!document.querySelector('[aria-label="읽지 않음"]'));
  const row=page.locator('[data-session-id="unread"]');await row.locator('summary').click();await page.getByRole('button',{name:'새로운 결과 보관',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[data-session-id="unread"]'));
  await page.getByRole('button',{name:'보관함 2',exact:true}).click();await page.locator('[data-session-id="unread"]').waitFor();
  await captureDesign(page,{path:path.join(dir,'archive-'+width+'.png'),animations:'disabled'});
  await page.reload();await openSidebar();await page.getByRole('button',{name:'보관함 2',exact:true}).click();
  await page.locator('[data-session-id="unread"] summary').click();await page.getByRole('button',{name:'새로운 결과 보관 해제',exact:true}).click();
  await page.getByRole('button',{name:'대화로 돌아가기',exact:true}).click();await page.locator('[data-session-id="unread"]').waitFor();
  await page.locator('[data-session-id="unread"] summary').click();await page.getByRole('button',{name:'새로운 결과 고정',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.nubi-session-row')?.dataset.sessionId==='unread');
  await captureDesign(page,{path:path.join(dir,'archive-restored-'+width+'.png'),animations:'disabled'});
  await page.getByRole('button',{name:'보관함 1',exact:true}).click();await page.locator('[data-session-id="archived"] summary').click();await page.getByRole('button',{name:'지난 대화 고정',exact:true}).click();await page.getByText('보관한 대화가 없어요.',{exact:true}).waitFor();await page.getByRole('button',{name:'대화로 돌아가기',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.nubi-session-row')?.dataset.sessionId==='archived');
  const close=page.getByRole('button',{name:'사이드바 접기',exact:true});if(width===440&&await close.count())await close.click();
  await page.getByRole('button',{name:'설정',exact:true}).click();
  const days=page.getByLabel('대화 자동 보관',{exact:true});await days.fill('0');await days.locator('xpath=ancestor::form').getByRole('button',{name:'저장',exact:true}).click();
  await page.getByText('자동 보관을 사용하지 않아요.',{exact:false}).waitFor();
  await captureDesign(page,{path:path.join(dir,'archive-settings-'+width+'.png'),animations:'disabled'});
  checks.push({scene:'archive',width,unreadCleared:true,archiveRestore:true,reloadPreserved:true,newestPinFirst:true,disabledDays:0,pinProtectsArchive:true,pinRestoresArchived:true,rendererPinCopyRemoved:true});await page.close();
 }
 for(const width of [1280,440]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?integrated&outputs');
  const opener=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();
  await page.getByRole('button',{name:'대화 검색',exact:true}).click();await page.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').first().click();
  const cards=page.getByRole('group',{name:'산출물'});await cards.waitFor({timeout:5000});
  assert.equal(await cards.getByRole('button').count(),2);assert.equal(await cards.count(),1);
  assert(await cards.evaluate(node=>node.previousElementSibling?.textContent.includes('확인한 화면과 보고서를 준비했어요.')),'cards follow the answer, not its earlier question or later user message');
  await cards.getByRole('button').first().click();assert.equal(await page.evaluate(()=>window.openedPath),'capture-1.png');
  await cards.getByRole('button').last().focus();await page.keyboard.press('Enter');assert.match(await page.evaluate(()=>window.openedPath),/최종 보고서.md$/);
  console.log('산출물 카드 배치',width,await cards.evaluate(node=>({rect:node.getBoundingClientRect().toJSON(),scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,viewport:innerWidth})));
  await captureDesign(page,{path:path.join(dir,'outputs-'+width+'.png'),animations:'disabled'});
  assert(await cards.evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&node.scrollWidth<=node.clientWidth+1;}),'long filenames must wrap without horizontal overflow');
  await captureDesign(page,{path:path.join(dir,'outputs-'+width+'.png'),animations:'disabled'});checks.push({scene:'outputs',width,cards:2,answerPlacement:true,keyboardOpen:true});await page.close();
 }
 for(const width of [1280,440]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?integrated&side-tasks');
  const opener=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();
  await page.getByRole('button',{name:'대화 검색',exact:true}).click();await page.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').first().click();
  const chips=page.getByRole('group',{name:'다음 작업 제안'});await chips.waitFor({timeout:5000});assert.equal(await chips.locator('.nubi-side-task').count(),2);
  assert(await chips.evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&node.scrollWidth<=node.clientWidth+1;}));
  await captureDesign(page,{path:path.join(dir,'side-tasks-'+width+'.png'),animations:'disabled'});
  await chips.getByRole('button',{name:'오래된 개발 안내 문서와 검사 방법 정리 제안 닫기',exact:true}).click();await page.waitForFunction(()=>window.dismissedSideTask==='side-two');assert.equal(await chips.locator('.nubi-side-task').count(),1);
  const start=chips.getByRole('button',{name:'첨부 시간 초과 처리 보완',exact:true});assert.equal(await start.getAttribute('title'),'확인된 첨부 실패가 안내 목록에서 빠져 있어요.');await start.focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.startedSideTask?.taskId==='side-child');await page.getByRole('button',{name:'시작',exact:true}).waitFor();assert.equal(await page.getByRole('group',{name:'다음 작업 제안'}).count(),0);
  assert((await page.locator('.message').first().innerText()).includes('src/mail.mjs'));
  const reveal=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await reveal.count())await reveal.click();
  const badge=page.locator('[data-session-id="side-child"] .nubi-session-origin');await badge.waitFor();
  assert.equal(await badge.innerText(),'제안');assert.equal(await badge.getAttribute('aria-label'),'에이전트 제안으로 시작한 대화');
  assert(await badge.evaluate(node=>{const r=node.getBoundingClientRect(),row=node.closest('.nubi-session-row').getBoundingClientRect();return r.left>=row.left&&r.right<=row.right&&r.width>0;}));
  await captureDesign(page,{path:path.join(dir,'side-task-origin-'+width+'.png'),animations:'disabled'});checks.push({scene:'side-tasks',width,dismissed:true,newConversationSelected:true,keyboardStart:true});await page.close();
 }
 for(const width of [1280,440]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?integrated&interrupted-retry');
  const opener=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();
  await page.getByRole('button',{name:'대화 검색',exact:true}).click();await page.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').first().click({timeout:5000});
  const resume=page.getByRole('button',{name:'이어서 진행',exact:true});await resume.waitFor({timeout:5000});assert.equal(await resume.count(),1);
  assert(await resume.evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}));
  const approval=page.getByRole('region',{name:'실행 준비 승인'});await approval.waitFor({timeout:5000});assert((await approval.innerText()).includes('node --version')); 
  await captureDesign(page,{path:path.join(dir,'interrupted-'+width+'.png'),animations:'disabled'});
  await resume.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>window.retryResumeCalls?.length===1);
  assert.deepEqual(await page.evaluate(()=>window.retryResumeCalls),[{method:'resumeAgent',taskId:'retry-task'}]);
  assert.equal(await page.evaluate(()=>window.retryStartCalls||0),0);
  assert.equal(await page.evaluate(()=>window.retryPendingState),'proposed');
  assert.equal(await page.evaluate(()=>window.retryUserMessages),1);
  checks.push({scene:'interrupted',width,oneResume:true,keyboardResume:true,pendingApprovalPreserved:true,noNewRequest:true});await page.close();
 }
 for(const width of [1280,440,360]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?integrated&usage');
  const openSidebar=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await openSidebar.count())await openSidebar.click();
  const open=async()=>{await page.locator('[data-session-id="conversation-usage"] summary').click();await page.getByRole('button',{name:'사용량 확인 사용량',exact:true}).click();};
  await open();const dialog=page.getByRole('dialog',{name:'이 대화의 사용량',exact:true});await dialog.locator('tbody tr').first().waitFor();assert.equal(await dialog.locator('tbody tr').count(),6);assert.match(await dialog.innerText(),/모델 호출\s+8회/);assert.match(await dialog.innerText(),/400\*/);await dialog.getByText('집계 기준',{exact:true}).click();assert.match(await dialog.innerText(),/30일/);assert.match(await dialog.innerText(),/분석에는 문서 처리와 위키 갱신이 포함/);assert.doesNotMatch(await dialog.innerText(),/비용|\$/);
  assert(await dialog.evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&node.scrollWidth<=node.clientWidth+1;}),'usage dialog stays in viewport');
  await captureDesign(page,{path:path.join(dir,'usage-'+width+'.png'),animations:'disabled'});
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
  if(width===1280){await page.evaluate(()=>{window.usageFailure=true;});await open();await dialog.getByRole('alert').waitFor();await page.evaluate(()=>{window.usageFailure=false;});await dialog.getByRole('button',{name:'다시 시도'}).click();await dialog.locator('tbody tr').first().waitFor();}
  checks.push({scene:'conversation-usage',width,purposes:6,partialTokens:true,missingTokens:true,noPrice:true});await page.close();
 }
 }
 if(!DESKTOP_FEATURES.workflows)checks.push({scene:'routines',skipped:'workflows_feature_off'});// routines are off with workflows in this release (design light-flow §5.1)
 else for(const width of [1280,440,360]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?integrated&routines');
  await page.getByRole('button',{name:'설정',exact:true}).click();await page.getByRole('button',{name:'루틴',exact:true}).click();await page.getByRole('button',{name:'루틴 추가',exact:true}).click();
  const form=page.getByRole('dialog',{name:'루틴 설정',exact:true});assert.equal(await form.locator('fieldset.nubi-settings-section').count(),3,'routine form separates task, schedule and execution');assert.equal(await form.locator('.cx-panel-footer .cx-button--primary').count(),1,'save action stays in the shared footer');await assertDialogChrome(form);await form.getByLabel('이름',{exact:true}).fill('주간 자료 점검');await form.getByLabel('주기',{exact:true}).selectOption('weekly');await form.getByLabel('요일',{exact:true}).selectOption('2');await form.getByLabel('시각',{exact:true}).fill('08:30');await form.getByLabel('요청',{exact:true}).fill('이번 주 자료의 변경 사항을 정리해 주세요.');
  await assertDialogIdentity(form);
  assert(await form.evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&node.scrollWidth<=node.clientWidth+1;}),'routine form fits viewport');
  await captureDesign(page,{path:path.join(dir,'routines-form-'+width+'.png'),animations:'disabled'});await form.getByRole('button',{name:'저장',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'루틴',exact:true});await assertDialogIdentity(dialog);await dialog.getByText(/매주 화요일 08:30/).waitFor();await dialog.getByRole('switch',{name:'주간 자료 점검',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[role="switch"][aria-checked="false"]'));
  await dialog.getByRole('button',{name:'주간 자료 점검 수정',exact:true}).click();assert.equal(await form.getByLabel('시각',{exact:true}).inputValue(),'08:30');assert.equal(await form.getByRole('switch',{name:'예약 실행'}).getAttribute('aria-checked'),'false');await form.getByLabel('이름',{exact:true}).fill('주간 업무 점검');await form.getByRole('button',{name:'저장',exact:true}).click();
  await dialog.getByRole('button',{name:'주간 업무 점검 삭제',exact:true}).click();const confirm=page.getByRole('alertdialog',{name:'루틴을 삭제할까요?',exact:true});await confirm.waitFor();assert(await confirm.evaluate(node=>getComputedStyle(node).getPropertyValue('--nubi-dialog-action').trim()===getComputedStyle(node).getPropertyValue('--deck-red').trim()),'deletion uses danger action token');await confirm.getByRole('button',{name:'취소',exact:true}).click();await dialog.getByRole('switch',{name:'주간 업무 점검'}).waitFor();await dialog.getByRole('button',{name:'주간 업무 점검 삭제',exact:true}).click();await confirm.getByRole('button',{name:'삭제',exact:true}).click();await dialog.getByText('반복할 작업과 시각을 정해 주세요.').waitFor();
  await page.evaluate(()=>{window.routineFailure=true;});await dialog.getByRole('alert').waitFor({timeout:10000});await assertDialogIdentity(dialog);
  await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});checks.push({scene:'routines',width,weekly:true,edit:true,toggle:true,confirmedDelete:true});await page.close();
 }
 for(const width of [1280,440]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?integrated&after-edit-failure');
  const reveal=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await reveal.count())await reveal.click();
  await page.getByRole('button',{name:'검사 준비 실패',exact:true}).click();const warning=page.locator('section.nubi-results[role="alert"]');await warning.waitFor();
  assert.match(await warning.innerText(),/src\/app.mjs/);assert.match(await warning.innerText(),/설정에서 편집 뒤 검사를 꺼/);
  await warning.getByRole('button',{name:'검사 다시 준비',exact:true}).click();await page.waitForFunction(()=>window.afterEditRetries===1);
  await page.locator('.nubi-feedback-toast').waitFor();assert(await warning.evaluate(node=>node.scrollWidth<=node.clientWidth+1));
  await page.screenshot({path:path.join(dir,'after-edit-failure-'+width+'.png')});checks.push({scene:'after-edit-failure',width,pathVisible:true,retryFailureToast:true});await page.close();
 }
 }
 assert.deepEqual(errors,[]);
 await writeFile(path.join(dir,'result.json'),JSON.stringify({checks,errors,scope:'Synthetic Workbench fixture on macOS; no live model or Windows verification.'},null,2));
 console.log('PASS:',checks.length,'scenes:',[...new Set(checks.map(check=>check.scene))].join(', '));
}finally{
 let deadline;
 const child=browserServer?.process();
 // Chromium helpers can retain inherited pipe descriptors after the actual
 // browser has exited. Release only this owned child's pipes, and only after
 // its exit, so Playwright's close event and temporary-directory cleanup finish.
 const releaseExitedPipes=()=>{if(child&&(child.exitCode!==null||child.signalCode!==null))for(const stream of child.stdio||[])stream?.destroy?.();};
 child?.once('exit',releaseExitedPipes);
 try{
  const stopped=browserServer?.kill();releaseExitedPipes();
  await Promise.race([stopped,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('wave2_browser_cleanup_timeout')),15000);})]);
 }finally{
  clearTimeout(deadline);child?.removeListener('exit',releaseExitedPipes);
  const closed=new Promise(resolve=>server.close(resolve));server.closeAllConnections();await closed;stopBuildService();
 }
}
