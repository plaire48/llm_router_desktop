import {build} from 'esbuild';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/activity-layout-2026-10-16');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file','.webp':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

let browser;const errors=[];
try {
 browser=await chromium.launch({channel:'chrome',headless:true});
 const p=await browser.newPage({viewport:{width:1280,height:950}});p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:'+server.address().port+'/?integrated&progress&activity-readability&timeline&activity-memos');
 const opener=p.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();
 await p.getByRole('button',{name:'대화 검색',exact:true}).click();await p.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').first().click();
 await p.locator('[data-timeline-kind="memo"]').first().waitFor();
 assert.equal(await p.locator('[data-timeline-kind="memo"]').count(),2);
 const kinds=await p.locator('[data-timeline-kind]').evaluateAll(els=>els.map(el=>el.dataset.timelineKind));
 assert.deepEqual(kinds,['note','tools','memo','tools','note','memo','tools']);
 assert.equal(await p.locator('.nubi-thoughts[open]').count(),0);
 assert.equal(await p.locator('.nubi-activity-sources').count(),1);
 const coordinates=await p.locator('.nubi-activity-record>summary,.nubi-thoughts>summary,.nubi-activity-sources>summary,.nubi-command-record>summary').evaluateAll(els=>els.map(el=>({kind:el.parentElement.className,x:el.getBoundingClientRect().x,icon:el.querySelector('svg')?.getBoundingClientRect().x,text:[...el.children].find(c=>c.tagName!=='svg')?.getBoundingClientRect().x})));
 assert(coordinates.length>=5);
 assert(Math.max(...coordinates.map(c=>c.icon))-Math.min(...coordinates.map(c=>c.icon))<=1,JSON.stringify(coordinates));
 assert(Math.max(...coordinates.map(c=>c.text))-Math.min(...coordinates.map(c=>c.text))<=1,JSON.stringify(coordinates));
 await p.screenshot({path:path.join(dir,'running-1280.png'),animations:'disabled'});
 await p.evaluate(()=>window.activityState('review'));
 await p.waitForFunction(()=>!document.querySelector('.nubi-activity-record')?.open);
 assert.equal(await p.locator('[data-timeline-kind="memo"]').count(),0);
 assert.equal(await p.locator('.nubi-thoughts').count(),1);
 assert.equal(await p.locator('.nubi-thoughts li').count(),2);
 assert.equal(await p.locator('.nubi-activity-sources').count(),1);
 await p.screenshot({path:path.join(dir,'completed-1280.png'),animations:'disabled'});
 await p.locator('.nubi-activity-record>summary').click();
 await p.locator('.nubi-activity-sources>summary').click();
 assert(await p.getByRole('button',{name:'src/example.mjs',exact:true}).isVisible());
 for(const width of [440,360]){
  await p.setViewportSize({width,height:900});
  await p.screenshot({path:path.join(dir,`expanded-${width}.png`),animations:'disabled'});
  const overflow=await p.locator('.nubi-agent-activity').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,children:[...el.querySelectorAll('*')].filter(c=>c.scrollWidth>c.clientWidth+1&&c.clientWidth).map(c=>({class:c.className,width:c.clientWidth,scroll:c.scrollWidth})).slice(0,12)}));
  assert(overflow.scroll<=overflow.width+1,JSON.stringify(overflow));
  await p.screenshot({path:path.join(dir,`expanded-${width}.png`),animations:'disabled'});
 }
 await p.goto('http://127.0.0.1:'+server.address().port+'/?integrated&progress&activity-readability&timeline&activity-memos&activity-paused');
 const sidebar=p.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await sidebar.count())await sidebar.click();
 await p.getByRole('button',{name:'대화 검색',exact:true}).click();await p.getByRole('dialog',{name:'대화 검색',exact:true}).locator('.nubi-history-item').first().click();
 await p.locator('[data-timeline-kind="memo"]').first().waitFor();
 assert(await p.locator('.nubi-activity-record').evaluate(el=>el.open));
 assert.equal(await p.locator('[data-timeline-kind="memo"]').count(),2);
 assert.equal(await p.locator('.nubi-activity-sources').count(),1);
 await p.addStyleTag({content:await readFile('ui/nubi-preparing.css','utf8')});
 await p.addStyleTag({content:await readFile('ui/project-switch-cover.css','utf8')});
 const motion=await p.evaluate(()=>{
  const host=document.createElement('div');host.innerHTML='<div class="nubi-progress is-indeterminate" style="width:200px"><span></span></div><div class="nubi-preparing-bar"><span></span></div><div class="nubi-git-clone-progress"><div class="nubi-progress is-indeterminate"><span></span></div></div>';document.body.append(host);
  const results=[...host.querySelectorAll('.nubi-progress>span,.nubi-preparing-bar>span')].map(el=>{
   const animation=el.getAnimations()[0];if(!animation)throw Error('missing animation '+el.className);
   animation.pause();const sample=t=>{animation.currentTime=t;const s=getComputedStyle(el);return {x:s.transform==='none'?null:new DOMMatrix(s.transform).m41,position:parseFloat(s.backgroundPositionX),direction:s.animationDirection};};
   return {early:sample(200),late:sample(1200)};
  });host.remove();return results;
 });
 for(const row of motion){assert.equal(row.early.direction,'normal');assert((row.early.x===null?row.late.position>row.early.position:row.late.x>row.early.x),JSON.stringify(row));}
 assert.deepEqual(errors,[]);
 await writeFile(path.join(dir,'result.json'),JSON.stringify({kinds,coordinates,motion,errors,checks:['interleaved memos','one folded completed record','stopped evidence preserved','aligned icons and labels','360/440/1280 widths']},null,2));
 console.log('PASS: chronological notes, consolidated completed record, source access on pause, aligned columns, responsive widths. Synthetic Workbench.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
