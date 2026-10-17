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
  await page.getByRole('button',{name:'제목 필터',exact:true}).click();
  await page.getByRole('textbox',{name:'제목에 포함된 단어'}).fill('검토용');
  await page.getByRole('button',{name:'필터 적용',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.nubi-approval-list tbody tr').length===2);
  await page.screenshot({path:path.join(dir,`filtered-${width}.png`)});
  await page.getByRole('button',{name:'결재 검색 조건 초기화'}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.nubi-approval-list tbody tr').length===20);
  await page.getByRole('button',{name:'다음 결재 페이지'}).click();await page.getByRole('button',{name:'검토용 결재 문서 2',exact:true}).waitFor();
  assert(await page.getByRole('button',{name:'다음 결재 페이지'}).isDisabled());
  await page.evaluate(()=>{window.documentFailure='mail_portal_unavailable';window.failureStage='document';window.failureStatus=502;});await page.getByRole('button',{name:'검토용 결재 문서 2',exact:true}).click();await page.getByText('본문 조회 실패',{exact:false}).waitFor();await page.getByText('HTTP 502',{exact:true}).waitFor();
  assert.equal(await page.locator('.nubi-approval-list tbody tr').count(),20);await page.screenshot({path:path.join(dir,`body-error-${width}.png`)});
  const listCalls=await page.evaluate(()=>window.approvalCalls.filter(c=>c.action==='approvals').length);
  await page.evaluate(()=>window.documentFailure=null);await page.getByRole('button',{name:'다시 불러오기',exact:true}).click();await page.getByText('확인할 결재 내용',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.approvalCalls.filter(c=>c.action==='approvals').length),listCalls);
  assert.deepEqual(await page.evaluate(()=>window.approvalCalls.filter(c=>c.action==='approvalRead').slice(-2).map(c=>c.id)),['item2','item2']);
  await page.evaluate(()=>{window.documentFailure='mail_approval_parse';window.failureStage='parse';window.failureStatus=null;});await page.getByRole('button',{name:'검토용 결재 문서 2',exact:true}).click();await page.getByText('문서 해석 실패',{exact:true}).waitFor();assert.equal(await page.getByText('HTTP',{exact:false}).count(),0);
  await page.evaluate(()=>{window.documentFailure=null;window.failureStage='list';window.failureStatus=502;});
  await page.evaluate(()=>window.approvalFailure='mail_portal_unavailable');await page.getByRole('button',{name:'결재 새로고침'}).click();await page.getByText('결재 서버 오류예요. 잠시 후 다시 시도해 주세요.').waitFor();assert.equal(await page.getByRole('button',{name:'로그인',exact:true}).count(),0);
  await page.evaluate(()=>{window.approvalFailure='mail_portal_identity';window.failureStage='identity';window.failureStatus=null;});await page.getByRole('button',{name:'다시 불러오기',exact:true}).click();await page.getByText('사용자 확인 실패',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'로그인',exact:true}).count(),0);await page.getByText('결재 사용자 ID를 찾지 못했어요. 메일 연결은 유지돼요.',{exact:true}).waitFor();await page.screenshot({path:path.join(dir,`identity-retry-${width}.png`)});
  await page.evaluate(()=>{window.approvalFailure='mail_portal_approval_login';window.failureStage='list';window.failureStatus=401;});await page.getByRole('button',{name:'결재 새로고침',exact:true}).click();await page.getByRole('button',{name:'로그인',exact:true}).click();assert.equal(await page.evaluate(()=>window.loginClicks),1);
 }
 await page.setViewportSize({width:1100,height:800});await page.goto(`http://127.0.0.1:${server.address().port}/?performance`);
 await page.locator('.nubi-approval-list tbody tr').first().waitFor();
 await page.evaluate(()=>{window.titleMutations=0;const body=document.querySelector('.nubi-approval-list tbody');new MutationObserver(()=>window.titleMutations++).observe(body,{subtree:true,characterData:true});});
 await page.locator('.nubi-approval-list tbody tr button').first().click();await page.getByText('확인할 결재 내용',{exact:true}).waitFor();
 await page.waitForFunction(()=>window.approvalCalls.filter(c=>c.action==='approvalTitle').length===20&&!document.querySelector('[aria-label="결재 제목 확인 중"]'));
 assert.equal(await page.evaluate(()=>window.approvalCalls.filter(c=>c.action==='approvals').length),1,'parent rendering must not reload the list');
 assert.equal(await page.evaluate(()=>window.approvalCalls.filter(c=>c.action==='approvalRead').length),1);
 const documentBounds=await page.locator('.nubi-approval-document').boundingBox();assert(documentBounds.y<800,'selected document must not be pushed below all 60 rows');
 const titleMutations=await page.evaluate(()=>window.titleMutations);assert(titleMutations<=20,`title updates must be batched: ${titleMutations}`);
 await page.getByLabel('결재 검색',{exact:true}).fill('문서 59');
 await page.getByRole('button',{name:'검토용 결재 문서 59',exact:true}).waitFor();
 assert.equal(await page.locator('.nubi-approval-list tbody tr').count(),1);
 assert.equal(await page.locator('.nubi-approval-list mark').textContent(),'문서 59');
 assert.equal(await page.evaluate(()=>window.approvalCalls.filter(c=>c.action==='approvals').length),1);
 await page.getByRole('button',{name:'결재 검색 조건 초기화'}).click();
 await page.getByRole('button',{name:'다음 결재 페이지'}).click();
 await page.getByRole('button',{name:'검토용 결재 문서 20',exact:true}).waitFor();
 await page.getByRole('button',{name:'상신 필터',exact:true}).click();
 await page.getByRole('radio',{name:'날짜 미확인',exact:true}).check();
 await page.getByRole('button',{name:'필터 적용',exact:true}).click();
 await page.getByText('검색 결과가 없어요.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'결재 검색 조건 초기화'}).click();
 await page.getByRole('button',{name:'검토용 결재 문서 0',exact:true}).waitFor();
 assert(await page.getByRole('button',{name:'이전 결재 페이지'}).isDisabled());
 await page.getByRole('button',{name:'검토용 결재 문서 0',exact:true}).click();
 await page.getByText('확인할 결재 내용',{exact:true}).waitFor();
 await page.getByLabel('결재 페이지 설정',{exact:true}).click();
 await page.getByRole('combobox',{name:'페이지당 결재 수',exact:true}).click();
 await page.getByRole('option',{name:'10개씩',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.nubi-approval-list tbody tr').length===10);
 await page.getByLabel('결재 페이지',{exact:true}).fill('6');
 await page.getByLabel('결재 페이지',{exact:true}).press('Enter');
 await page.getByRole('button',{name:'검토용 결재 문서 50',exact:true}).waitFor();
 await page.getByRole('combobox',{name:'결재 정렬',exact:true}).click();
 await page.getByRole('option',{name:'제목 내림차순',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('.nubi-approval-list tbody tr strong')?.textContent==='검토용 결재 문서 59');
 await page.getByLabel('결재 페이지 설정',{exact:true}).click();
 await page.screenshot({path:path.join(dir,'pagination-settings.png')});
 await page.getByRole('button',{name:'결재 검색 조건 초기화'}).click();
 await page.getByRole('button',{name:'검토용 결재 문서 0',exact:true}).waitFor();
 await page.screenshot({path:path.join(dir,'hydration-60.png')});console.log(JSON.stringify({rows:60,initialTitleRequests:20,titleMutationBatches:titleMutations,initialListRequests:1,initialDocumentRequests:1}));
 const comparison={};
 for(const width of [1100,440]){
  await page.setViewportSize({width,height:800});
  for(const kind of ['mail','approval','wiki','workspace','document']){
   await page.evaluate(()=>{localStorage.setItem('nubi-approval-page-size','20');localStorage.setItem('nubi-mail-page-size-v1','20');});
   await page.goto(`http://127.0.0.1:${server.address().port}/?compare=${kind}`);
   await page.locator('tbody tr').first().waitFor();
   await page.mouse.move(0,0);
   comparison[kind+width]=await page.locator('table').evaluate(el=>{const row=el.querySelector('tbody tr'),cell=el.querySelector('th')||el.querySelector('td'),style=getComputedStyle(cell);return {rowHeight:row.getBoundingClientRect().height,headerHeight:cell.getBoundingClientRect().height,font:style.fontFamily,fontSize:style.fontSize,fontWeight:style.fontWeight,background:style.backgroundColor,padding:style.padding};});
   await page.screenshot({path:path.join(dir,`compare-${kind}-${width}.png`)});
   if(kind==='workspace'){
    const pager=await page.locator('.nubi-collection-pagination').boundingBox();assert(pager.x>=0&&pager.x+pager.width<=width,'shared pager must fit the window');
    const filter=await page.getByRole('button',{name:'이름 필터',exact:true}).boundingBox();assert(filter.x+filter.width<=width,'header actions stay beside their label');
    await page.getByRole('button',{name:'다음 페이지',exact:true}).click();assert.equal(await page.getByRole('button',{name:'2 페이지',exact:true}).getAttribute('aria-current'),'page');
    await page.getByRole('separator',{name:'이름 열 너비',exact:true}).focus();await page.keyboard.press('ArrowRight');
    await page.getByRole('button',{name:'이름 필터',exact:true}).click();await page.getByRole('dialog',{name:'이름 필터 설정',exact:true}).waitFor();await page.keyboard.press('Escape');
   }
   if(kind==='wiki'){
    await page.getByRole('button',{name:'분류 필터',exact:true}).click();await page.getByRole('dialog',{name:'분류 필터 설정',exact:true}).waitFor();await page.keyboard.press('Escape');
    await page.getByRole('button',{name:/검토용 업무 문서 0/}).click();assert.equal(await page.locator('tbody tr[data-open=true]').count(),1);
   }
   if(kind==='mail'){
    await page.getByLabel('메일 검색 조건',{exact:true}).click();
    const filters=page.locator('.nubi-mail-filters>.nubi-mail-filter-fields');
    const bounds=await filters.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width,'mail filters must stay inside the window');
    await page.getByLabel('메일 보낸 사람',{exact:true}).fill('누비');
    await page.screenshot({path:path.join(dir,`mail-filters-${width}.png`)});
    await page.getByLabel('메일 보낸 사람',{exact:true}).press('Escape');
    assert.equal(await filters.isVisible(),false);
   }
  }
  assert.deepEqual(comparison['approval'+width],comparison['mail'+width],'mail and approval table metrics must match');
  for(const kind of ['wiki','workspace']){
   const {rowHeight,headerHeight,...actual}=comparison[kind+width],{rowHeight:baseRow,headerHeight:baseHeader,...expected}=comparison['approval'+width];
   assert.deepEqual(actual,expected,kind+' uses the approval typography, padding and header');assert(rowHeight>=baseRow-1);
  }
 }
 await writeFile(path.join(dir,'comparison.json'),JSON.stringify(comparison,null,2));
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({passed:true,widths:[1100,440,360],checks:['retry without login','document read','same-document retry without list reload','parse-stage diagnosis','HTTP diagnosis','pagination','service error preserves rows','expired session login','20 visible titles only on first entry','all-page title search','date filters','page size and jump','global sort before pagination','cached list reuse'],titleMutations,liveCompanyVerified:false},null,2));console.log('Approval list retry, paging, body and login guidance passed at 1100/440/360px');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
