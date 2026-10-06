import {build} from 'esbuild';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';

const dir=path.resolve('verification/workspace-design');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/workspace-design-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>누비 Workspace 디자인 검증</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(dir+path.sep))throw Error();const data=await readFile(file);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.woff2':'font/woff2','.webp':'image/webp','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port,checks=[],errors=[];
const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1280,height:950}});page.on('pageerror',e=>errors.push(e.message));
const contrast=({color,background})=>{const luminance=rgb=>{const c=rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};const values=[luminance(color),luminance(background)].sort((a,b)=>b-a);return (values[0]+.05)/(values[1]+.05);};
const fit=async()=>assert.equal(await page.locator('.nubi-workbench').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
try {
  await page.goto(origin+'/?solution=1');await page.getByRole('button',{name:'AI Pro',exact:true}).waitFor();
  await page.evaluate(()=>document.fonts.ready);assert.equal(await page.locator('.nubi-logo-title').innerText(),'누비 Workspace');assert.equal(await page.locator('.nubi-beta').innerText(),'Beta');
  await page.screenshot({path:path.join(dir,'login.png'),animations:'disabled'});checks.push('product title and Beta appear without replacing shared login or mascot');
  const badge=await page.locator('.nubi-agent-badge').evaluate(e=>{const s=getComputedStyle(e);return {color:s.color,background:s.backgroundColor,size:parseFloat(s.fontSize)};});assert(badge.size>=12&&contrast(badge)>=4.5);checks.push('received request badge has readable type and measured contrast above 4.5:1');
  const files=page.getByRole('navigation',{name:'프로젝트 도구'}).getByRole('button',{name:'파일',exact:true});await files.focus();await files.press('Enter');await page.getByRole('button',{name:'Git 변경',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.nativeViewCalls),['files','changes']);
  const target=await files.boundingBox();assert(target.width>=24&&target.height>=24);checks.push('named native project tools are keyboard operable and have sufficient target size');
  await page.getByRole('button',{name:'AI Pro',exact:true}).click();const draft=page.getByRole('textbox',{name:'작업 요청'});await draft.fill('기존 조건을 유지하고 변경 결과를 확인해 주세요.');await files.click();assert.equal(await draft.inputValue(),'기존 조건을 유지하고 변경 결과를 확인해 주세요.');checks.push('native navigation preserves the current request draft');
  await page.getByRole('button',{name:'매번 확인',exact:true}).click();await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.getByRole('menu',{name:'승인 방식'}).evaluate(e=>getComputedStyle(e).animationName),'none');await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.textContent.trim()),'매번 확인');checks.push('approval menu portal respects reduced motion and Escape restores keyboard focus');
  await page.emulateMedia({reducedMotion:'no-preference'});
  for(const width of [440,320]){await page.setViewportSize({width,height:950});await fit();assert.equal(await files.isVisible(),true);await page.screenshot({path:path.join(dir,'home-'+width+'.png'),animations:'disabled'});}checks.push('product title, native tools and composer fit 320px and 440px windows');
  await page.getByRole('button',{name:'큰 글자',exact:true}).click();await fit();await page.screenshot({path:path.join(dir,'large-320.png'),animations:'disabled'});checks.push('large text retains the same native navigation without horizontal overflow');
  await page.setViewportSize({width:1280,height:950});await page.getByRole('button',{name:'큰 글자',exact:true}).click();await page.getByRole('button',{name:'전송',exact:true}).click();await page.getByRole('article',{name:'누비 답변'}).waitFor();await page.screenshot({path:path.join(dir,'conversation.png'),animations:'disabled'});checks.push('request, plan and verified-state copy remain in one readable conversation column');
  await page.setViewportSize({width:320,height:950});await page.goto(origin+'/?noproject=1');await page.getByRole('button',{name:'AI Pro',exact:true}).click();await page.getByRole('button',{name:'폴더 열기',exact:true}).waitFor();await fit();assert.equal(await page.locator('.nubi-start-choices').evaluate(e=>e.scrollWidth<=e.clientWidth),true);await page.screenshot({path:path.join(dir,'project-start-320.png'),animations:'disabled'});checks.push('first-project folder and clone cards reflow at 320px');
  await page.emulateMedia({reducedMotion:'reduce'});
  for(const width of [1280,420,320]) {
    await page.setViewportSize({width,height:700});await page.goto(origin+'/?solution=1&integrated=1');await page.getByRole('button',{name:'AI Pro',exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);await fit();
    assert.equal(await page.locator('.nubi-workspace-rail').isVisible(),true);assert.equal(await page.locator('.nubi-workbench').evaluate(e=>e.getBoundingClientRect().height),700);
    assert.equal(await page.locator('.nubi-sidebar').isVisible(),width>760);
    const title=await page.locator('.nubi-logo-title').boundingBox();assert(title.x>=0&&title.x+title.width<=width,'full product name fits the allocated agent surface');
    if(width<=760) {await page.getByRole('button',{name:'사이드바 열기',exact:true}).click();await page.locator('.nubi-sidebar').waitFor({state:'visible'});await page.keyboard.press('Escape');assert.equal(await page.locator('.nubi-sidebar').isVisible(),false);}
    await page.screenshot({path:path.join(dir,'integrated-login-'+width+'.png'),animations:'disabled'});
  }
  checks.push('native agent rail, single product heading and project history fit 320/420/1280px at the allocated height');
  await page.getByRole('button',{name:'AI Pro',exact:true}).click();const integratedDraft=page.getByRole('textbox',{name:'작업 요청'});await integratedDraft.fill('파일을 확인한 뒤 같은 대화에서 이어 주세요.');
  for(const name of ['파일','Git 변경','검색','터미널','도구'])await page.getByRole('navigation',{name:'프로젝트 도구'}).getByRole('button',{name,exact:true}).click();
  assert.equal(await integratedDraft.inputValue(),'파일을 확인한 뒤 같은 대화에서 이어 주세요.');assert.deepEqual(await page.evaluate(()=>window.nativeViewCalls),['files','changes','search','terminal','commands']);
  checks.push('all five native tools keep the same conversation and request draft in the agent shell');
  assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({passed:true,checks,scope:'Actual Chromium rendering of fork shared components and synthetic model/project states. Native commands verified separately in VS Code.'},null,2));console.log(JSON.stringify({checks}));
} catch(error) {await page.screenshot({path:path.join(dir,'failure.png'),animations:'disabled'});await writeFile(path.join(dir,'failure.json'),JSON.stringify({error:error.message,checks,layout:await page.locator('.nubi-workbench,.nubi-workbench-layout,.nubi-workbench-content,.nubi-workspace-rail,.nubi-bar').evaluateAll(es=>es.map(e=>({class:e.className,rect:e.getBoundingClientRect().toJSON(),display:getComputedStyle(e).display,position:getComputedStyle(e).position})))},null,2));throw error;} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
