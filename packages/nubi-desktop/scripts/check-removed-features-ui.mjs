import {build,stop} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {rendererBundleOptions} from './renderer-bundle.mjs';
import {captureDesign} from './design-rules.mjs';
const dir=path.resolve('verification/removed-features');await mkdir(dir,{recursive:true});
await build({...rendererBundleOptions(),entryPoints:['tests/removed-features-ui-fixture.jsx'],entryNames:'removed-features-ui-fixture',outdir:dir,minify:true});stop();
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>경량화 화면 검사</title><link rel="stylesheet" href="removed-features-ui-fixture.css"><div id="root"></div><script type="module" src="removed-features-ui-fixture.js"></script></html>');
const server=createServer(async(req,res)=>{try{const name=new URL(req.url,'http://localhost').pathname;const file=path.join(dir,name==='/'?'index.html':name);if(!file.startsWith(dir+path.sep))throw Error('path_scope');const data=await readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.woff2':'font/woff2','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream');res.end(data);}catch{res.writeHead(404).end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;const errors=[],checks=[];
try{
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});
 for(const width of [1280,440]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
  const open=screen=>page.goto(`http://127.0.0.1:${server.address().port}/?integrated&catalog&screen=${screen}`);
  await open('workspace');await page.getByRole('navigation',{name:'프로젝트 도구'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'워크플로우',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'위키',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'메일',exact:true}).count(),1);
  await captureDesign(page,{path:path.join(dir,`workspace-${width}.png`)});
  await open('routines');await page.getByRole('button',{name:'루틴 추가',exact:true}).click();
  assert.equal(await page.getByLabel('할 일',{exact:true}).count(),0);assert.equal(await page.getByText('워크플로우',{exact:true}).count(),0);
  await page.getByLabel('이름',{exact:true}).fill('매일 요청 확인');await page.getByLabel('요청',{exact:true}).fill('오늘 확인할 자료를 정리해 주세요.');
  await captureDesign(page,{path:path.join(dir,`routine-${width}.png`)});
  await page.getByRole('button',{name:'저장',exact:true}).click();await page.getByLabel('매일 요청 확인',{exact:true}).waitFor();
  const saved=await page.evaluate(()=>window.removalCalls.find(row=>row.method==='saveRoutine')?.args);assert.equal(saved.kind,'prompt');assert.equal(saved.request,'오늘 확인할 자료를 정리해 주세요.');
  await open('browser');await page.getByText('Electron 앱에서 인터넷 브라우저를 사용할 수 있어요.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:/녹화/}).count(),0);assert.equal(await page.locator('.nubi-browser-teach-control').count(),0);
  await page.waitForTimeout(2100);assert.equal(await page.evaluate(()=>window.removalCalls.some(row=>row.method==='browserTeach')),false);
  await captureDesign(page,{path:path.join(dir,`browser-${width}.png`)});checks.push({width,navigation:true,promptRoutineSaved:true,browserWithoutRecording:true});await page.close();
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({checks,errors,boundary:'Production React surfaces with synthetic host APIs in local Chrome. Windows, signed-in external browsers and native browser behavior are separate.'},null,2)+'\n');console.log(JSON.stringify({passed:checks.length,checks}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
