// Plan 2a task 5 evidence: what the CSS that only lazy screens import costs a full style recalc on screens that are open.
// Builds the freeze-scenes fixture twice, with that CSS and with it emptied, opens each scene, throttles the CPU 4x and
// takes the median of 9 forced full recalcs (an inherited custom property on body), 3 rounds per variant.
// Usage: node scripts/measure-lazy-css-cost.mjs <scratch dir>
import {build} from 'esbuild';import {chromium} from 'playwright';import {createServer} from 'node:http';
import {readFile,writeFile,mkdir,cp,rm} from 'node:fs/promises';import path from 'node:path';
import {rendererBundleOptions} from './renderer-bundle.mjs';

// CSS in renderer.css that no module of the startup (static) import graph imports.
async function lazyOnlyCss(){
 const result=await build({...rendererBundleOptions(),outdir:'verification/lazy-css-probe',write:false,minify:true,logLevel:'silent'}),inputs=result.metafile.inputs;
 const eager=new Set();const walk=file=>{if(eager.has(file))return;eager.add(file);for(const e of inputs[file]?.imports||[])if(e.kind!=='dynamic-import')walk(e.path);};walk('electron-app/renderer.jsx');
 const css=Object.keys(result.metafile.outputs).find(name=>name.endsWith('/renderer.css'));
 return Object.keys(result.metafile.outputs[css].inputs).filter(file=>file.endsWith('.css')&&!eager.has(file));
}
const base=path.resolve(process.argv[2]||'verification/lazy-css-cost');
const lazy=new Set((await lazyOnlyCss()).map(file=>path.resolve(file)));
const strip={name:'strip-lazy-css',setup(b){b.onLoad({filter:/\.css$/},a=>lazy.has(a.path)?{contents:'',loader:'css'}:undefined);}};
async function make(dir,plugins){
 await rm(dir,{recursive:true,force:true});await mkdir(dir,{recursive:true});await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
 const options=rendererBundleOptions();await build({...options,plugins:[...plugins,...options.plugins],entryPoints:['tests/freeze-scenes-fixture.jsx'],entryNames:'app',outdir:dir,minify:true,logLevel:'silent'});
 for(const name of ['workflow','wiki'])await build({entryPoints:[`ui/${name}-layout-worker.mjs`],outfile:path.join(dir,`chunks/${name}-layout-worker.js`),bundle:true,format:'esm',minify:true,logLevel:'silent'});
 await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
}
await make(base+'/full',[]);await make(base+'/stripped',[strip]);
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.webp':'image/webp'};
const server=createServer(async(req,res)=>{try{const file=path.resolve(base,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(base+path.sep))throw Error();res.setHeader('content-type',mime[path.extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu']}),rows=[];
try{
 for(const round of [1,2,3])for(const variant of ['full','stripped'])for(const scene of ['chat','wiki','mail']){
  const page=await browser.newPage({viewport:{width:1280,height:900}});await page.goto(`http://127.0.0.1:${server.address().port}/${variant}/`);await page.waitForFunction(()=>window.freezeReady===true,null,{timeout:60000});
  await page.evaluate(id=>window.freezeOpen(id),scene);await page.waitForTimeout(2500);
  const client=await page.context().newCDPSession(page);await client.send('Emulation.setCPUThrottlingRate',{rate:4});
  rows.push({round,variant,scene,...await page.evaluate(async()=>{const times=[];for(let i=0;i<9;i++){await new Promise(r=>requestAnimationFrame(()=>r()));const t=performance.now();document.body.style.setProperty('--probe',String(i));document.body.offsetHeight;getComputedStyle(document.body).color;times.push(performance.now()-t);}times.sort((a,b)=>a-b);return {median:times[4],elements:document.querySelectorAll('*').length,rules:[...document.styleSheets].reduce((n,s)=>n+s.cssRules.length,0)};})});
  await page.close();
 }
}finally{await browser.close();server.close();}
const summary={};for(const row of rows){const key=row.variant+' '+row.scene;(summary[key]??={elements:row.elements,rules:row.rules,runs:[]}).runs.push(Number(row.median.toFixed(1)));}
for(const value of Object.values(summary))value.median=[...value.runs].sort((a,b)=>a-b)[1];
console.log(JSON.stringify({lazyFiles:lazy.size,summary},null,1));
