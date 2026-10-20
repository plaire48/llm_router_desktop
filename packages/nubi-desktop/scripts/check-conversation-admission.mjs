import {calibrateAdmission,admissionEnvironmentFailure} from './admission-calibration.mjs';
import {build,stop} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {rendererBundleOptions} from './renderer-bundle.mjs';
const dir=path.resolve('verification/conversation-admission');await mkdir(dir,{recursive:true});
await build({...rendererBundleOptions(),entryPoints:['tests/conversation-admission-fixture.jsx'],outdir:dir,entryNames:'app',minify:true});stop();
await writeFile(dir+'/index.html','<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="app.js"></script>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));assert.ok(file.startsWith(dir+path.sep));res.setHeader('content-type',file.endsWith('.html')?'text/html; charset=utf-8':'text/javascript');res.end(await readFile(file));}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const width of [1280,440]){
  const calibration=await calibrateAdmission(browser,{width,directory:dir,name:'conversation'});
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
  await page.getByRole('textbox',{name:'초안'}).fill('기존 초안을 보존합니다.');
  await page.evaluate(()=>{let first;const sample=()=>{const node=document.querySelector('[data-message-key="m159"]');if(node){first||=node;admission.frames.push({count:document.querySelectorAll('.nubi-message').length,top:node.getBoundingClientRect().top,same:node===first});}if(!node||document.querySelector('.nubi-conversation-scroll').getAttribute('aria-busy')==='true')requestAnimationFrame(sample);};requestAnimationFrame(sample);});
  await page.getByRole('button',{name:'열기',exact:true}).click();await page.getByRole('textbox',{name:'초안'}).click();await page.waitForFunction(()=>document.querySelectorAll('.nubi-message').length===40);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const result=await page.evaluate(()=>admission);await writeFile(dir+'/initial-'+width+'.json',JSON.stringify({...result,calibration},null,2));assert.equal(result.commits[0].count,4,'first commit keeps the approved four visible recent rows');assert.equal(result.commits[0].busy,true);assert.ok(result.commits.slice(1).every((c,i)=>c.count-result.commits[i].count<=4),'at most4 new rows in an admission commit');
  assert.ok(result.commits.at(-1).at-result.started<=calibration.budgetMs,'recent40 admitted within calibrated 300ms contract');assert.equal(result.commits.at(-1).busy,false);assert.equal(result.shellRenders,1,'admission updates stay inside the conversation, not the surrounding shell');
  assert.ok(Math.max(...result.positions)-Math.min(...result.positions)<1,'post-layout prepend anchor moves less than1px');
  assert.ok(result.frames.every(f=>f.same),'retained message identity');
  assert.ok(result.frames.slice(0,3).every(frame=>frame.count===4),'initial rows retain two presentation opportunities before the first prepend competes with mount layout');
  assert.equal(await page.getByRole('textbox',{name:'초안'}).inputValue(),'기존 초안을 보존합니다.');
  assert.deepEqual(await page.locator('.nubi-message').evaluateAll(rows=>rows.map(n=>n.dataset.messageKey)),Array.from({length:40},(_,i)=>'m'+(120+i)));
  await page.evaluate(()=>{admission.previousStarted=performance.now();admission.previousCommit=admission.commits.length;});await page.getByRole('button',{name:'이전 대화 보기',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.nubi-message').length===80);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const previous=await page.evaluate(()=>admission),commits=previous.commits.slice(previous.previousCommit);
  assert.ok(commits.some(c=>c.count>40&&c.count<80),'one logical40-page renders in bounded commits');
  await writeFile(dir+'/previous-'+width+'.json',JSON.stringify({...previous,calibration},null,2));
  assert.ok(commits.at(-1).at-previous.previousStarted<=calibration.budgetMs,'previous40 admitted within calibrated 300ms contract');
  await writeFile(dir+'/previous-'+width+'.json',JSON.stringify({...previous,calibration},null,2));assert.ok(Math.max(...previous.positions)-Math.min(...previous.positions)<1,'previous page also keeps reading anchor: '+JSON.stringify(previous.positions));
  assert.deepEqual(errors,[]);await writeFile(dir+'/result-'+width+'.json',JSON.stringify({...result,calibration},null,2));await page.close();
 }
 console.log('PASS progressive recent40,300ms deadline, stable identity, draft and chronological order at1280/440');
}catch(error){if(!admissionEnvironmentFailure(error))throw error;}finally{server.closeAllConnections();await browser?.close();await new Promise(r=>server.close(r));}
