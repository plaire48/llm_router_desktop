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
  await page.getByText('Knox Desktop 연결됨',{exact:true}).waitFor();assert.equal(await dialog.getByText('원문 저장 위치',{exact:true}).count(),1);assert.equal(await dialog.getByRole('switch',{name:'첨부 원본도 보관'}).count(),0);await card.getByRole('button',{name:'열린 메일 읽기',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.mailCalls.filter(call=>call.action==='desktopSync').length),1);
  assert.equal(await page.evaluate(()=>window.mailCalls.filter(call=>/portal|connect$/.test(call.action)).length),0);
  await page.getByRole('switch',{name:'메일 자동 정리',exact:true}).click();assert.equal(await page.getByRole('switch',{name:'메일 자동 정리',exact:true}).getAttribute('aria-checked'),'false');
  await dialog.getByRole('button',{name:'메일 가져오기 설정 변경',exact:true}).click();
  const storage=page.getByRole('dialog',{name:'메일 가져오기 설정',exact:true});await storage.waitFor();await storage.getByRole('button',{name:'원문 저장 위치 선택',exact:true}).click();await storage.getByRole('button',{name:'저장하고 계속',exact:true}).click();await storage.waitFor({state:'hidden'});await dialog.getByText('/fixture/selected/raw/nubi-mail-raw',{exact:true}).waitFor();
  await assertDialogChrome(dialog);assert(await dialog.evaluate(node=>{const css=getComputedStyle(node);return css.getPropertyValue('--brand-action').trim()===css.getPropertyValue('--deck-blue-deep').trim();}),'actions retain the current shared semantic color');assert(await card.evaluate(node=>node.scrollWidth<=node.clientWidth+1));
  await captureDesign(page,{path:path.join(dir,`connected-${mode}-${width}.png`),fullPage:true});
  await page.getByRole('button',{name:'Knox Desktop 연결 해제',exact:true}).click();await card.getByRole('button',{name:'Knox Desktop에 연결',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.mailCalls.filter(call=>call.action==='disconnect').length),1);
  checks.push({width,mode,scope:'existing settings, encrypted UIA original path and folder selection, explicit window choice, UIA refresh, auto OFF, disconnect preserving metadata'});await page.close();
 }
 for(const method of ['portal','pop3']){
  page=await browser.newPage({viewport:{width:1280,height:1000},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port+'/?desktop='+method+'-compat');
  const dialog=page.getByRole('dialog',{name:'메일 설정',exact:true}),collection=dialog.getByRole('region',{name:'수집 범위',exact:true});await collection.waitFor();assert.equal(await page.getByRole('combobox',{name:'메일 연결 방식',exact:true}).locator('option[value="portal"]').count(),1,'the portal is a connection method (user request 2026-10-23)');assert.equal(await page.getByRole('region',{name:'Knox Desktop 메일',exact:true}).count(),0);
  await collection.getByText('원문 저장 위치',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'메일 가져오기 설정 변경',exact:true}).click();const storage=page.getByRole('dialog',{name:'메일 가져오기 설정',exact:true});await storage.waitFor();assert(await storage.getByRole('switch',{name:'첨부 원본도 보관',exact:true}).isVisible());
  await captureDesign(page,{path:path.join(dir,method+'-storage-compat.png'),fullPage:true});checks.push({method,scope:'explicit connection method overrides stale Desktop mode for original and attachment storage'});await page.close();
 }
 for(const method of ['desktop','pop3','portal','folder']){
  page=await browser.newPage({viewport:{width:method==='folder'?360:1280,height:1000},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+server.address().port+'/?intake=1&method='+(method==='folder'?'pop3':method));
  const enter=async()=>{if(method==='desktop')await page.getByRole('button',{name:'Knox Desktop에 연결',exact:true}).click();else if(method==='folder')await page.getByRole('region',{name:'파일에서 가져오기',exact:true}).getByRole('button',{name:'폴더 선택',exact:true}).click();else if(method==='portal')await page.getByRole('button',{name:'포털 로그인',exact:true}).click();else{const form=page.getByRole('form',{name:'POP3로 연결',exact:true});await form.getByRole('textbox',{name:'메일 아이디'}).fill('fixture-user');await form.locator('input[type=password]').fill('fixture-password');await form.getByRole('button',{name:'POP3로 연결',exact:true}).click();}};
  await enter();let setup=page.getByRole('dialog',{name:'메일 가져오기 설정',exact:true});await setup.waitFor();assert.equal(await page.evaluate(()=>window.mailCalls.filter(call=>['desktopConnect','connect','portalLogin','importMailFolder'].includes(call.action)).length),0);await setup.getByRole('button',{name:'취소',exact:true}).click();await setup.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.mailCalls.filter(call=>call.action==='configureIntake').length),0);
  await enter();setup=page.getByRole('dialog',{name:'메일 가져오기 설정',exact:true});await setup.waitFor();await setup.getByRole('combobox',{name:'가져올 메일 기간',exact:true}).click();await page.getByRole('option',{name:'최근 30일',exact:true}).click();await setup.locator('details').filter({has:page.locator('summary',{hasText:'제외할 메일'})}).locator('summary').click();await setup.getByRole('textbox',{name:'제외할 보낸 사람',exact:true}).fill('@excluded.example.test');
  await page.evaluate(()=>window.intakeFail=true);await setup.getByRole('button',{name:'저장하고 계속',exact:true}).click();await setup.getByRole('alert').waitFor();assert.equal(await setup.getByRole('textbox',{name:'제외할 보낸 사람',exact:true}).inputValue(),'@excluded.example.test');await page.evaluate(()=>window.intakeFail=false);await captureDesign(page,{path:path.join(dir,'intake-'+method+'.png'),fullPage:true});await setup.getByRole('button',{name:'저장하고 계속',exact:true}).click();await setup.waitFor({state:'hidden'});
  await page.waitForFunction(()=>window.mailCalls.some(call=>['desktopConnect','connect','portalLogin','importMailFolder'].includes(call.action)));assert.equal(await page.evaluate(()=>window.mailCalls.filter(call=>call.action==='configureIntake').at(-1).policy.period),'30');if(method==='pop3')await page.evaluate(()=>window.resolvePop3?.());
  checks.push({method,scope:'first-run settings before intake, cancel, failed save preserving draft, shared scope and continuation'});await page.close();
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({checks,errors,boundary:'Real Chrome rendering with synthetic host responses. Windows Knox UIA and installer not exercised.'},null,2));console.log('PASS',JSON.stringify(checks));
}catch(error){await page?.screenshot({path:path.join(dir,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
