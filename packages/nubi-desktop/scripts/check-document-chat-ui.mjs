import {captureDesign,assertAccessibilityRules} from './design-rules.mjs';
import {rendererBundleOptions} from './renderer-bundle.mjs';
import {build,stop} from 'esbuild';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const dir=path.resolve('verification/document-chat'),started=performance.now();await mkdir(dir,{recursive:true});
await build({...rendererBundleOptions(),entryPoints:{app:'tests/document-chat-ui-fixture.jsx',chat:'tests/shared-ui-fixture.jsx'},outdir:dir,entryNames:'[name]',minify:true});stop();
await writeFile(dir+'/index.html','<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
await writeFile(dir+'/chat.html',(await readFile(dir+'/index.html','utf8')).replaceAll('app.css','chat.css').replaceAll('app.js','chat.js'));
await cp('../../extensions/aipro-chat/public/icons',dir+'/icons',{recursive:true});
const server=createServer(async(req,res)=>{try{const f=path.resolve(dir,'.'+new URL(req.url,'http://local').pathname.replace(/\/$/,'/index.html'));assert(f.startsWith(dir+path.sep));res.setHeader('content-type',f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html; charset=utf-8':'text/javascript');res.end(await readFile(f));}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;const checks=[],errors=[],url='http://127.0.0.1:'+server.address().port;
try{browser=await chromium.launch({channel:'chrome',headless:true});for(const width of [1280,440]){
 const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));await page.goto(url);
 for(const ext of ['docx','xlsx','pptx']){
  await page.evaluate(ext=>window.changeDocumentFile('양식.'+ext),ext);await page.getByText('합성 원본 양식',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:/양식으로 (등록|작성)/}).count(),0,'documents have no form registration or fill wizard');
  assert.equal(await page.locator('.nubi-document-form-control').count(),0);assert.equal(await page.getByRole('dialog').count(),0);
 }
 assert.equal((await page.evaluate(()=>window.documentCalls)).filter(c=>c.method==='documentForm').length,0);
 await assertAccessibilityRules(page);await captureDesign(page,{path:`${dir}/preview-${width}.png`});
 await page.goto(url+'/?compare');await page.getByRole('region',{name:'Word 문서 화면'}).waitFor();
 await page.getByRole('region',{name:'머리글'}).getByText('합성 수정 머리글',{exact:true}).waitFor();await page.getByRole('region',{name:'바닥글'}).getByText('합성 바닥글',{exact:true}).waitFor();
 assert.equal(await page.locator('mark.nubi-office-changed-text').count(),3);
 await captureDesign(page,{path:`${dir}/changes-${width}.png`});
 const original=page.getByRole('button',{name:'원본 잠깐 보기'});await original.focus();await page.keyboard.down('Space');await page.getByText('출장 목적: 미정',{exact:true}).waitFor();await page.keyboard.up('Space');assert.equal(await page.locator('mark.nubi-office-changed-text').count(),3);
 await page.getByRole('button',{name:'변경 내역 3개'}).click();await page.getByText('삭제할 합성 안내',{exact:true}).waitFor();
 await page.goto(url+'/chat.html?integrated&document-form-chat');
 const opener=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();
 await page.getByRole('button',{name:'대화 검색',exact:true}).click();await page.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').first().click();
 await page.getByText('출장 기간과 담당자를 한 번에 알려 주세요.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('dialog').count(),0);await captureDesign(page,{path:`${dir}/chat-question-${width}.png`});
 const composer=page.getByRole('textbox',{name:'추가 요청',exact:true});await composer.fill('내일 하루, 합성 담당자');await composer.press('Enter');
 await page.getByText('사본을 문서/출장 작성.docx에 저장했어요. 원본은 그대로 두었습니다.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.documentChatAnswer),'내일 하루, 합성 담당자');
 assert.equal(await page.getByRole('dialog').count(),0);await captureDesign(page,{path:`${dir}/chat-result-${width}.png`});
 checks.push({width,noFormEntry:true,noLegacyCalls:true,documentPreview:true,ordinaryChatReply:true,shadedChanges:true,headersFooters:true,originalHold:true});await page.close();
}assert.deepEqual(errors,[]);await writeFile(dir+'/result.json',JSON.stringify({scope:'Synthetic FileWorkspace, Workbench chat and existing NativeDocumentPreview; no Office/model execution',durationMs:performance.now()-started,checks},null,2));console.log(JSON.stringify({checks}));}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await browser?.close();}
