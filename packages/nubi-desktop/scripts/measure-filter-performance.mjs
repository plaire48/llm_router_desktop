import {build} from 'esbuild';
import {chromium} from 'playwright';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
const label=process.argv[2]||'candidate',out=path.resolve('verification/filter-performance-2026-10-16');await mkdir(out,{recursive:true});
const source=`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{MailColumnFilter}from'./ui/MailColumnFilter.jsx';import{ColumnFilter,TableControlsContext}from'./ui/ai-workspace/TableControls.jsx';import '@e2e/cx-design-system/styles.css';import './electron-app/workbench.css';import './design/workspace-identity.css';import './design/workspace-dialogs.css';
const senders=Array.from({length:5000},(_,i)=>({label:'담당자 '+i,address:'user'+i+'@example.invalid'})),options=senders.map(s=>({key:s.address,label:s.label}));function App(){const[filters,setFilters]=useState({senders:[],roles:[],period:'all'});window.applied=filters;return <main className="desktop-shell" style={{display:'block',padding:32}}><MailColumnFilter field="sender" label="보낸 사람" facets={{senders}} filters={filters} onChange={v=>setFilters(f=>({...f,...v}))}/><TableControlsContext.Provider value={{columns:[{key:'person'}],filters:{},options:{person:options},setFilter:(key,values)=>window.appliedValues=values}}><ColumnFilter field="person" label="담당자"/></TableControlsContext.Provider></main>}createRoot(document.getElementById('root')).render(<App/>);`;
await build({stdin:{contents:source,loader:'jsx',resolveDir:process.cwd()},outfile:path.join(out,'app.js'),bundle:true,format:'esm',platform:'browser',alias:{react:path.resolve('node_modules/react'),'react-dom':path.resolve('node_modules/react-dom')},loader:{'.woff2':'file','.woff':'file','.webp':'file'},define:{'process.env.NODE_ENV':'"production"',__APP_VERSION__:'"fixture"'}});
await writeFile(path.join(out,'index.html'),'<html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(out,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(out+path.sep))throw Error();res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;const results=[],errors=[];
try{browser=await chromium.launch({channel:'chrome',headless:true});const p=await browser.newPage({viewport:{width:1100,height:800}});p.on('pageerror',e=>errors.push(e.message));const cdp=await p.context().newCDPSession(p);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
for(const kind of ['보낸 사람','담당자'])for(let run=0;run<3;run++){
 await p.goto('http://127.0.0.1:'+server.address().port);await p.getByRole('button',{name:kind+' 필터',exact:true}).waitFor();
 const ms=await p.evaluate(async name=>{const start=performance.now();document.querySelector('button[aria-label="'+name+' 필터"]').click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return performance.now()-start;},kind);
 const dialog=p.getByRole('dialog'),count=await dialog.getByRole('checkbox').count();results.push({kind,run,openMs:ms,checkboxes:count});
 if(label!=='baseline'){
  assert(count<=61,'first paint must not mount all 5000 options');
  await dialog.getByRole('button',{name:/더 보기/}).click();assert.equal(await dialog.getByRole('checkbox').count(),121);
  await dialog.getByRole('searchbox').fill('담당자 4999');await p.waitForFunction(()=>document.querySelectorAll('[role=dialog] input[type=checkbox]').length===2);
  if(kind==='보낸 사람')await dialog.getByRole('checkbox').first().check();else await dialog.getByRole('checkbox').last().uncheck();
  await dialog.getByRole('button',{name:/적용/}).click();
  if(kind==='보낸 사람')assert.deepEqual(await p.evaluate(()=>window.applied.senders),['user4999@example.invalid']);else assert.equal((await p.evaluate(()=>window.appliedValues)).length,4999);
  for(const width of [1100,360]){await p.setViewportSize({width,height:800});await p.getByRole('button',{name:kind+' 필터',exact:true}).click();const b=await dialog.boundingBox();assert(b.x>=0&&b.x+b.width<=width&&b.y>=0&&b.y+b.height<=800);await p.screenshot({path:path.join(out,kind+'-'+width+'.png')});await p.keyboard.press('Escape');}
  await p.setViewportSize({width:1100,height:800});
 }
}
assert.deepEqual(errors,[]);await writeFile(path.join(out,label+'.json'),JSON.stringify({rows:5000,cpuThrottle:4,results,boundary:'Local Chrome synthetic UI, no corporate network or Windows claim'},null,2));console.log(JSON.stringify(results));
}finally{await browser?.close();server.closeAllConnections();server.close();}
