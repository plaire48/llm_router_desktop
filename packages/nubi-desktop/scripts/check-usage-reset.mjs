import {build} from 'esbuild';
import {assertDesktopDialog} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
import {WELCOME_GREETINGS} from '../ui/welcome-greetings.mjs';
const dir=path.resolve('verification/usage-reset');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file','.webp':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

let browser;const errors=[];
try{
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});const p=await browser.newPage();p.setDefaultTimeout(12000);p.on('pageerror',e=>errors.push(e.message));
 for(const width of [1280,440,360]){
  await p.setViewportSize({width,height:900});await p.goto('http://127.0.0.1:'+server.address().port+'/?integrated&chatgpt-usage');
  const opener=p.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();
  await p.getByRole('button',{name:'대화 검색',exact:true}).click();await p.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').first().click();
  const closer=p.getByRole('button',{name:'사이드바 접기',exact:true});if(await closer.count())await closer.click();
  await p.getByRole('button',{name:'토큰 사용량',exact:true}).click();const dialog=p.getByRole('dialog',{name:'사용량',exact:true});
  await dialog.getByText('75% 남음',{exact:true}).waitFor();
  await dialog.getByText('23,223',{exact:true}).waitFor();
  const reset=dialog.getByRole('button',{name:'전체 초기화',exact:true});await reset.waitFor({timeout:5000});
  await p.evaluate(()=>window.usageResetFailure=true);await reset.click();await dialog.getByRole('alert').getByText('사용량을 초기화하지 못했어요. 다시 시도해 주세요.',{exact:true}).waitFor();await dialog.getByText('23,223',{exact:true}).waitFor();
  await p.evaluate(()=>window.usageResetFailure=false);await reset.click();await dialog.getByText('사용량을 초기화했어요.',{exact:true}).waitFor();assert.equal(await dialog.locator('.usage-total strong').textContent(),'0');await dialog.getByText('75% 남음',{exact:true}).waitFor();
  await dialog.getByRole('tab',{name:'전체',exact:true}).click();assert.equal(await dialog.locator('.usage-total strong').textContent(),'0');
  await p.keyboard.press('Escape');await p.getByRole('button',{name:'토큰 사용량',exact:true}).click();await dialog.locator('.usage-total strong').getByText('0',{exact:true}).waitFor();await dialog.getByText('75% 남음',{exact:true}).waitFor();
  assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth));assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await p.screenshot({path:path.join(dir,`reset-${width}.png`),animations:'disabled'});
 }
 assert.deepEqual(errors,[]);console.log('PASS: Workbench reset at 1280/440/360 clears today/total, survives reopen, preserves quota and surfaces reset errors. Synthetic API, not account reset.');
}catch(error){await browser?.contexts()[0]?.pages()[0]?.screenshot({path:path.join(dir,'failure.png')});throw error;}finally{server.closeAllConnections();await browser?.close();server.close();}
