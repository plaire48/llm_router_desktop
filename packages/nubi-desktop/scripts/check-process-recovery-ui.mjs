import {build} from 'esbuild';
import {chromium} from 'playwright';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/process-recovery-2026-10-16');await mkdir(dir,{recursive:true});
await build({stdin:{resolveDir:process.cwd(),loader:'jsx',contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {ProcessRecovery} from './ui/ProcessRecovery.jsx';import '@e2e/cx-design-system/styles.css';import './electron-app/workbench.css';import './design/workspace-identity.css';import './design/workspace-typography.css';import './design/workspace-density.css';const mode=new URLSearchParams(location.search).get('mode');window.continued=0;createRoot(document.getElementById('root')).render(<div className="desktop-shell"><main className="nubi-workbench" style={{padding:16}}><ProcessRecovery process={{state:'failed',recoveryState:mode==='offline'?'queued':mode}} connected={mode!=='offline'} onContinue={()=>window.continued++}/></main></div>);`},outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{react:path.resolve('node_modules/react'),'react-dom':path.resolve('node_modules/react-dom'),'@e2e/cx-design-system':path.resolve('node_modules/@e2e/cx-design-system'),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file','.webp':'file'},define:{'process.env.NODE_ENV':'"production"'}});
await writeFile(path.join(dir,'index.html'),'<html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(dir+path.sep))throw Error();res.setHeader('content-type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[path.extname(file)]||'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const errors=[],checks=[];let browser;
try{browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
for(const width of [1000,360])for(const mode of ['queued','diagnosing','review','waiting_input','attention','offline']){
 await page.setViewportSize({width,height:640});await page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}`);await page.locator('.nubi-workbench').waitFor();await page.evaluate(()=>document.fonts.ready);
 if(['queued','diagnosing'].includes(mode)){await page.getByRole('status').waitFor();assert.equal(await page.getByRole('button').count(),0);}
 else if(['review','waiting_input'].includes(mode))assert.equal(await page.locator('.nubi-recovery-card').count(),0);
 else{await page.getByRole('button',{name:mode==='offline'?'AI 연결':'이어서 해결',exact:true}).click();assert.equal(await page.evaluate(()=>window.continued),1);}
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:path.join(dir,`${mode}-${width}.png`),animations:'disabled'});checks.push({width,mode});
}
assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({checks,errors},null,2));console.log(`PASS: ${checks.length} recovery UI cases`);
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
