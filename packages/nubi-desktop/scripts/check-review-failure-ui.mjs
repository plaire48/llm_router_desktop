import {captureDesign} from './design-rules.mjs';
import {build} from 'esbuild';
import {assertDesktopDialog} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
import {WELCOME_GREETINGS} from '../ui/welcome-greetings.mjs';
const dir=path.resolve('verification/review-failure');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file','.webp':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));





let browser;try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 for(const width of [1280,440,360]){
  await page.setViewportSize({width,height:950});await page.goto('http://127.0.0.1:'+server.address().port+'/?integrated&review-failure=review_schema_invalid');
  const reveal=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await reveal.count())await reveal.click();
  await page.locator('.nubi-session-select').filter({hasText:'요구사항과 결과를 확인해 주세요.'}).click();
  const review=page.getByRole('region',{name:'분석 결과 검토'});await review.getByText('결과 검토를 마치지 못했어요',{exact:true}).waitFor();
  await review.getByText(/AI의 검토 항목과 근거가 맞지 않아요/).waitFor();await review.locator('summary').click();await review.getByText('review_schema_invalid',{exact:true}).waitFor();
  const style=await review.locator('.nubi-document-progress-heading').evaluate(el=>({color:getComputedStyle(el).color,icon:getComputedStyle(el.querySelector('svg')).color,font:getComputedStyle(el.querySelector('strong')).fontSize,weight:getComputedStyle(el.querySelector('strong')).fontWeight}));
  assert.equal(style.color,style.icon);assert.equal(style.font,'15px');assert.equal(style.weight,'600');assert(await review.evaluate(el=>el.scrollWidth<=el.clientWidth));
  await captureDesign(review,{path:dir+'/'+width+'.png'});console.log('PASS review failure '+width+'px: visible cause/code, semantic icon color, 15px/600, no horizontal overflow');
 }
}finally{await browser?.close();server.close();}
