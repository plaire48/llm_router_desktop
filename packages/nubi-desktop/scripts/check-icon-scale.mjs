import {build,stop} from 'esbuild';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {rendererBundleOptions} from './renderer-bundle.mjs';

const baseline=process.argv.includes('--baseline'),phase=baseline?'before':'after';
const dir=path.resolve('verification/icon-scale-2026-10-17'),bundle=dir+(baseline?'/fixture-before':'/fixture');await mkdir(bundle,{recursive:true});
if(baseline){
 // Reuse the already verified pre-icon build, not a recreation from new CSS.
 if(!await readFile(bundle+'/app.css','utf8').catch(()=>null))await cp('verification/all-surfaces/fixture',bundle,{recursive:true});
 assert(!(await readFile(bundle+'/app.css','utf8')).includes('design/workspace-icons.css'),'baseline must precede the icon adaptation');
}else{
 await build({...rendererBundleOptions(),entryPoints:['tests/surface-audit-fixture.jsx'],entryNames:'app',outdir:bundle,minify:false,splitting:false});stop();
}
await cp('../../extensions/aipro-chat/public/icons',bundle+'/icons',{recursive:true});
await writeFile(bundle+'/index.html','<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><div class="desktop-shell" data-platform="darwin" data-toolbar="true" data-layout="split"><div id="toolbar" class="desktop-titlebar"></div><div class="desktop-workspace-body"><div class="desktop-agent" id="root"></div></div></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(bundle,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(bundle+path.sep))throw Error();const data=await readFile(file);res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser,page;const records=[],errors=[];
async function measure(name,selector,size){
 const icons=await page.locator(selector).evaluateAll(nodes=>nodes.filter(n=>n.checkVisibility()).map(n=>{const r=n.getBoundingClientRect(),b=n.closest('button,summary,a,[role=button]')?.getBoundingClientRect();return {name:n.dataset.icon||n.closest('button')?.getAttribute('aria-label'),width:r.width,height:r.height,target:b?{width:b.width,height:b.height}:null};}));
 assert(icons.length,name+': visible glyphs');
 if(!baseline)for(const icon of icons){assert(Math.abs(icon.width-size)<.2&&Math.abs(icon.height-size)<.2,name+': glyph size '+JSON.stringify(icon));if(icon.target)assert(icon.target.width>=icon.width&&icon.target.height>=icon.height,name+': target contains glyph');}
 records.push({name,icons});
}
try{
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});page=await browser.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 for(const [width,root,touch] of (baseline?[[1280,16],[440,20]]:[[1280,16],[440,20],[440,16,true]])){
  if(touch){await page.close();page=await browser.newPage({hasTouch:true});page.on('pageerror',e=>errors.push(e.message));}
  const suffix=width+(touch?'-touch':'');
  await page.setViewportSize({width,height:950});await page.goto(`http://127.0.0.1:${server.address().port}/?screen=workbench&integrated&context&modals&toolbar`);await page.locator('.nubi-sidebar').waitFor({state:'attached'});await page.evaluate(root=>{document.documentElement.style.fontSize=root+'px';},root);await page.emulateMedia({reducedMotion:'reduce'});
  const opener=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();
  await page.getByRole('button',{name:'대화 검색',exact:true}).click();await page.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').first().click();
  const reopen=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await reopen.count())await reopen.click();
  await page.evaluate(()=>document.fonts.ready);
  const k=root/16;
  if(!baseline){
   const rail=await page.locator('.nubi-workspace-rail').evaluate(e=>{const r=e.getBoundingClientRect();return {width:r.width,overflow:e.scrollWidth>e.clientWidth,client:e.clientWidth,scroll:e.scrollWidth,buttons:[...e.querySelectorAll('button')].filter(b=>b.checkVisibility()).map(b=>{const t=b.getBoundingClientRect();return {label:b.getAttribute('aria-label'),width:t.width,height:t.height,inside:t.left>=r.left&&t.right<=r.right};})};});
   assert.equal(rail.width,56,'slim navigation rail');assert(!rail.overflow,'no horizontal rail clipping '+JSON.stringify(rail));
   for(const b of rail.buttons)assert(b.width>=44&&b.height>=44&&b.inside,'rail click target '+JSON.stringify(b));
  }
  await measure('navigation-'+suffix,'.nubi-workspace-rail button > svg',20*k);
  await measure('toolbar-'+suffix,'.nubi-toolbar-actions > button > svg',17*k);
  await measure('conversation-'+suffix,'.nubi-session-select > svg',14*k);
  const close=page.getByRole('button',{name:'사이드바 접기',exact:true});if(width===440&&await close.count())await close.click();
  await measure('composer-'+suffix,'.composer-tools > button:not(.context-trigger) > svg',16*k);
  if(!baseline)await measure('send-'+suffix,'.composer button[aria-label="전송"] > svg',16*k);
  await page.screenshot({path:`${dir}/${phase}-conversation-${suffix}.png`});
  await page.getByRole('button',{name:'설정',exact:true}).click();await page.getByRole('dialog',{name:'설정',exact:true}).waitFor();
  await measure('dialog-close-'+suffix,'.deck-dialog .cx-panel-header-actions [data-action=close] > svg',16*k);
  if(!baseline){const target=records.at(-1).icons[0].target;assert(target.width>=40&&target.height>=40,'close click target remains 40px');}
  if(touch){assert(await page.evaluate(()=>matchMedia('(pointer:coarse)').matches));for(const record of records.filter(r=>r.name.endsWith('-touch')&&!r.name.startsWith('conversation')))for(const icon of record.icons)assert(icon.target.width>=44&&icon.target.height>=44,'touch target: '+JSON.stringify(icon));}
  await page.getByRole('dialog',{name:'설정',exact:true}).screenshot({path:`${dir}/${phase}-settings-${suffix}.png`});await page.keyboard.press('Escape');
 }
 if(!baseline){
  await page.setViewportSize({width:1280,height:950});
  await page.goto(`http://127.0.0.1:${server.address().port}/?screen=workbench&integrated`);
  await page.locator('.provider-button[data-provider]').first().waitFor();
  const colors=await page.locator('.provider-button[data-provider]').evaluateAll(nodes=>nodes.map(e=>{const s=getComputedStyle(e),probe=document.createElement('i');e.append(probe);const provider=e.dataset.provider;probe.style.background=provider==='claude'?'var(--provider-claude-soft)':provider==='chatgpt'?'var(--provider-chatgpt)':`linear-gradient(112deg,var(--provider-${provider}-start),var(--provider-${provider}-end))`;const expected=getComputedStyle(probe);const result={provider,color:s.color,background:s.backgroundImage==='none'?s.backgroundColor:s.backgroundImage,expected:expected.backgroundImage==='none'?expected.backgroundColor:expected.backgroundImage};probe.remove();return result;}));
  assert.equal(colors.length,4,'all original provider identities');
  for(const color of colors)assert.equal(color.background,color.expected,'provider identity preserved: '+color.provider);
  await page.screenshot({path:`${dir}/provider-colors.png`});
  await writeFile(`${dir}/provider-colors.json`,JSON.stringify(colors,null,2));
 }
 assert.deepEqual(errors,[]);await writeFile(`${dir}/${phase}.json`,JSON.stringify({records,errors,boundary:'Actual production components and full Desktop CSS in Chrome with synthetic data. Pixel values are Nubi adaptations, not Apple-prescribed icon sizes.'},null,2));console.log(JSON.stringify({phase,groups:records.length,errors}));
}catch(error){await page?.screenshot({path:`${dir}/${phase}-failure.png`});throw error;}finally{await browser?.close();await new Promise(r=>server.close(r));}
