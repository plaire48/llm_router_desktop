import {captureDesign} from './design-rules.mjs';
import {build,stop as stopBuildService} from 'esbuild';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/mail-stability-2026-10-15');await mkdir(dir,{recursive:true});
await build({plugins:[{name:'observe-mail-render-boundary',setup(builder){builder.onLoad({filter:/[\\/]ui[\\/](MailKnowledgeSearch|MailHistory)\.jsx$/},async args=>{let contents=await readFile(args.path,'utf8');if(args.path.endsWith('MailKnowledgeSearch.jsx'))contents=contents.replace('  const saved=',"  window.mailSearchRenderCount=(window.mailSearchRenderCount||0)+1;\n  const saved=");else contents=contents.replace(' const [query,setQuery]'," window.touchMailShell=()=>setRefreshing(value=>!value);\n const [query,setQuery]");return {contents,loader:'jsx',resolveDir:path.dirname(args.path)};});}}],entryPoints:['tests/mail-stability-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.webp':'file','.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.mailScrollWrites=[];const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,'scrollTop');
  Object.defineProperty(Element.prototype,'scrollTop',{...descriptor,set(value){if(this.matches('.nubi-mail-results'))window.mailScrollWrites.push(value);descriptor.set.call(this,value);}});
 });
 await page.goto('http://127.0.0.1:'+server.address().port);
 const results=page.getByRole('region',{name:'메일 검색 결과'});
 await results.locator('tbody tr').first().waitFor();
 await page.waitForFunction(()=>document.querySelector('.nubi-mail-results')?.dataset.admission==='complete');
 assert.deepEqual(await page.evaluate(()=>window.mailScrollWrites),[],'initial top-aligned results do not force layout by writing scrollTop');
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const renders=await page.evaluate(()=>window.mailSearchRenderCount);
 await page.evaluate(()=>window.touchMailShell());
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.equal(await page.evaluate(()=>window.mailSearchRenderCount),renders,'an unrelated mail-shell update does not rerender search rows');
 await page.evaluate(()=>window.touchMailShell());
 await page.getByRole('button',{name:'다음 메일 페이지',exact:true}).click();
 await page.getByRole('button',{name:'업무 메일 21',exact:true}).click();
 assert.deepEqual(await page.evaluate(()=>window.mailScrollWrites),[],'changing page while already at top needs no scroll write');
 await page.getByRole('heading',{name:'업무 메일 21',exact:true}).waitFor();await page.getByRole('checkbox',{name:'업무 메일 22 선택',exact:true}).check();
 await page.waitForFunction(()=>document.querySelector('.nubi-mail-results')?.dataset.admission==='complete');
 await results.evaluate(el=>el.scrollTop=200);const scroll=await results.evaluate(el=>el.scrollTop);
 const before=await results.locator('tbody tr').allTextContents(),calls=await page.evaluate(()=>window.mailCalls.filter(c=>c.action==='search').length);
 await page.evaluate(()=>{window.mailDelay=1800;window.arrive();});
 await page.waitForTimeout(3300);
 const during={disabled:await page.getByRole('button',{name:'업무 메일 21',exact:true}).isDisabled(),searchCalls:await page.evaluate(()=>window.mailCalls.filter(c=>c.action==='search').length)};
 if(process.argv.includes('--baseline')){
  await page.waitForTimeout(2300);const baseline={during,page:await page.locator('.nubi-mail-page-options>summary').innerText(),scrollBefore:scroll,scrollAfter:await results.evaluate(el=>el.scrollTop)};
  await writeFile(path.join(dir,'before.json'),JSON.stringify(baseline,null,2));console.log(JSON.stringify(baseline));
 }else{
  assert.equal(during.disabled,false);assert.equal(during.searchCalls,calls);assert.deepEqual(await results.locator('tbody tr').allTextContents(),before);assert.equal(await results.evaluate(el=>el.scrollTop),scroll);
  assert.equal(await page.evaluate(()=>window.mailCalls.filter(c=>c.action==='history').length),0);
  assert(await page.evaluate(()=>window.mailCalls.filter(c=>c.action==='status').every(c=>c.includeMessages===false)));
  assert(await page.getByRole('checkbox',{name:'업무 메일 22 선택',exact:true}).isChecked());
  await captureDesign(page,{path:path.join(dir,'update-available.png')});
  await page.setViewportSize({width:600,height:900});
  const update=page.getByRole('button',{name:'메일 목록 업데이트',exact:true});
  assert(await update.isVisible());assert.equal(await update.locator('span').isVisible(),false);
  assert(await page.locator('.nubi-mail-result-toolbar').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
  await captureDesign(page,{path:path.join(dir,'narrow.png')});await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button',{name:'업무 메일 23',exact:true}).click();await page.getByRole('heading',{name:'업무 메일 23',exact:true}).waitFor();
  await results.evaluate(el=>el.scrollTop=200);
  await page.getByRole('button',{name:'메일 목록 업데이트',exact:true}).click();await page.waitForTimeout(2100);
  assert.equal(await page.evaluate(()=>window.mailCalls.filter(c=>c.action==='portalSync').length),0);
  assert.match(await page.locator('.nubi-mail-page-options>summary').innerText(),/21–40/);assert.equal(await results.evaluate(el=>el.scrollTop),scroll);
  assert(await page.getByRole('checkbox',{name:'업무 메일 22 선택',exact:true}).isChecked());await page.getByRole('heading',{name:'업무 메일 23',exact:true}).waitFor();
  const searchesBeforeCheck=await page.evaluate(()=>window.mailCalls.filter(c=>c.action==='search').length);
  await page.getByRole('button',{name:'새 메일 확인',exact:true}).click();
  await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.mailCalls.filter(c=>c.action==='search').length),searchesBeforeCheck);
  assert.equal(await page.evaluate(()=>window.mailCalls.filter(c=>c.action==='portalSync').length),1);
  assert.equal(await page.evaluate(()=>window.mailCalls.filter(c=>c.action==='history').length),0);
  await captureDesign(page,{path:path.join(dir,'reading.png')});
  await page.evaluate(()=>{window.mailDelay=0;window.arrive();});await page.waitForTimeout(3100);
  await page.getByRole('button',{name:'다음 메일 페이지',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.nubi-mail-page-options>summary')?.textContent.includes('41–60'));
  assert.equal(await page.getByRole('button',{name:'메일 목록 업데이트',exact:true}).count(),0);
  assert.equal(await results.evaluate(el=>el.scrollTop),0,'a new page still restores a previously scrolled list to top');
  await page.evaluate(()=>{window.arrive();window.mailFail=true;});await page.waitForTimeout(3100);await page.getByRole('button',{name:'메일 목록 업데이트',exact:true}).click();await page.waitForTimeout(100);
  assert(await results.locator('tbody tr').count()>0);assert.equal(await results.locator('.nubi-mail-result').first().isDisabled(),false);
  await page.evaluate(()=>{window.mailFail=false;window.switchAccount();});await page.waitForTimeout(3300);
  await page.getByRole('button',{name:'다른 계정 메일',exact:true}).waitFor();assert.equal(await page.getByRole('heading',{name:'업무 메일 23',exact:true}).count(),0);assert.equal(await results.locator('input:checked').count(),0);
  assert.deepEqual(errors,[]);await captureDesign(page,{path:path.join(dir,'after.png')});await writeFile(path.join(dir,'result.json'),JSON.stringify({passed:true,calls,during,scroll,errors},null,2));console.log('Mail stability passed: arrivals, selection, scroll, reader, explicit update, page navigation, refresh failure and account switch.');
 }
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));stopBuildService();}
