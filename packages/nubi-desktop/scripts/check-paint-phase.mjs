import {build,stop} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {rendererBundleOptions} from './renderer-bundle.mjs';
const dir=path.resolve('verification/paint-phase');await mkdir(dir,{recursive:true});
await build({...rendererBundleOptions(),entryPoints:['tests/paint-phase-fixture.jsx'],outdir:dir,entryNames:'app',minify:true});stop();
await writeFile(dir+'/index.html','<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="app.js"></script>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));assert.ok(file.startsWith(dir+path.sep));res.setHeader('content-type',file.endsWith('.html')?'text/html; charset=utf-8':'text/javascript');res.end(await readFile(file));}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
 await page.getByText('준비된 화면',{exact:true}).waitFor();assert.ok(await page.evaluate(()=>paintProbe.renders.every(t=>t>=paintProbe.startedAt+2)),'heavy screen mounts after the shell has a paint opportunity');
 await page.getByRole('textbox',{name:'유지할 초안'}).fill('계속 남는 초안');
 for(const name of ['메일','위키','워크플로우'])await page.getByRole('button',{name,exact:true}).hover();
 assert.deepEqual(await page.evaluate(()=>[...new Set(paintProbe.preloads)]),['mail','wiki','workflows']);
 await page.evaluate(()=>{paintProbe.geometry=[];paintActions.grow();});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r)))));
 assert.deepEqual(await page.evaluate(()=>paintProbe.geometry),[],'streaming scroll geometry is read only in post-layout observers');
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const immediate=await page.evaluate(()=>{paintProbe.offsetReads=0;paintProbe.preLayoutOffsetReads=0;paintActions.scroll();paintActions.scroll();paintActions.scroll();return paintProbe.offsetReads;});assert.equal(immediate,0,'scroll bursts do not force synchronous geometry');
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));assert.equal(await page.evaluate(()=>paintProbe.preLayoutOffsetReads),0,'scroll offset reads wait for layout delivery');assert.equal(await page.evaluate(()=>paintProbe.offsetReads),1,'unchanged scroll geometry is observed once without redundant repositioning');
 await page.getByRole('button',{name:'최신으로',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'유지할 초안'}).inputValue(),'계속 남는 초안');assert.deepEqual(errors,[]);
 console.log('PASS: first-paint deferred screen, rail chunk preloads, post-layout scroll observations and draft preservation');
}finally{server.closeAllConnections();await browser?.close();await new Promise(r=>server.close(r));}
