import {captureDesign} from './design-rules.mjs';import {rendererBundleOptions} from './renderer-bundle.mjs';
import {build,stop} from 'esbuild';import {mkdir,writeFile,readFile} from 'node:fs/promises';import {createServer} from 'node:http';import path from 'node:path';import assert from 'node:assert/strict';import {chromium} from 'playwright';
const dir=path.resolve('verification/mail-thread-card');await mkdir(dir,{recursive:true});
await build({...rendererBundleOptions(),entryPoints:['tests/mail-thread-card-fixture.jsx'],outdir:dir,entryNames:'app',minify:true});stop();
await writeFile(dir+'/index.html','<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="app.css"><style>.nubi-mail-thread-fixture{margin:var(--cx-space-4);padding:var(--cx-space-4);width:min(760px,calc(100% - 2 * var(--cx-space-4)));background:var(--nubi-surface-base)}</style><div id="root"></div><script type="module" src="app.js"></script>');
const server=createServer(async(req,res)=>{try{const f=path.resolve(dir,'.'+new URL(req.url,'http://local').pathname.replace(/\/$/,'/index.html'));assert(f.startsWith(dir+path.sep));res.setHeader('content-type',f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html; charset=utf-8':'text/javascript');res.end(await readFile(f));}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;const checks=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const width of [1280,440]){
  const page=await browser.newPage({viewport:{width,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);const card=page.locator('.nubi-mail-thread-card');await card.locator('summary').click();
  assert.equal(await card.locator('li').count(),20);assert.match(await card.innerText(),/65통/);assert.match(await card.innerText(),/위키 정리됨/);
  await page.getByRole('textbox',{name:'보존 초안'}).fill('보존할 새 메모');
  await card.getByRole('button',{name:'대화를 위키로 정리',exact:true}).click();await card.getByRole('status').filter({hasText:'첨부 예산 자료'}).waitFor();assert.match(await card.innerText(),/50\/65통 기준.*일부 범위 확인/);await captureDesign(page,{path:dir+'/topic-'+width+'.png'});
  await page.evaluate(()=>window.deferTopic=true);await card.getByRole('button',{name:'대화를 위키로 정리',exact:true}).click();
  await card.getByRole('button',{name:'다음 대화 메일'}).click();await card.getByRole('button',{name:/합성 출시 검토 20/}).waitFor();
  await card.getByRole('button',{name:/합성 출시 검토 20/}).click();assert.deepEqual(await page.evaluate(()=>window.openedThread),{id:'m20',hash:'h20'});
  await page.getByRole('heading',{name:'합성 출시 검토 20'}).waitFor();await page.evaluate(()=>{window.finishTopic();window.deferTopic=false;});assert.equal(await page.getByRole('status').filter({hasText:'첨부 예산 자료'}).count(),0);await page.locator('.nubi-mail-thread-card summary').click();
  assert.equal(await page.getByRole('textbox',{name:'보존 초안'}).inputValue(),'보존할 새 메모');assert(await card.evaluate(el=>el.scrollWidth<=el.clientWidth+1));assert.deepEqual(errors,[]);
  await captureDesign(page,{path:dir+'/thread-'+width+'.png'});
  await page.evaluate(()=>{window.failThread=true;window.setThreadId('m2');});await page.locator('.nubi-mail-thread-card summary').click();await page.getByRole('button',{name:'다시 확인',exact:true}).waitFor();
  await page.evaluate(()=>window.failThread=false);await page.getByRole('button',{name:'다시 확인',exact:true}).click();await card.getByText('위키 정리됨',{exact:true}).waitFor();
  checks.push({width,boundedRows:20,draftPreserved:true,sourceHashHandoff:true,recovery:true,topicCoverageVisible:true,staleTopicIgnored:true});await page.close();
 }
 await writeFile(dir+'/result.json',JSON.stringify({checks},null,2));console.log(JSON.stringify({checks}));
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));await browser?.close();}
