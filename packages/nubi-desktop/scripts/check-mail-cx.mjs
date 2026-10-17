import {build} from 'esbuild';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
const stage=process.argv.includes('--baseline')?'before':'after',dir=path.resolve('verification/mail-cx-final-2026-10-15');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/mail-cx-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{'process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(dir+path.sep))throw Error();res.setHeader('content-type',({'.css':'text/css','.js':'text/javascript','.woff2':'font/woff2','.svg':'image/svg+xml'})[path.extname(file)]||'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;const results=[],errors=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
 for(const width of [1000,440,360])for(const large of [false,true])for(const view of ['settings','background','reader','reset']){
  await page.setViewportSize({width,height:900});await page.emulateMedia({reducedMotion:'reduce'});await page.goto(`http://127.0.0.1:${server.address().port}/?view=${view}${large?'&large':''}`);await page.locator(view==='reader'?'.nubi-mail-attachments':'.deck-dialog').waitFor();await page.evaluate(()=>document.fonts.ready);
  const facts=await page.evaluate(({view})=>{
   const root=document.querySelector(view==='reader'?'.nubi-mail-reader-content':'.deck-dialog'),rect=root.getBoundingClientRect();
   const style=selector=>{const el=root.querySelector(selector);if(!el)return null;const css=getComputedStyle(el);return {font:css.fontFamily,size:parseFloat(css.fontSize),weight:css.fontWeight,line:css.lineHeight,color:css.color};};
   const buttons=[...root.querySelectorAll('button')].filter(el=>el.checkVisibility()).map(el=>{const r=el.getBoundingClientRect(),css=getComputedStyle(el);return {copy:!!el.closest('.copy-control'),label:el.getAttribute('aria-label')||el.textContent.trim(),w:r.width,h:r.height,role:el.getAttribute('role'),size:parseFloat(css.fontSize),font:css.fontFamily};});
   return {view,bounds:rect.left>=0&&rect.right<=innerWidth+1&&(view==='reader'||rect.top>=0&&rect.bottom<=innerHeight+1),overflow:root.scrollWidth>root.clientWidth+1,title:style('h2'),primary:style(view==='reader'?'.nubi-mail-attachment-label strong':view==='background'?'.nubi-mail-background-copy strong':view==='settings'?'.nubi-mail-connected strong':'.deck-confirmation-copy strong'),secondary:style(view==='reader'?'.nubi-mail-attachment-label small':view==='background'?'.nubi-mail-background-copy span':'.nubi-muted'),buttons,fontsReady:document.fonts.check('15px "Pretendard Variable"'),insets:[...root.querySelectorAll(':scope>.cx-panel-header,:scope>.cx-panel-body,:scope>.cx-panel-footer')].map(el=>getComputedStyle(el).paddingInlineStart)};
  },{view});
  if(stage==='after'){
   assert(facts.bounds&&!facts.overflow,`${view} ${width} bounds`);
   assert(facts.title.font.includes('Pretendard'));assert.equal(facts.title.weight,'600');
   if(view==='settings'){
    const scope=page.getByRole('region',{name:'수집 범위'});await scope.waitFor();
    assert.equal(await scope.locator('details').filter({has:page.getByText('첨부 원본도 보관',{exact:true})}).count(),0);
    const checkbox=scope.getByRole('switch',{name:'첨부 원본도 보관'});await checkbox.uncheck();await page.getByText('읽은 내용만 보관 / 원본 다운로드 불가').waitFor();
    await checkbox.check();await scope.getByRole('button',{name:'원본 위치 변경'}).waitFor();
    assert(await scope.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
   }
   if(view==='background'){assert.equal(facts.primary.size,large?17:15);assert.equal(facts.secondary.size,large?16:14);assert.equal(facts.primary.weight,'600');}
   if(view==='reader'){assert.equal(facts.primary.size,large?17:15);assert.equal(facts.secondary.size,large?16:14);assert.equal(facts.primary.weight,'600');assert.equal(facts.primary.color,'rgb(25, 31, 40)');assert.equal(facts.title.size,18);assert(await page.locator('.nubi-mail-attachment-label small').evaluateAll(nodes=>nodes.every(el=>el.title===el.textContent)));}
   if(view!=='reader'){assert.equal(new Set(facts.insets).size,1);assert(facts.buttons.every(item=>item.label&&(item.role==='switch'||(item.copy?item.h>=24:item.h>=39))&&item.size===(large?17:15)),JSON.stringify({view,width,large,buttons:facts.buttons}));for(let i=0;i<8;i++){await page.keyboard.press('Tab');assert(await page.locator('.deck-dialog').evaluate(el=>el.contains(document.activeElement)),'focus stays in modal');}}
  }
  await page.screenshot({path:path.join(dir,`${stage}-${view}-${width}${large?'-large':''}.png`),animations:'disabled'});results.push({width,large,...facts});
  if(stage==='after'&&view==='settings'){
   await page.getByRole('button',{name:'원본 위치 변경',exact:true}).click();const storage=page.locator('.nubi-mail-storage-setup');await storage.waitFor();
   assert(await storage.evaluate(el=>{const rect=el.getBoundingClientRect();return el.scrollWidth<=el.clientWidth+1&&rect.left>=0&&rect.right<=innerWidth+1;}));
   await storage.getByRole('switch',{name:'첨부 원본도 보관'}).uncheck();
   await page.screenshot({path:path.join(dir,`after-storage-${width}${large?'-large':''}.png`),animations:'disabled'});
  }
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,stage+'.json'),JSON.stringify({results,errors},null,2));console.log(JSON.stringify(results.map(({view,width,large,primary,secondary,bounds,overflow})=>({view,width,large,primary,secondary,bounds,overflow})),null,2));
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
