import {build,stop} from 'esbuild';
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {rendererBundleOptions} from './renderer-bundle.mjs';
const dir=path.resolve('verification/wiki-coverage');await mkdir(dir,{recursive:true});
await build({...rendererBundleOptions(),entryPoints:['tests/wiki-coverage-ui-fixture.jsx'],entryNames:'app',outdir:dir,minify:true});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(dir+'/index.html','<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="icon" href="data:,"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.js':'text/javascript'};
const server=createServer(async(req,res)=>{try{const file=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));assert(file.startsWith(dir+path.sep));res.setHeader('content-type',mime[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser,page;const results=[];
async function settle(node){await node.evaluate(async n=>{await document.fonts.ready;for(let i=0;i<2;i++){await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await Promise.all(n.getAnimations({subtree:true}).filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));}});}
async function capture(page,dialog,file,section){await dialog.evaluate(n=>{for(const item of [n,...n.querySelectorAll('*')])if(item.scrollHeight>item.clientHeight)item.scrollTop=0;});if(section)await section.evaluate(n=>{for(let p=n.parentElement;p;p=p.parentElement)if(p.scrollHeight>p.clientHeight&&/auto|scroll/.test(getComputedStyle(p).overflowY)){p.scrollTop+=n.getBoundingClientRect().top-p.getBoundingClientRect().top-24;break;}});await settle(dialog);await page.screenshot({path:file});}
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const width of [1280,440]){
  page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);await page.getByRole('button',{name:'위키',exact:true}).click();
  const badge=page.getByRole('region',{name:'위키 파일 연결',exact:true});await badge.waitFor();await badge.getByText('중요 파일 연결 33% (1/3)',{exact:true}).click();
  await badge.getByRole('definition').filter({hasText:'바이너리 2'}).waitFor();assert.equal(await badge.getByRole('checkbox').count(),2);await badge.getByRole('checkbox',{name:'config.json',exact:true}).uncheck();
  assert.deepEqual(await page.evaluate(()=>coverageCalls),[]);await page.locator('.nubi-wiki-browser').evaluate(n=>n.scrollTop=0);await settle(badge);const bounds=await badge.boundingBox();if(bounds.x<8)console.log('geometry',JSON.stringify(await badge.evaluate(n=>{const rows=[];for(let e=n;e;e=e.parentElement){const r=e.getBoundingClientRect(),s=getComputedStyle(e);rows.push({class:e.className,x:r.x,y:r.y,width:r.width,scrollLeft:e.scrollLeft,scrollTop:e.scrollTop,overflow:s.overflow,position:s.position});}return rows;})));assert(bounds.x>=8&&bounds.x+bounds.width<=width-8,'coverage remains within the visible host content gutter '+JSON.stringify(bounds));await page.screenshot({path:dir+'/coverage-'+width+'.png'});
  await badge.getByRole('button',{name:'빠진 것 추가',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();await dialog.getByText('빠진 파일 보강 제안',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>coverageCalls),[{method:'propose',coverageFiles:['main.mjs']}]);assert.equal(await page.getByRole('dialog').count(),1);
  await settle(dialog);await page.screenshot({path:dir+'/proposal-'+width+'.png'});await dialog.getByRole('button',{name:'선택한 파일 작성',exact:true}).click();await dialog.waitFor({state:'hidden'});await page.getByRole('button',{name:'위키 설정',exact:true}).click();await dialog.waitFor();await dialog.getByRole('button',{name:'반영',exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>coverageCalls.map(c=>c.method)),['propose','run']);await dialog.getByRole('button',{name:'반영',exact:true}).click();await dialog.getByText(/1개 파일을 반영/).waitFor();await dialog.getByRole('button',{name:'닫기',exact:true}).click();await page.getByRole('button',{name:'위키',exact:true}).click();
  await badge.getByText('중요 파일 연결 100% (3/3)',{exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>coverageCalls.map(c=>c.method)),['propose','run','apply']);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
  results.push({width,selection:'one bound source',execution:'explicit approval',publication:'separate approval',coverage:'33 to 100 synthetic'});await page.close();
 }
 await writeFile(dir+'/result.json',JSON.stringify({results},null,2));console.log('PASS Wiki coverage UI',JSON.stringify(results));
}catch(error){if(page&&!page.isClosed()){await page.screenshot({path:dir+'/failure.png'});console.log(JSON.stringify({calls:await page.evaluate(()=>window.coverageCalls),screen:await page.locator('body').innerText()}));}throw error;}finally{server.closeAllConnections();await browser?.close();await new Promise(r=>server.close(r));stop();}
