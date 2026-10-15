import {build} from 'esbuild';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/approval-list-2026-10-16');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/approval-list-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{'process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(dir+path.sep))throw Error();res.setHeader('content-type',({'.css':'text/css','.js':'text/javascript','.woff2':'font/woff2','.svg':'image/svg+xml'})[path.extname(file)]||'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;const errors=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 for(const width of [1100,440,360]){
  await page.setViewportSize({width,height:800});await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByText('결재 서버가 요청 형식을 거부했어요.').waitFor();assert.equal(await page.getByRole('button',{name:'로그인',exact:true}).count(),0);
  const type=await page.locator('.nubi-approval-history').evaluate(el=>({title:getComputedStyle(el.querySelector('header>strong')).fontSize,weight:getComputedStyle(el.querySelector('header>strong')).fontWeight,body:getComputedStyle(el.querySelector('.nubi-approval-notice')).fontSize,font:getComputedStyle(el.querySelector('.nubi-approval-notice')).fontFamily,button:el.querySelector('.nubi-approval-notice button').getBoundingClientRect().height,overflow:el.scrollWidth>el.clientWidth}));assert.equal(type.title,'18px');assert.equal(type.weight,'600');assert.equal(type.body,'15px');assert.match(type.font,/Pretendard/);assert(type.button>=40&&!type.overflow);
  await page.screenshot({path:path.join(dir,`request-error-${width}.png`)});
  await page.evaluate(()=>window.approvalFailure=null);await page.getByRole('button',{name:'다시 불러오기',exact:true}).click();await page.getByRole('button',{name:'검토용 결재 문서 1',exact:true}).click();await page.getByText('확인할 결재 내용',{exact:true}).waitFor();
  await page.getByRole('button',{name:'다음 결재 페이지'}).click();await page.getByRole('button',{name:'검토용 결재 문서 2',exact:true}).waitFor();
  assert(await page.getByRole('button',{name:'다음 결재 페이지'}).isDisabled());
  await page.evaluate(()=>{window.documentFailure='mail_portal_unavailable';window.failureStage='document';window.failureStatus=502;});await page.getByRole('button',{name:'검토용 결재 문서 2',exact:true}).click();await page.getByText('본문 조회 실패',{exact:false}).waitFor();await page.getByText('HTTP 502',{exact:true}).waitFor();
  assert.equal(await page.locator('.nubi-approval-list tbody tr').count(),1);await page.screenshot({path:path.join(dir,`body-error-${width}.png`)});
  const listCalls=await page.evaluate(()=>window.approvalCalls.filter(c=>c.action==='approvals').length);
  await page.evaluate(()=>window.documentFailure=null);await page.getByRole('button',{name:'다시 불러오기',exact:true}).click();await page.getByText('확인할 결재 내용',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.approvalCalls.filter(c=>c.action==='approvals').length),listCalls);
  assert.deepEqual(await page.evaluate(()=>window.approvalCalls.filter(c=>c.action==='approvalRead').slice(-2).map(c=>c.id)),['item2','item2']);
  await page.evaluate(()=>{window.documentFailure='mail_approval_parse';window.failureStage='parse';window.failureStatus=null;});await page.getByRole('button',{name:'검토용 결재 문서 2',exact:true}).click();await page.getByText('문서 해석 실패',{exact:true}).waitFor();assert.equal(await page.getByText('HTTP',{exact:false}).count(),0);
  await page.evaluate(()=>{window.documentFailure=null;window.failureStage='list';window.failureStatus=502;});
  await page.evaluate(()=>window.approvalFailure='mail_portal_unavailable');await page.getByRole('button',{name:'결재 새로고침'}).click();await page.getByText('결재 서버 오류예요. 잠시 후 다시 시도해 주세요.').waitFor();assert.equal(await page.getByRole('button',{name:'로그인',exact:true}).count(),0);
  await page.evaluate(()=>{window.approvalFailure='mail_portal_identity';window.failureStage='identity';window.failureStatus=null;});await page.getByRole('button',{name:'다시 불러오기',exact:true}).click();await page.getByText('사용자 확인 실패',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'로그인',exact:true}).count(),0);await page.getByText('로그인은 유지돼요. 결재 사용자 정보를 다시 확인해 주세요.',{exact:true}).waitFor();await page.screenshot({path:path.join(dir,`identity-retry-${width}.png`)});
  await page.evaluate(()=>{window.approvalFailure='mail_portal_approval_login';window.failureStage='list';window.failureStatus=401;});await page.getByRole('button',{name:'결재 새로고침',exact:true}).click();await page.getByRole('button',{name:'로그인',exact:true}).click();assert.equal(await page.evaluate(()=>window.loginClicks),1);
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({passed:true,widths:[1100,440,360],checks:['retry without login','document read','same-document retry without list reload','parse-stage diagnosis','HTTP diagnosis','pagination','service error preserves rows','expired session login'],liveCompanyVerified:false},null,2));console.log('Approval list retry, paging, body and login guidance passed at 1100/440/360px');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
