import {build} from 'esbuild';
import {assertDesktopDialog} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/question-alignment');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/question-alignment-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file','.svg':'dataurl'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try {
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({reducedMotion:'reduce'});
 const measurements=[];
 for(const width of [900,440,360]){
  await page.setViewportSize({width,height:850});await page.goto('http://127.0.0.1:'+server.address().port);await page.getByRole('textbox').waitFor();await page.evaluate(()=>document.fonts.ready);
  for(const text of ['', '첫 번째 줄\n두 번째 줄\n세 번째 줄']){
   await page.getByRole('textbox').fill(text);
   const geometry=await page.locator('.interaction-entry').evaluate(entry=>{const icon=entry.querySelector('svg').getBoundingClientRect(),field=entry.querySelector('textarea'),r=field.getBoundingClientRect(),s=getComputedStyle(field);return {offset:Math.abs(icon.y+icon.height/2-(r.y+parseFloat(s.paddingTop)+parseFloat(s.lineHeight)/2)),overflow:entry.scrollWidth>entry.clientWidth,iconY:icon.y,fieldY:r.y,lineHeight:s.lineHeight,padding:s.paddingTop,border:s.borderTopWidth};});
   measurements.push({width,multiline:!!text,...geometry});
   if(!process.argv.includes('--baseline')){assert(geometry.offset<=1,JSON.stringify(geometry));assert.equal(geometry.overflow,false);}
  }
  await page.getByRole('textbox').fill('');
  const choice=page.getByRole('checkbox').first();await choice.click();assert.equal(await choice.getAttribute('aria-checked'),'true');
  const tick=await choice.locator('.question-option-index').boundingBox(),row=await choice.boundingBox();assert(tick.x-row.x>=11,'Check has a safe left inset');assert(Math.abs(tick.y+tick.height/2-(row.y+row.height/2))<1,'Check is centered');assert.equal(tick.width,20);assert.equal(tick.height,20);
  const send=page.getByRole('button',{name:'답변 보내기',exact:true});assert(await send.isEnabled());
  const rect=await send.boundingBox();assert(rect.x>=0&&rect.x+rect.width<=width,'Send must remain visible');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await choice.hover();await page.getByRole('tooltip').waitFor();assert((await page.getByRole('tooltip').innerText()).includes('전체 조건'));await send.click();assert.equal(await page.evaluate(()=>window.answers.length),1);
  await page.screenshot({path:dir+'/'+width+(process.argv.includes('--baseline')?'-before':'-after')+'.png'});
 }
 console.log(JSON.stringify(measurements));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
