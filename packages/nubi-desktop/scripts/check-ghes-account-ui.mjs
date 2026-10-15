import {build} from 'esbuild';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/ghes-profile-status-2026-10-16');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/ghes-account-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{'process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(dir+path.sep))throw Error();res.setHeader('content-type',({'.css':'text/css','.js':'text/javascript','.woff2':'font/woff2','.svg':'image/svg+xml'})[path.extname(file)]||'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;const results=[],errors=[];
try {
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://code.sdsdev.co.kr/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><text x="0" y="20" font-size="22">🚀</text></svg>'}));
 for(const width of [1100,440,360]){
  await page.setViewportSize({width,height:800});await page.emulateMedia({reducedMotion:'reduce'});await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const button=page.getByRole('button',{name:'누비 검토 계정 계정 메뉴'});await button.waitFor();
  await page.locator('.nubi-account-status-emoji').waitFor();
  const badgeCheck=async()=>{
   const facts=await page.locator('.nubi-account-status-emoji').evaluateAll(nodes=>nodes.map(e=>{const row=e.closest('.nubi-account-button,.nubi-account-name-row'),name=row.querySelector('.nubi-account-name-label,strong'),a=(name.checkVisibility()?name:row.querySelector('.nubi-account-avatar')).getBoundingClientRect(),b=e.getBoundingClientRect();return {visible:e.checkVisibility(),followsName:b.left>=a.right-1&&Math.abs((b.top+b.height/2)-(a.top+a.height/2))<4,inViewport:b.left>=0&&b.right<=innerWidth,position:getComputedStyle(e).position};}));
   assert(facts.every(x=>x.visible&&x.followsName&&x.inViewport&&x.position==='static'),JSON.stringify(facts));return facts;
  };
  await badgeCheck();await page.screenshot({path:path.join(dir,`toolbar-${width}.png`)});
  await button.click();await page.getByRole('dialog').waitFor();assert.equal(await page.locator('.nubi-account-status-emoji').count(),2);await badgeCheck();
  await page.screenshot({path:path.join(dir,`profile-${width}.png`)});
  await page.evaluate(()=>window.setProfileStatus({emoji:'',image:'https://code.sdsdev.co.kr/images/icons/emoji/shipit.png',name:'shipit',message:'배포 중'}));
  await page.waitForFunction(()=>[...document.querySelectorAll('.nubi-account-status-emoji img')].length===2&&[...document.querySelectorAll('.nubi-account-status-emoji img')].every(e=>e.complete&&e.naturalWidth>0));await badgeCheck();
  await page.screenshot({path:path.join(dir,`custom-${width}.png`)});
  await page.evaluate(()=>window.setProfileStatus({emoji:'😄',message:'expired',expiresAt:new Date(Date.now()-100).toISOString()}));await page.waitForFunction(()=>!document.querySelector('.nubi-account-status-emoji'));
  await page.evaluate(()=>window.setProfileStatus(null));assert.equal(await page.locator('.nubi-account-status-emoji').count(),0);
  results.push({width,unicode:true,customImage:true,expiredHidden:true,removedHidden:true});
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({results,errors,liveGhesVerified:false},null,2));console.log(JSON.stringify(results));
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
