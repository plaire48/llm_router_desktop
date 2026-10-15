import {build} from 'esbuild';
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {rendererBundleOptions} from './renderer-bundle.mjs';
const dir=path.resolve('verification/chat-documents-2026-10-16');await mkdir(dir,{recursive:true});
await build({...rendererBundleOptions(),entryPoints:['tests/shared-ui-fixture.jsx'],entryNames:'app',outdir:dir});
await cp('../../extensions/aipro-chat/public/icons',dir+'/icons',{recursive:true});
await writeFile(dir+'/index.html','<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><div id="toolbar"></div><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(dir+path.sep))throw Error();res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser,page;const errors=[];
try{browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
for(const width of [1100,440]){await page.setViewportSize({width,height:900});await page.goto(`http://127.0.0.1:${server.address().port}/?documents&integrated`);await page.getByRole('textbox',{name:'작업 요청',exact:true}).waitFor();
await page.getByRole('button',{name:'스킬 관리',exact:true}).click();await page.getByRole('button',{name:'문서 첨부',exact:true}).click();
const chip=page.getByRole('button',{name:'분기 보고서.pdf 읽은 내용 보기',exact:true});await chip.waitFor();await chip.click();await page.getByRole('dialog').waitFor();await page.getByText('승인 예산은 1200입니다.',{exact:true}).waitFor();await page.screenshot({path:dir+`/preview-${width}.png`});await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
await page.getByRole('textbox',{name:'작업 요청',exact:true}).fill('이 문서의 예산을 알려줘');await page.getByRole('textbox',{name:'작업 요청',exact:true}).press('Enter');await page.waitForFunction(()=>window.documentCalls?.some(c=>c.method==='createTask'));
assert.equal(await page.evaluate(()=>window.documentCalls.find(c=>c.method==='createTask').args.documentReferences[0].id),'doc-fixture');await page.locator('.nubi-request').getByRole('button',{name:'분기 보고서.pdf 읽은 내용 보기'}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:dir+`/chat-${width}.png`});}
assert.deepEqual(errors,[]);console.log('Document selection, preview, send and retained source chips passed at 1100 and 440px (synthetic host).');
}catch(e){if(page)await page.screenshot({path:dir+'/failure.png'});console.error(errors);throw e;}finally{await browser?.close();await new Promise(r=>server.close(r));}
