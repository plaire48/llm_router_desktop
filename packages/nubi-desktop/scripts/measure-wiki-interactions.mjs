// Reproducible renderer workload. Synthetic documents, real WikiBrowser/UI/worker.
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
const label=process.argv[2]||'candidate',out=path.resolve('verification/wiki-interaction-performance');
await mkdir(out,{recursive:true});
const source=String.raw`import React from 'react';import {createRoot} from 'react-dom/client';import {WikiBrowser} from './ui/WikiBrowser.jsx';import '@e2e/cx-design-system/styles.css';import './electron-app/workbench.css';import './design/workspace-identity.css';import './electron-app/shell.css';import './electron-app/ios-tokens.css';import './design/workspace-typography.css';import './design/workspace-dialogs.css';
const items=Array.from({length:3000},(_,i)=>({path:'section-'+Math.floor(i/30)+'/page-'+i+'.md',title:'운영 문서 '+i,type:'Module',updatedAt:'2026-10-16T00:00:00Z',hash:'fixture',description:'검증용 코드 위키 문서',tags:[]}));
const edges=items.flatMap((node,i)=>i%30?[{from:items[i-1].path,to:node.path}]:[]);
const api=async(method,args)=>{if(method!=='wikiLibrary')return {};if(args.action==='roots')return {items:[{id:'project',name:'성능 검증 프로젝트',kind:'project'}]};if(args.action==='list')return {items,edges};if(args.action==='read')return {...items.find(item=>item.path===args.path),content:'# 운영 문서\n\n'+Array.from({length:100},(_,i)=>'## 절차 '+i+'\n\n검증용 본문입니다. 실제 업무 자료는 사용하지 않습니다.').join('\n\n')};};
createRoot(document.getElementById('root')).render(<main className="desktop-shell" style={{display:'block',height:'100vh'}}><WikiBrowser api={api} projectId="project"/></main>);`;
const baseline=process.env.NUBI_PERF_BASELINE_DIR;
const plugins=baseline?[{name:'baseline-ui',setup(b){b.onLoad({filter:/[\\/]ui[\\/](WikiMap|WikiBrowser)\.jsx$/},async args=>({contents:await readFile(path.join(baseline,path.basename(args.path)),'utf8'),loader:'jsx',resolveDir:path.dirname(args.path)}));}}]:[];
await build({plugins,stdin:{contents:source,loader:'jsx',resolveDir:process.cwd()},outfile:path.join(out,'app.js'),bundle:true,format:'esm',platform:'browser',alias:{react:path.resolve('node_modules/react'),'react-dom':path.resolve('node_modules/react-dom')},loader:{'.woff2':'file','.woff':'file','.webp':'file'},define:{'process.env.NODE_ENV':'"production"',__APP_VERSION__:'"fixture"'}});
await build({entryPoints:['ui/wiki-layout-worker.mjs'],outfile:path.join(out,'chunks/wiki-layout-worker.js'),bundle:true,format:'esm',platform:'browser'});
await writeFile(path.join(out,'index.html'),'<html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(out,'.'+new URL(req.url,'http://local').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(out+path.sep))throw Error();res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;const results=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1280,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await cdp.send('Performance.enable');
 await page.addInitScript(()=>{window.layoutDone=0;const Native=Worker;window.Worker=class extends Native{constructor(...args){super(...args);this.addEventListener('message',({data})=>{if(data.done)window.layoutDone++;});}};window.longTasks=[];new PerformanceObserver(list=>window.longTasks.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask'});});
 const duration=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
 for(let run=0;run<3;run++){
  await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('.nubi-wiki-document-heading h2').waitFor();
  await page.waitForTimeout(200);await page.evaluate(()=>window.longTasks=[]);const start=await duration();
  await page.evaluate(async()=>{const input=document.querySelector('input[aria-label="위키 문서 검색"]'),setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(let i=0;i<40;i++){setter.call(input,i%2?'운영':'운');input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}setter.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));});
  const end=await duration(),search={taskMs:(end.TaskDuration-start.TaskDuration)*1000,scriptMs:(end.ScriptDuration-start.ScriptDuration)*1000,longTasks:await page.evaluate(()=>window.longTasks)};
  await page.getByRole('tab',{name:'관계 지도',exact:true}).click();await page.waitForFunction(()=>window.layoutDone>0);await page.waitForTimeout(300);
  await page.evaluate(()=>window.longTasks=[]);const panStart=await duration();
  const box=await page.locator('.nubi-wiki-map-frame > svg').boundingBox();
  await page.mouse.move(box.x+250,box.y+150);await page.mouse.down({button:'right'});
  for(let i=0;i<80;i++){await page.mouse.move(box.x+250+Math.sin(i/10)*180,box.y+150);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));}
  await page.mouse.up({button:'right'});
  const panEnd=await duration(),pan={taskMs:(panEnd.TaskDuration-panStart.TaskDuration)*1000,scriptMs:(panEnd.ScriptDuration-panStart.ScriptDuration)*1000,longTasks:await page.evaluate(()=>window.longTasks)};
  results.push({run,search,pan});console.log(JSON.stringify(results.at(-1)));
 }
 assert.deepEqual(errors,[]);await page.screenshot({path:path.join(out,label+'.png')});
 await writeFile(path.join(out,label+'.json'),JSON.stringify({label,documents:3000,cpuThrottle:4,results,boundary:'Mac Chrome, synthetic documents, real React UI. CPU slowdown is a stress test, not a Windows measurement.'},null,2));
}finally{await browser?.close();server.closeAllConnections();server.close();}
