import {build} from 'esbuild';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {rendererBundleOptions} from './renderer-bundle.mjs';
const dir=path.resolve('verification/workspace-embed');await mkdir(dir,{recursive:true});
await build({...rendererBundleOptions(),entryPoints:['tests/workspace-embed-fixture.jsx'],entryNames:'app',outdir:dir,minify:false});
await writeFile(dir+'/index.html','<!doctype html><html lang="ko"><meta charset="UTF-8"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(dir+path.sep))throw Error();res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream'}).end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser,page;const errors=[],checks=[];
try{
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});const p=page=await browser.newPage();p.setDefaultTimeout(10000);p.on('pageerror',e=>errors.push(e.message));
 await p.route('https://**/*',route=>route.abort());
 for(const width of [1100,440]){
  await p.setViewportSize({width,height:900});await p.goto('http://127.0.0.1:'+server.address().port);await p.getByRole('link',{name:'파일 앱 새 탭에서 열기'}).waitFor();
  await p.getByRole('link',{name:'파일 앱 새 탭에서 열기'}).click();await p.waitForFunction(()=>window.calls.some(c=>c.method==='openWorkspaceApp'&&c.id.startsWith('2222')));
  await p.getByRole('link',{name:'링크 앱 새 탭에서 열기'}).click();await p.waitForFunction(()=>window.calls.some(c=>c.method==='openWorkspaceApp'&&c.id.startsWith('1111')));
  assert.equal(p.context().pages().length,1,'the renderer uses the native app bridge, not app:// hash popups');
  await p.getByRole('button',{name:'앱 등록',exact:true}).click();await p.getByRole('dialog').waitFor();await p.getByRole('tab',{name:'파일',exact:true}).click();await p.getByText('페이지 파일',{exact:true}).waitFor();await p.keyboard.press('Escape');await p.getByRole('alertdialog').getByRole('button',{name:'작성 취소',exact:true}).click();await p.getByRole('dialog').waitFor({state:'hidden'});
  await p.evaluate(()=>window.openFailure=true);await p.getByRole('link',{name:'파일 앱 새 탭에서 열기'}).click();await p.getByRole('alert').filter({hasText:'앱을 열지 못했어요'}).waitFor();await p.getByRole('button',{name:'다시 불러오기',exact:true}).click();await p.getByRole('alert').waitFor({state:'hidden'});
  await p.getByRole('button',{name:'테스트 Talk',exact:true}).click();await p.waitForFunction(()=>window.calls.some(c=>c.method==='ghesFetch'&&c.body?.includes('E2EDiscussions')));
  await p.getByRole('button',{name:'글쓰기',exact:true}).first().click();await p.getByRole('textbox',{name:'글 제목',exact:true}).waitFor();await p.getByRole('combobox',{name:'글 카테고리'}).selectOption('general');
  await p.screenshot({path:dir+'/talk-'+width+'.png'});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await p.getByRole('button',{name:'테스트 문의',exact:true}).click();
  await p.getByRole('button',{name:'김누비 계정 메뉴',exact:true}).click();
  await p.locator('.nubi-ghes-modal').waitFor();
  assert.equal(await p.getByText(/회사 계정을 확인하지 못했어요/).count(),0);
  await p.keyboard.press('Escape');
  await p.getByRole('button',{name:'문의하기',exact:true}).click();
  await p.getByRole('textbox',{name:'제목',exact:true}).fill('문의 연결 확인');
  await p.getByRole('textbox',{name:'문의 내용',exact:true}).fill('목록 조회와 등록 후 다시 확인하는 테스트입니다.');
  await p.getByRole('button',{name:'담당자 선택',exact:true}).click();
  await p.getByRole('checkbox',{name:'김누비 (nubi) 배정',exact:true}).check();
  await p.keyboard.press('Escape');
  await p.getByRole('button',{name:'접수',exact:true}).click();
  await p.getByRole('heading',{name:'문의 연결 확인',exact:true}).waitFor();
  await p.getByText('목록 조회와 등록 후 다시 확인하는 테스트입니다.',{exact:true}).last().waitFor();
  await p.screenshot({path:dir+'/support-'+width+'.png'});
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await p.getByRole('button',{name:'테스트 앱',exact:true}).click();await p.getByRole('link',{name:'파일 앱 새 탭에서 열기'}).waitFor();
  await p.getByRole('button',{name:'테스트 로그인 전환'}).click();await p.getByRole('button',{name:'사내 Github SSO 로그인',exact:true}).waitFor();assert.equal(await p.getByRole('link',{name:'파일 앱 새 탭에서 열기'}).count(),0);
  await p.getByRole('button',{name:'사내 Github SSO 로그인',exact:true}).click();await p.getByRole('link',{name:'파일 앱 새 탭에서 열기'}).waitFor();await p.screenshot({path:dir+'/apps-'+width+'.png'});
  assert.deepEqual(await p.evaluate(()=>window.unhandled),[]);checks.push({width,apps:'list/open/register-file/error/retry/relogin',talk:'real embedded client list and composer',support:'list/master/create/readback'});
 }
 assert.deepEqual(errors,[]);await writeFile(dir+'/result.json',JSON.stringify({checks,errors,boundary:'Production embedded components and renderer bridge with synthetic GHES responses. No company reads or writes.'},null,2));console.log(JSON.stringify({checks,errors}));
}catch(error){if(page){console.error(JSON.stringify({errors,text:(await page.locator('body').innerText()).slice(0,2200),calls:await page.evaluate(()=>window.calls.map(c=>({method:c.method,url:c.url,operation:c.body?.match(/(?:query|mutation) [A-Za-z]+/)?.[0]}))),unhandled:await page.evaluate(()=>window.unhandled)}));await page.screenshot({path:dir+'/failure.png'});}throw error;}finally{await browser?.close();await new Promise(r=>server.close(r));}
