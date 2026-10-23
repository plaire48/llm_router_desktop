import {build,stop} from 'esbuild';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {captureDesign} from './design-rules.mjs';
import {assertDialogChrome} from './identity-browser.mjs';
const dir=path.resolve('verification/desktop-mail-uia-2026-10-23');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/mail-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.svg':'file','.webp':'file','.woff2':'file','.woff':'file'},define:{'process.env.NODE_ENV':'"production"'}});stop();
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Knox 메일 검증</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(dir+path.sep))throw Error();const data=await readFile(file);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser,page;const checks=[],errors=[];
try{
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});
 for(const width of [1280,440])for(const mode of ['single','multiple']){
  page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?desktop='+mode);
  const dialog=page.getByRole('dialog',{name:'메일 설정',exact:true}),card=page.getByRole('region',{name:'Knox Desktop 메일',exact:true});
  await card.waitFor();assert.equal(await page.locator('input[type=password]').count(),0);assert.equal(await page.evaluate(()=>window.mailCalls.length),0);
  assert.equal(await page.getByRole('button',{name:'포털로 직접 연결',exact:true}).isVisible(),false);
  await captureDesign(page,{path:path.join(dir,`entry-${mode}-${width}.png`),fullPage:true});
  await card.getByRole('button',{name:'Knox Desktop에 연결',exact:true}).click();
  if(mode==='multiple'){
   const connect=card.getByRole('button',{name:'선택한 창 연결',exact:true});await connect.waitFor();assert(await connect.isDisabled());assert.equal(await page.getByText('Knox Desktop 연결됨',{exact:true}).count(),0);
   await card.getByRole('combobox',{name:'Knox Desktop 창 선택',exact:true}).click();await page.getByRole('option',{name:'Knox Desktop 다른 창',exact:true}).click();await connect.click();
   assert.equal(await page.evaluate(()=>window.mailCalls.filter(call=>call.action==='desktopConnect').at(-1).profileId),'two');
  }
  await page.getByText('Knox Desktop 연결됨',{exact:true}).waitFor();await dialog.getByText('화면에서 읽은 원문 보관',{exact:true}).waitFor();assert.equal(await dialog.getByText('원문 저장 위치',{exact:true}).count(),1);assert.equal(await dialog.getByRole('switch',{name:'첨부 원본도 보관'}).count(),0);await card.getByRole('button',{name:'열린 메일 읽기',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.mailCalls.filter(call=>call.action==='desktopSync').length),1);
  assert.equal(await page.evaluate(()=>window.mailCalls.filter(call=>/portal|connect$/.test(call.action)).length),0);
  await page.getByRole('switch',{name:'메일 자동 정리',exact:true}).click();assert.equal(await page.getByRole('switch',{name:'메일 자동 정리',exact:true}).getAttribute('aria-checked'),'false');
  await dialog.getByRole('button',{name:'원본 위치 변경',exact:true}).click();
  const storage=page.getByRole('dialog',{name:'메일 보관 설정',exact:true});await storage.waitFor();assert.equal(await storage.getByRole('switch',{name:'첨부 원본도 보관',exact:true}).count(),0);await storage.getByRole('button',{name:'폴더 선택',exact:true}).click();await storage.waitFor({state:'hidden'});await dialog.getByText('/fixture/selected/uia-originals',{exact:true}).waitFor();
  await assertDialogChrome(dialog);assert(await dialog.evaluate(node=>{const css=getComputedStyle(node);return css.getPropertyValue('--brand-action').trim()===css.getPropertyValue('--deck-blue-deep').trim();}),'actions retain the current shared semantic color');assert(await card.evaluate(node=>node.scrollWidth<=node.clientWidth+1));
  await captureDesign(page,{path:path.join(dir,`connected-${mode}-${width}.png`),fullPage:true});
  await page.getByRole('button',{name:'Knox Desktop 연결 해제',exact:true}).click();await card.getByRole('button',{name:'Knox Desktop에 연결',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.mailCalls.filter(call=>call.action==='disconnect').length),1);
  checks.push({width,mode,scope:'existing settings, encrypted UIA original path and folder selection, explicit window choice, UIA refresh, auto OFF, disconnect preserving metadata'});await page.close();
 }
 // The portal is off in the product (user decision 2026-10-23): a saved portal choice opens as Knox Desktop with no portal option.
 page=await browser.newPage({viewport:{width:1280,height:1000},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port+'/?desktop=portal-compat');
 await page.getByRole('region',{name:'Knox Desktop 메일',exact:true}).waitFor();assert.equal(await page.locator('option[value="portal"]').count(),0,'no portal option while the portal is off');
 checks.push({method:'portal',scope:'a saved portal choice opens as Knox Desktop while the portal is off'});await page.close();
 for(const method of ['pop3']){
  page=await browser.newPage({viewport:{width:1280,height:1000},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port+'/?desktop='+method+'-compat');
  const dialog=page.getByRole('dialog',{name:'메일 설정',exact:true}),collection=dialog.getByRole('region',{name:'수집 범위',exact:true});await collection.waitFor();assert.equal(await page.getByRole('region',{name:'Knox Desktop 메일',exact:true}).count(),0);
  await collection.getByText('본문과 첨부 내용',{exact:true}).waitFor();assert(await collection.getByRole('switch',{name:'첨부 원본도 보관',exact:true}).isVisible());
  await dialog.getByRole('button',{name:'원본 위치 변경',exact:true}).click();const storage=page.getByRole('dialog',{name:'메일 보관 설정',exact:true});await storage.waitFor();assert(await storage.getByRole('switch',{name:'첨부 원본도 보관',exact:true}).isVisible());
  await captureDesign(page,{path:path.join(dir,method+'-storage-compat.png'),fullPage:true});checks.push({method,scope:'explicit connection method overrides stale Desktop mode for original and attachment storage'});await page.close();
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({checks,errors,boundary:'Real Chrome rendering with synthetic host responses. Windows Knox UIA and installer not exercised.'},null,2));console.log('PASS',JSON.stringify(checks));
}catch(error){await page?.screenshot({path:path.join(dir,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
