import {build,stop} from 'esbuild';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir=path.resolve('verification/ghes-identity-2026-10-18');
await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file','.webp':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{
 const file=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));
 if(!file.startsWith(dir+path.sep))throw Error();
 res.setHeader('content-type',({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));
}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;const errors=[],results=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 page.on('pageerror',error=>errors.push(error.message));
 for(const width of [1280,440])for(const connected of [false,true]){
  await page.setViewportSize({width,height:900});
  await page.goto(`http://127.0.0.1:${server.address().port}/?context&modals&integrated${connected?'&company-connected':''}`);
  const button=page.locator('.nubi-workspace-rail .nubi-account-button');
  await button.locator(connected?'img':'.nubi-account-avatar svg').waitFor();
  assert.equal(await button.getAttribute('data-connected'),String(connected));
  const photo=button.locator('.nubi-account-avatar-photo');
  const geometry=await photo.evaluate(element=>{const r=element.getBoundingClientRect(),s=getComputedStyle(element);return {width:r.width,height:r.height,clipPath:s.clipPath};});
  assert(geometry.width>=20&&geometry.height>=20&&geometry.clipPath==='none',`GitHub identity must stay visible in the rail: ${JSON.stringify({width,connected,...geometry})}`);
  if(connected){
   assert(await button.locator('img').evaluate(image=>image.complete&&image.naturalWidth>0),'connected GitHub profile photo loads');
   assert.equal(await button.locator('.nubi-account-name-label').evaluate(element=>getComputedStyle(element).display),'none','narrow rail keeps the profile name in its tooltip instead of overflowing');
  }
  else assert.match(await button.getAttribute('title'),/GitHub/);
  await page.screenshot({path:path.join(dir,`${connected?'profile':'github'}-${width}.png`)});
  results.push({width,connected,...geometry});
 }
 assert.deepEqual(errors,[]);
 await writeFile(path.join(dir,'result.json'),JSON.stringify({results,errors,liveGhesVerified:false},null,2));
 console.log('GitHub identity passed: guest icon and connected profile photo at 1280/440px.');
}finally{server.closeAllConnections();await browser?.close();await new Promise(resolve=>server.close(resolve));stop();}
