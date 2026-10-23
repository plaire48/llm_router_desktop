import {build,stop} from 'esbuild';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {captureDesign} from './design-rules.mjs';
import {assertDesktopDialog} from './identity-browser.mjs';
const dir=path.resolve('verification/desktop-mail-2026-10-22');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/mail-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.webp':'file','.woff2':'file','.woff':'file'},define:{'process.env.NODE_ENV':'"production"'}});stop();
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
  await card.getByRole('button',{name:'저장된 메일 연결',exact:true}).click();
  if(mode==='multiple'){
   const connect=card.getByRole('button',{name:'선택한 저장소 연결',exact:true});await connect.waitFor();assert(await connect.isDisabled());assert.equal(await page.getByText('Knox Desktop 연결됨',{exact:true}).count(),0);
   await card.getByRole('combobox',{name:'Knox 메일 저장소 선택',exact:true}).click();await page.getByRole('option',{name:'P200_other',exact:true}).click();await connect.click();
   assert.equal(await page.evaluate(()=>window.mailCalls.filter(call=>call.action==='desktopConnect').at(-1).profileId),'two');
  }
  await page.getByText('Knox Desktop 연결됨',{exact:true}).waitFor();await dialog.getByText('원문은 Knox에 보관',{exact:true}).waitFor();assert.equal(await dialog.getByText('원문 저장 위치',{exact:true}).count(),0);assert.equal(await dialog.getByRole('checkbox',{name:'첨부 원본도 보관'}).count(),0);await card.getByRole('button',{name:'새 파일 확인',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.mailCalls.filter(call=>call.action==='desktopSync').length),1);
  assert.equal(await page.evaluate(()=>window.mailCalls.filter(call=>/portal|connect$/.test(call.action)).length),0);
  await page.getByRole('switch',{name:'메일 자동 정리',exact:true}).click();assert.equal(await page.getByRole('switch',{name:'메일 자동 정리',exact:true}).getAttribute('aria-checked'),'false');
  await assertDesktopDialog(dialog);assert(await card.evaluate(node=>node.scrollWidth<=node.clientWidth+1));
  await captureDesign(page,{path:path.join(dir,`connected-${mode}-${width}.png`),fullPage:true});
  await page.getByRole('button',{name:'Knox 저장소 연결 해제',exact:true}).click();await card.getByRole('button',{name:'저장된 메일 연결',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.mailCalls.filter(call=>call.action==='disconnect').length),1);
  checks.push({width,mode,scope:'existing settings, reference-only storage, explicit account choice, local refresh, auto OFF, disconnect preserving metadata'});await page.close();
 }
 // The mail source choice (user decision 2026-10-23): 1. Knox Desktop Message, 2. POP3, no portal; POP3 remembers only the login ID.
 for(const width of [1280,440]){
  page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/?desktop=single&pop3User=user01');
  const choice=page.getByRole('radiogroup',{name:'메일 받는 방식',exact:true});await choice.waitFor();
  const pop3=choice.getByRole('radio',{name:/POP3/}),knox=choice.getByRole('radio',{name:/Knox Desktop Message/});
  assert.deepEqual(await choice.getByRole('radio').evaluateAll(nodes=>nodes.map(node=>node.value)),['desktop','pop3'],'Knox Desktop Message is option 1, POP3 option 2');assert.equal(await pop3.isChecked(),false);assert.equal(await knox.isChecked(),true,'Knox Desktop is the default');
  assert.equal(await page.getByRole('button',{name:/포털/}).count(),0,'no portal connection while it is off');
  await page.getByRole('region',{name:'Knox Desktop 메일',exact:true}).waitFor();assert.equal(await page.locator('input[type=password]').count(),0);
  await pop3.check();const form=page.getByRole('form',{name:'POP3로 연결',exact:true});await form.waitFor();
  assert.equal(await page.getByRole('region',{name:'Knox Desktop 메일',exact:true}).count(),0);
  assert.equal(await form.getByRole('textbox',{name:'메일 아이디',exact:true}).inputValue(),'user01','the remembered ID is filled in');
  const remember=form.getByRole('checkbox',{name:'아이디 기억',exact:true});assert.equal(await remember.isChecked(),true);
  await form.locator('input[type=password]').fill('synthetic-only-password');await remember.uncheck();
  await captureDesign(page,{path:path.join(dir,`choice-pop3-${width}.png`),fullPage:true});assert(await form.evaluate(node=>node.scrollWidth<=node.clientWidth+1));
  await form.getByRole('button',{name:'POP3로 연결',exact:true}).click();await page.waitForFunction(()=>window.mailCalls.some(call=>call.action==='connect'));
  assert.equal(await form.locator('input[type=password]').inputValue(),'','the password leaves the form when it is sent');
  const call=await page.evaluate(()=>window.mailCalls.find(item=>item.action==='connect'));assert.equal(call.user,'user01');assert.equal(call.rememberUser,false);assert.equal(call.serverProfile,'company');
  await page.evaluate(()=>window.resolvePop3());await page.getByText(/POP3로 연결됨/).waitFor();
  checks.push({width,scope:'source choice: Knox default, no portal, POP3 with remembered ID, remember toggle, password cleared'});await page.close();
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({checks,errors,boundary:'Real Chrome rendering with synthetic host responses. Windows Knox filesystem and installer not exercised.'},null,2));console.log('PASS',JSON.stringify(checks));
}catch(error){await page?.screenshot({path:path.join(dir,'failure.png'),fullPage:true}).catch(()=>{});throw error;}
finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
