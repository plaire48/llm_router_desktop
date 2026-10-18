import {build} from 'esbuild';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/progress-display-2026-10-15');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

let browser;const errors=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const p=await browser.newPage({viewport:{width:1280,height:950}});p.on('pageerror',e=>errors.push(e.message));
 const origin='http://127.0.0.1:'+server.address().port;
 async function selectTask(){
  const opener=p.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();
  await p.getByRole('button',{name:'대화 검색',exact:true}).click();await p.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').first().click();
 }
 async function settings(){await p.getByRole('button',{name:'설정',exact:true}).click();return p.getByRole('dialog',{name:'설정',exact:true});}
 await p.goto(origin+'/?integrated&progress&activity-readability&timeline');await selectTask();await p.locator('.nubi-agent-activity').waitFor();
 let dialog=await settings();const toggle=dialog.getByRole('switch',{name:'진행 과정 표시'});
 assert.equal(await toggle.getAttribute('aria-checked'),'true');await toggle.click();
 await p.screenshot({path:path.join(dir,'settings-1280.png'),animations:'disabled'});
 await p.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 assert.equal(await p.locator('.nubi-agent-activity').count(),0);assert.equal(await p.locator('.nubi-analysis-history').count(),0);
 await p.getByText(/\d+초 동안 작업 중/).waitFor();
 const timeBefore=await p.locator('.nubi-working-status').textContent();
 await p.waitForFunction(before=>document.querySelector('.nubi-working-status')?.textContent!==before,timeBefore);
 assert.equal(await p.locator('.nubi-working-status').evaluate(el=>getComputedStyle(el,'::before').animationName),'nubi-progress-breathe');
 await p.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await p.locator('.nubi-working-status').evaluate(el=>getComputedStyle(el,'::before').animationName),'none');
 await p.emulateMedia({reducedMotion:'no-preference'});
 await p.locator('.nubi-working-status').screenshot({path:path.join(dir,'working-time.png')});
 assert(await p.getByText('합성 화면 검증 결과입니다.',{exact:true}).isVisible());
 await p.evaluate(()=>window.activityState('review'));
 await p.getByText(/\d+초 동안 작업 중/).waitFor({state:'hidden'});
 await p.screenshot({path:path.join(dir,'answer-only-1280.png'),animations:'disabled'});
 await p.reload();await selectTask();assert.equal(await p.locator('.nubi-workbench').getAttribute('data-show-progress'),'false');
 assert.equal(await p.locator('.nubi-agent-activity').count(),0);
 await p.setViewportSize({width:440,height:900});dialog=await settings();await p.screenshot({path:path.join(dir,'settings-440.png'),animations:'disabled'});
 assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth));
 await dialog.getByRole('switch').click();await p.keyboard.press('Escape');await p.locator('.nubi-agent-activity').waitFor();
 await settings();await p.getByRole('switch',{name:'진행 과정 표시'}).click();await p.keyboard.press('Escape');
 for(const kind of ['question','command']){
  await p.goto(origin+'/?integrated&modals&toolbar&decision='+kind);await selectTask();
  const form=p.locator(kind==='question'?'.nubi-question-inline':'.nubi-approval-form');await form.waitFor();
  assert(await form.getByRole('button',{name:kind==='question'?'답변 보내기':'승인',exact:true}).isVisible());
  assert.equal(await p.evaluate(()=>window.decisionCalls.length),0);
 }
 await p.goto(origin+'/?integrated&review-failure=review_schema_invalid');await selectTask();
 await p.getByRole('region',{name:'분석 결과 검토'}).getByText('결과 검토를 마치지 못했어요',{exact:true}).waitFor();
 await p.goto(origin+'/?integrated&proposal-review=applied');await selectTask();
 assert.equal(await p.locator('.nubi-workbench').getAttribute('data-show-progress'),'false');await p.locator('.nubi-applied-row').waitFor();
 await p.locator('.nubi-applied-row').click();assert.deepEqual(await p.evaluate(()=>window.appliedComparison),{path:'src/example.mjs',taskId:'proposal-task'});
 await p.screenshot({path:path.join(dir,'applied-progress-off-440.png'),animations:'disabled'});
 await p.reload();await selectTask();await p.locator('.nubi-applied-row').waitFor();assert.equal(await p.locator('.nubi-workbench').getAttribute('data-show-progress'),'false');
 await settings();await p.getByRole('switch',{name:'진행 과정 표시'}).click();await p.keyboard.press('Escape');await p.locator('.nubi-applied-row').waitFor();
 assert.deepEqual(errors,[]);
 console.log('PASS: default ON, immediate toggle, reload persistence, 1280/440px settings, answer preserved, questions/approvals/review failure/applied diffs visible with process hidden. Synthetic Workbench.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
