// "프로젝트 없이 대화" must lead to the composer, both on a fresh start and when the personal workspace is already open.
import {build} from 'esbuild';
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {rendererBundleOptions} from './renderer-bundle.mjs';
const dir=path.resolve('verification/personal-start');await mkdir(dir,{recursive:true});
await build({...rendererBundleOptions(),entryPoints:['tests/personal-start-ui-fixture.jsx'],entryNames:'app',outdir:dir,minify:true,logLevel:'warning'});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(dir+'/index.html','<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="icon" href="data:,"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.js':'text/javascript'};
const server=createServer(async(req,res)=>{try{const file=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));assert(file.startsWith(dir+path.sep));res.setHeader('content-type',mime[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;const results=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const [scenario,switches] of [['fresh',1],['personal',0]]){
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/?scenario=${scenario}`);
  const start=page.getByRole('button',{name:'프로젝트 없이 대화',exact:true});await start.waitFor({timeout:15000});
  // Connecting a project offers the composer's model and reasoning chips (user decision 2026-10-23).
  assert.equal(await page.getByRole('button',{name:'모델 변경',exact:true}).count(),1,scenario+': model chip');assert.equal(await page.getByRole('button',{name:'추론 정도',exact:true}).count(),1,scenario+': reasoning chip');await start.click();
  await page.locator('.nubi-compose-card').waitFor({state:'visible',timeout:5000}).catch(()=>{});
  const composer=await page.locator('.nubi-compose-card').isVisible(),picker=await page.getByRole('button',{name:'프로젝트 없이 대화',exact:true}).count();
  const switched=await page.evaluate(()=>window.workspaceSwitches);
  results.push({scenario,composer,picker,switched});await page.close();
  assert.deepEqual(errors,[],scenario+': no page errors');
  assert.equal(composer,true,scenario+': the composer opens after choosing personal chat');
  assert.equal(picker,0,scenario+': the project start screen does not come back');
  assert.equal(switched,switches,scenario+': workspace switches');
 }
 console.log(JSON.stringify(results));
}finally{await browser?.close();server.close();}
