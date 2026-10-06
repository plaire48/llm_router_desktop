import {build} from 'esbuild';
import {assertDesktopDialog} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/modal-review');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

let browser,p;const checks=[],errors=[];
const origin='http://127.0.0.1:'+server.address().port;
// The conversation list lives in the sidebar; its search button opens the '대화 검색' dialog (2026-10-02).
async function openSidebar(){const opener=p.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();}
async function history(){await openSidebar();await p.getByRole('button',{name:'대화 검색',exact:true}).click();}
// In the compact layout the sidebar is an overlay the user opened; closing a dialog returns to it, so the check closes it before using the composer.
async function closeSidebar(){const closer=p.getByRole('button',{name:'사이드바 접기',exact:true});if(await closer.count()&&await p.locator('.nubi-sidebar[data-open="true"]').count())await closer.click();}
async function selectTask(){await history();await p.getByRole('dialog',{name:'대화 검색'}).locator('.nubi-history-item').filter({hasText:'문맥 사용량 화면 검증'}).click();}
async function inspect(name,file,large){
 const dialog=p.getByRole(name==='대화를 삭제할까요?'?'alertdialog':'dialog',{name,exact:true});
 await assertDesktopDialog(dialog,{large});
 const facts=await dialog.evaluate(root=>{const r=root.getBoundingClientRect();return {bounds:r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,inset:[...root.querySelectorAll(':scope > .cx-panel-header,:scope > .cx-panel-body,:scope > .cx-panel-footer')].map(e=>getComputedStyle(e).paddingLeft),fields:[...root.querySelectorAll('input,select,textarea')].filter(e=>e.checkVisibility()&&e.type!=='checkbox').map(e=>({name:e.labels?.length||e.getAttribute('aria-label'),size:getComputedStyle(e).fontSize})),smallText:[...root.querySelectorAll('p,label')].filter(e=>e.checkVisibility()&&e.textContent.trim()).map(e=>getComputedStyle(e).fontSize)};});
 assert(facts.bounds,name+' stays inside the viewport');assert(new Set(facts.inset).size===1,name+' aligns title, body and footer');assert(facts.fields.every(e=>e.name&&e.size===(large?'16px':'14px')),name+' uses labelled, readable inputs');assert(facts.smallText.every(size=>parseFloat(size)>=(large?16:14)),name+' keeps instructions at the body scale');
 for(let i=0;i<18;i++){await p.keyboard.press(i<14?'Tab':'Shift+Tab');assert(await dialog.evaluate(root=>root.contains(document.activeElement)),name+' traps keyboard focus at '+i+' '+JSON.stringify(await p.evaluate(()=>({active:document.activeElement?.tagName,inert:[...document.querySelectorAll('[inert]')].map(e=>e.className),controls:[...document.querySelectorAll('.deck-dialog button,.deck-dialog input,.deck-dialog summary')].map(e=>({tag:e.tagName,name:e.getAttribute('aria-label')||e.textContent.slice(0,25),disabled:e.disabled,visible:e.checkVisibility(),tab:e.tabIndex,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}))}))));}
 await dialog.locator('.cx-panel-header h2').focus();await p.screenshot({path:path.join(dir,file+'.png'),animations:'disabled'});checks.push(`${name}: ${large?'large':'normal'} text, ${p.viewportSize().width}px, aligned spacing, named controls, focus and bounds`);
 return dialog;
}
try{
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});p=await browser.newPage({viewport:{width:1280,height:950}});p.on('pageerror',e=>errors.push(e.message));
 // The integrated layout is the Electron Workspace: rail navigation with the settings button, the conversation sidebar with its search, the mail page and the composer's skill menu (the fixture passes workspaceView, which the navigation needs). The large-text toggle left the Workbench (2026-10-02).
 for(const variant of [{width:1280},{width:440}]){
  await p.setViewportSize({width:variant.width,height:950});await p.goto(origin+'/?context&modals&integrated');
  await selectTask();
  const suffix=`${variant.width}`;
  await p.getByRole('button',{name:'설정',exact:true}).click();await inspect('설정','settings-'+suffix);await p.keyboard.press('Escape');await p.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='설정');
  await p.getByRole('button',{name:'위키',exact:true}).click();await inspect('프로젝트 자료','library-'+suffix);
  // The mail page replaced the mail dialog (2026-10-02): its '메일 연결' opens the account dialog, and Escape returns focus to that control.
  await p.getByRole('button',{name:'사내 메일',exact:true}).click();await p.getByRole('button',{name:'메일 연결',exact:true}).click();await p.getByLabel('아이디',{exact:true}).waitFor();await inspect('메일 설정','mail-'+suffix);await p.keyboard.press('Escape');await p.waitForFunction(()=>document.activeElement?.classList.contains('nubi-mail-connect-link'));
  await selectTask();
  await p.getByRole('button',{name:'스킬 관리',exact:true}).click();await p.getByRole('dialog',{name:'스킬 목록',exact:true}).getByRole('button',{name:/^커스텀 관리/}).click();await p.getByText('보고서 작성',{exact:true}).waitFor();await inspect('스킬 관리','skills-'+suffix);await p.keyboard.press('Escape');await p.getByRole('dialog',{name:'스킬 관리',exact:true}).waitFor({state:'hidden'});
  await history();await inspect('대화 검색','history-'+suffix);await p.keyboard.press('Escape');await closeSidebar();
  await p.getByRole('button',{name:'컨텍스트 사용량',exact:true}).click();await inspect('컨텍스트 사용량','context-'+suffix);await p.keyboard.press('Escape');
  await p.getByRole('button',{name:'모델 변경',exact:true}).click();await inspect('모델 선택','models-'+suffix);
  await p.getByRole('tab',{name:'FabriX',exact:true}).click();await p.getByRole('button',{name:'연결',exact:true}).click();await inspect('FabriX 연결','fabrix-'+suffix);await p.keyboard.press('Escape');await p.getByRole('dialog',{name:'모델 선택'}).waitFor();await p.keyboard.press('Escape');
  // Reload before checking the approval menu and destructive confirmation with the connected fixture provider.
  await p.goto(origin+'/?context&modals&integrated');await selectTask();
  await p.getByRole('button',{name:/매번 확인/}).click();const menu=p.getByRole('menu',{name:'승인 방식'});assert(await menu.locator('small').evaluateAll(es=>es.every(e=>parseFloat(getComputedStyle(e).fontSize)>=(document.querySelector('.nubi-workbench').dataset.largeText==='true'?16:14))));assert(await menu.evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}),'approval menu stays fully inside the viewport');await p.waitForFunction(()=>document.activeElement?.getAttribute('aria-checked')==='true');await p.keyboard.press('ArrowDown');assert.equal(await menu.getByRole('menuitemradio',{name:/파일 자동 반영/}).evaluate(e=>e===document.activeElement),true);await p.screenshot({path:path.join(dir,'approval-'+suffix+'.png')});await p.keyboard.press('Escape');assert(await p.getByRole('button',{name:/매번 확인/}).evaluate(e=>e===document.activeElement));
  await openSidebar();await p.getByRole('button',{name:'문맥 사용량 화면 검증 삭제',exact:true}).click();await inspect('대화를 삭제할까요?','delete-'+suffix);assert.match(await p.getByRole('alertdialog').innerText(),/프로젝트에 반영한 파일은 그대로/);await p.keyboard.press('Escape');assert.equal(await p.getByRole('button',{name:'문맥 사용량 화면 검증 삭제',exact:true}).count(),1);
  checks.push('nested navigation restores the invoking screen and control; FabriX returns to model selection; Escape cancels deletion');
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({checks,errors,scope:'actual shared Workbench components with synthetic data in Chrome; real Theia pickers verified separately'},null,2));console.log(JSON.stringify({passed:checks.length,checks},null,2));
}catch(error){await p?.screenshot({path:path.join(dir,'failure.png')}).catch(()=>{});await writeFile(path.join(dir,'failure.txt'),error.stack+'\n--- page errors ---\n'+JSON.stringify(errors,null,1)+'\n--- body ---\n'+await p?.locator('body').innerText()+'\n--- aria ---\n'+await p?.locator('body').ariaSnapshot());throw error;}
finally{await browser?.close();await new Promise(r=>server.close(r));}
