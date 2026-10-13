import {build} from 'esbuild';
import {assertDesktopDialog} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
import {WELCOME_GREETINGS} from '../ui/welcome-greetings.mjs';
const dir=path.resolve('verification/chat-proposals');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));



let browser,p;const errors=[],measurements=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});p=await browser.newPage({viewport:{width:1440,height:1000}});p.on('pageerror',error=>errors.push(error.message));
 const origin='http://127.0.0.1:'+server.address().port;
 async function open(state){await p.goto(origin+'/?integrated&proposal-review='+state);const reveal=p.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await reveal.count())await reveal.click();await p.locator('.nubi-session-select').filter({hasText:'변경 제안 검증'}).click();await p.locator('.nubi-task').waitFor();}
 await open('running');assert.equal(await p.getByRole('heading',{name:'변경 제안',exact:true}).count(),0);await p.evaluate(()=>window.finishProposalReview());await p.getByRole('button',{name:'반영',exact:true}).waitFor();
 assert(await p.getByRole('button',{name:'취소',exact:true}).isVisible());
 const colors=await p.locator('.nubi-diff-counts').evaluate(el=>[...el.children].slice(0,2).map(n=>getComputedStyle(n).color));assert.notEqual(colors[0],colors[1]);
 await p.getByRole('button',{name:'취소',exact:true}).click();await p.getByRole('heading',{name:'변경 제안',exact:true}).waitFor({state:'hidden'});assert.equal(await p.evaluate(()=>window.proposalCalls.length),1);
 for(const state of ['cancelled','attention']){await open(state);assert.equal(await p.getByRole('heading',{name:'변경 제안',exact:true}).count(),0);if(state==='attention')assert(await p.getByRole('region',{name:'파일 저장 확인'}).isVisible());}
 for(const width of [900,1440,1920,440]){
  await p.setViewportSize({width,height:1000});await open('review');
  const sidebarClose=p.getByRole('button',{name:'사이드바 접기',exact:true});if(await sidebarClose.count())await sidebarClose.click();
  await p.waitForTimeout(250);
  const dimensions=await p.evaluate(()=>{const rect=s=>document.querySelector(s).getBoundingClientRect(),content=rect('.nubi-workbench-content'),conversation=rect('.nubi-conversation-wrap'),composer=rect('.nubi-followup-stack');return {viewport:innerWidth,content:content.width,conversation:conversation.width,composer:composer.width,left:conversation.left,right:conversation.right,overflow:document.documentElement.scrollWidth>innerWidth};});
  assert.equal(dimensions.overflow,false,JSON.stringify(dimensions));assert(Math.abs(dimensions.composer-dimensions.conversation)<2);assert(dimensions.right<=width&&dimensions.left>=0);assert(dimensions.conversation<dimensions.content,'keep side gutters');measurements.push(dimensions);
  await p.screenshot({path:path.join(dir,'chat-'+width+'.png'),animations:'disabled'});
 }
 assert(measurements[1].conversation>measurements[0].conversation+60,JSON.stringify(measurements));assert(measurements[2].conversation<=1121);
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,'checks.json'),JSON.stringify({scope:'Actual React/CX UI with synthetic task states, not Windows/live GHES',measurements,errors},null,2));console.log(JSON.stringify(measurements));console.log('PASS: pending cards hidden during analysis, apply/cancel after review, cancellation, uncertainty preserved, responsive chat widths and diff colors.');
}catch(error){await p?.screenshot({path:path.join(dir,'failure.png')});console.log(JSON.stringify(errors));console.log((await p?.locator('body').innerText())?.slice(-7000));throw error;}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
