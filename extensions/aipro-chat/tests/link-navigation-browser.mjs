// Actual Chrome, synthetic HTTP site, no model or account credentials.
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {mkdtemp,cp,readFile,writeFile,appendFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
const profile=await mkdtemp(resolve(tmpdir(),'nubi-link-navigation-')),extension=resolve(profile,'extension');
let visits=0,browser;
const timers=new Set();
const server=createServer((req,res)=>{
 res.setHeader('Content-Type','text/html; charset=utf-8');
 if(req.url==='/slow'){
  visits++;const timer=setTimeout(()=>{timers.delete(timer);res.end('<title>읽은 원문</title><main><h1>검증된 목적지 본문</h1><label for="note">메모</label><input id="note"></main><script>window.probeInputs=0;document.getElementById("note").addEventListener("input",()=>window.probeInputs++);</script>');},9000);timers.add(timer);return;
 }
 res.end('<title>정보 링크</title><main><a href="/slow">공식 원문 열기</a></main>');
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${server.address().port}`;
try{
 await cp(resolve(process.env.NUBI_TEST_EXTENSION_DIR||'dist'),extension,{recursive:true});
 const manifest=JSON.parse(await readFile(resolve(extension,'manifest.json'),'utf8'));
 manifest.host_permissions.push(`${origin}/*`);await writeFile(resolve(extension,'manifest.json'),JSON.stringify(manifest));
 await appendFile(resolve(extension,'background.js'),'\nglobalThis.linkProbe={runBrowserAgent,stopBrowserAgent,ready:serial(()=>Promise.resolve())};\n');
 browser=await chromium.launchPersistentContext(profile,{headless:true,channel:'chromium',executablePath:process.env.CHROME_BINARY,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 const page=await browser.newPage();await page.goto(origin);
 const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker');
 await worker.evaluate(async()=>{await linkProbe.ready;await chrome.storage.local.set({browserWorkMode:'current'});});
 const tabId=await worker.evaluate(async url=>(await chrome.tabs.query({})).find(tab=>tab.url===url).id,page.url());
 const run=(name,args={})=>worker.evaluate(async({tabId,name,args})=>(await linkProbe.runBrowserAgent('link-probe',{tabId},name,args)).result,{tabId,name,args});
 const observed=await run('browser_snapshot');
 const link=observed.frames.flatMap(frame=>frame.elements).find(el=>el.name==='공식 원문 열기');assert(link?.ref);
 const started=Date.now(),clicked=await run('click_element',{ref:link.ref});
 assert(!clicked.error,JSON.stringify(clicked).slice(0,500));assert.equal(clicked.actionIssued,true);
 await page.waitForURL(origin+'/slow');await page.waitForLoadState('domcontentloaded');
 const verified=await run('verify_page',{checks:[{kind:'url_is',expected:origin+'/slow'},{kind:'text_present',expected:'검증된 목적지 본문'}]});
 assert.equal(verified.verified,true,JSON.stringify(verified).slice(0,500));assert.equal(visits,1);
 console.log(JSON.stringify({actualBrowser:true,actualModel:false,syntheticSite:true,clickElapsedMs:Date.now()-started,slowResponseMs:9000,visits,verified:verified.verified}));
 console.log('PASS known information link with delayed destination is clicked once and independently verified without an uncertain click timeout');
 const waitStart=Date.now(),waited=await run('wait_page',{timeout_ms:250});
 assert(!waited.error,JSON.stringify(waited).slice(0,300));assert(Date.now()-waitStart>=200);assert.notEqual(waited.actionIssued,true);
 assert(waited.observation.frames.length>0);assert.equal(visits,1);
 const condition=await run('wait_page',{condition:{kind:'text_present',expected:'검증된 목적지 본문'},timeout_ms:1000});
 assert.equal(condition.wait.matched,true);assert.notEqual(condition.verified,true,'Waiting is not final goal verification');
 for(const args of [{timeout_ms:0},{timeout_ms:15001},{condition:{kind:'text_present',expected:''}},{condition:{kind:'unsupported',expected:'x'}}]){
  const invalid=await run('wait_page',args);assert.equal(invalid.reason,'wait_arguments_invalid');assert.equal(invalid.actionIssued,false);assert.equal(visits,1);
 }
 console.log('PASS timeout-only and condition waits follow the declared contract and invalid waits issue no operation');
 for(const [code,reason] of [['const = ;','script_syntax'],['await page.evaluate(() => document.title);','script_api']]){
  const failed=await run('run_playwright',{code});assert.equal(failed.reason,reason);assert.equal(failed.actionIssued,false);
  assert.equal(await page.locator('#note').inputValue(),'');assert.equal(await page.evaluate(()=>window.probeInputs),0);
 }
 const repairObservation=await run('browser_snapshot');
 const field=repairObservation.frames.flatMap(frame=>frame.elements).find(el=>el.name==='메모');assert(field?.ref);
 const repaired=await run('fill_form',{fields:[{field_id:field.ref,value:'검증한 메모'}]});assert(!repaired.error,JSON.stringify(repaired).slice(0,300));
 assert.equal(await page.locator('#note').inputValue(),'검증한 메모');assert.equal(await page.evaluate(()=>window.probeInputs),1);assert.equal(visits,1);
 const repairedField=repaired.observation.frames.flatMap(frame=>frame.elements).find(el=>el.name==='메모');assert(repairedField?.ref);
 const repairVerification=await run('verify_page',{checks:[{kind:'field_value',ref:repairedField.ref,expected:'검증한 메모'}]});
 assert.equal(repairVerification.verified,true,JSON.stringify(repairVerification).slice(0,300));
 console.log('PASS syntax and unsupported scripts issue no input, then a fresh observed semantic repair writes once with native readback');
 await worker.evaluate(()=>linkProbe.stopBrowserAgent('link-probe'));
}finally{
 for(const timer of timers)clearTimeout(timer);
 await browser?.close();server.closeAllConnections?.();server.close();await rm(profile,{recursive:true,force:true});
}
