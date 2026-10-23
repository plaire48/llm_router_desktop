import {build} from 'esbuild';
import {assertDesktopDialog} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
import {WELCOME_GREETINGS} from '../ui/welcome-greetings.mjs';
const dir=path.resolve('verification/workspace-page-width');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file','.svg':'dataurl','.webp':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

// The AI Workspace page: title and content span the page edge to edge and line up on wide windows (user report
// 2026-10-23: the title sat centred in a 1200px column while the content hugged the left edge).
let browser;const errors=[];
try{
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});const p=await browser.newPage();p.on('pageerror',e=>errors.push(e.message));
 for(const width of [1700,1000]){
  await p.setViewportSize({width,height:900});await p.goto('http://127.0.0.1:'+server.address().port+'/?context&modals&integrated');
  await p.getByRole('button',{name:'AI Workspace',exact:true}).click();await p.getByRole('heading',{name:'AI Workspace',exact:true}).waitFor();
  const spans=await p.locator('.nubi-skill-page').evaluate(page=>{const outer=page.getBoundingClientRect();return [...page.querySelectorAll(':scope>:is(.nubi-skill-page-header,.nubi-skill-page-body)')].map(part=>{const box=part.getBoundingClientRect();return {left:Math.round(box.left-outer.left),right:Math.round(outer.right-box.right)};});});
  assert(spans.length===2&&spans.every(span=>span.left===0&&Math.abs(span.right)<=1),width+' '+JSON.stringify(spans));
  await p.screenshot({path:path.join(dir,`workspace-${width}.png`)});
 }
 assert.deepEqual(errors,[]);console.log('PASS: AI Workspace title and content span the page at 1700/1000px.');
}finally{await browser?.close();server.close();}
