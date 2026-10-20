import {build,stop} from 'esbuild';
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {rendererBundleOptions} from './renderer-bundle.mjs';
const dir=path.resolve('verification/wiki-search-ui');await mkdir(dir,{recursive:true});
await build({...rendererBundleOptions(),entryPoints:['tests/wiki-search-ui-fixture.jsx'],entryNames:'app',outdir:dir,minify:true});
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
  page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
  const sources=page.locator('.nubi-answer-sources');await sources.waitFor();await sources.getByText('원문 출처',{exact:true}).click();
  assert.equal(await sources.getByText('주장 검토 기록 없음',{exact:true}).count(),2);assert.equal(await sources.getByText('원본 확인 필요',{exact:true}).count(),1);const buttons=sources.getByRole('button');assert.equal(await buttons.count(),2);assert.match(await buttons.first().getAttribute('aria-label'),/주장 검토 기록 없음/);assert.match(await buttons.nth(1).getAttribute('aria-label'),/원본 확인 필요/);
  await sources.scrollIntoViewIfNeeded();await settle(sources);assert(await sources.evaluate(n=>[...n.querySelectorAll('.nubi-source-meta')].every(meta=>{const box=meta.getBoundingClientRect();return [...meta.querySelectorAll('small')].every(item=>{const r=item.getBoundingClientRect();return r.left>=box.left-1&&r.right<=box.right+1;});})),'all source qualifiers fit without clipping');const bounds=await sources.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=width);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await page.screenshot({path:dir+'/sources-'+width+'.png'});results.push({width,unverified:2,stale:1});await page.close();
 }
 await writeFile(dir+'/result.json',JSON.stringify({results},null,2));console.log('PASS Search claim status UI',JSON.stringify(results));
}catch(error){if(page&&!page.isClosed()){console.log(await page.locator('body').innerText());await page.screenshot({path:dir+'/failure.png'});}throw error;}finally{server.closeAllConnections();await browser?.close();await new Promise(r=>server.close(r));stop();}
