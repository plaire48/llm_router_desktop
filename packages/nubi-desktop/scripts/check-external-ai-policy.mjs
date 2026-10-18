import {build} from 'esbuild';
import {assertDesktopDialog,assertDialogChrome} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/external-ai-policy-2026-10-15');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

let browser;const errors=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));
 const origin='http://127.0.0.1:'+server.address().port;
 for(const width of [1280,440]){
  await p.setViewportSize({width,height:950});await p.goto(origin+'/?integrated&toolbar&security-policy');
  await p.evaluate(()=>localStorage.removeItem('nubi.workspace.external-ai-policy.dismissed.v1'));await p.reload();
  await p.locator('.aipro-login').getByRole('button',{name:'ChatGPT',exact:true}).click();
  const dialog=p.getByRole('dialog',{name:'외부 AI 보안 안내',exact:true});await dialog.waitFor();await assertDesktopDialog(dialog);await assertDialogChrome(dialog);
  assert.equal(await p.evaluate(()=>window.policyLoginCalls?.length||0),0);
  assert.match(await dialog.textContent(),/대화 로그는 외부 서버에 저장되나, SDS 전용 테넌트로 분리된 환경에서 관리됩니다\./);
  assert.doesNotMatch(await dialog.textContent(),/테넌트 이용 시/);
  assert.match(await dialog.textContent(),/업무상 불가피한 경우 가명 처리 또는 비식별 처리 후 입력해 주시기 바랍니다\./);
  assert.deepEqual(await dialog.locator('.nubi-policy-heading h3').allTextContents(),['Q1. 개인정보(이름, 이메일, 연락처 등)를 입력해도 되나요?','Q2. AI와의 대화 내용은 어디에 저장되나요?']);
  assert.equal(await dialog.locator('.nubi-policy-section').count(),2);
  assert.equal(await dialog.getByRole('link',{name:'보안 정책 및 FAQ'}).getAttribute('href'),'https://sdsaiuc.sds.samsung.net/post/cmqj8pr3n053pu64okt6yhe7a');
  assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth));
  await p.screenshot({path:path.join(dir,'policy-'+width+'.png'),animations:'disabled'});
  await dialog.getByRole('switch',{name:'다시 보지 않기'}).check();await dialog.getByRole('button',{name:'취소',exact:true}).click();
  assert.equal(await p.evaluate(()=>localStorage.getItem('nubi.workspace.external-ai-policy.dismissed.v1')),null);
  assert.equal(await p.evaluate(()=>window.policyLoginCalls?.length||0),0);
  await p.locator('.aipro-login').getByRole('button',{name:'ChatGPT',exact:true}).click();
  await dialog.getByRole('button',{name:'확인하고 연결',exact:true}).click();
  await p.waitForFunction(()=>window.policyLoginCalls?.length===1);
  assert.equal(await p.evaluate(()=>localStorage.getItem('nubi.workspace.external-ai-policy.dismissed.v1')),null);
  await p.reload();await p.locator('.aipro-login').getByRole('button',{name:'ChatGPT',exact:true}).click();
  await dialog.getByRole('switch',{name:'다시 보지 않기'}).check();await dialog.getByRole('button',{name:'확인하고 연결',exact:true}).click();
  await p.waitForFunction(()=>window.policyLoginCalls?.length===1);
  await p.reload();await p.locator('.aipro-login').getByRole('button',{name:'ChatGPT',exact:true}).click();
  await p.waitForFunction(()=>window.policyLoginCalls?.length===1);assert.equal(await dialog.count(),0);
 }
 await p.goto(origin+'/?integrated&progress');
 const opener=p.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();
 await p.getByRole('button',{name:'대화 검색',exact:true}).click();await p.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').first().click();
 await p.locator('.message-assistant .nubi-answer-review .nubi-review-evidence').waitFor();
 assert.equal(await p.locator('.nubi-conversation-content>.nubi-enter>.nubi-review-slot').count(),0,'completed review is not appended to transcript foot');
 assert.equal(await p.locator('.nubi-review-evidence').count(),1);
 await p.locator('.nubi-review-evidence summary').click();await p.getByText('선택한 원문과 답변의 근거를 대조했습니다.',{exact:true}).waitFor();
 for(const width of [1280,440]){
  await p.setViewportSize({width,height:950});await p.goto(origin+'/?integrated&command-order');
  const reveal=p.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await reveal.count())await reveal.click();
  await p.locator('.nubi-session-select').filter({hasText:'명령 순서 확인'}).click();
  const records=p.locator('.nubi-command-record');await records.first().waitFor();
  assert.deepEqual(await records.locator('summary strong').allTextContents(),['첫 번째 실행','두 번째 실행']);
  assert.equal(await p.locator('.nubi-current-decisions').getByRole('button',{name:'승인',exact:true}).count(),1);
  assert.equal(await p.locator('.nubi-setup-summary .nubi-terminal').count(),1,'only pending command has an inline approval preview');
  await records.first().locator('summary').click();await records.first().getByRole('button',{name:'터미널 열기'}).click();
  assert.equal(await p.evaluate(()=>window.openedTerminal.processId),'process-first');
  await records.first().locator('summary').click();assert.equal(await records.first().getAttribute('open'),null);
  await p.screenshot({path:path.join(dir,'commands-'+width+'.png'),animations:'disabled'});
 }
 assert.deepEqual(errors,[]);console.log('PASS: notice before login, cancel without login or suppression, continue, opt-out persistence, policy link, 1280/440px; review belongs to answer once. Synthetic provider.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
