import {build,stop as stopBuildService} from 'esbuild';
import {assertDesktopDialog,desktopDialogScale} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const dir=path.resolve('verification/terminal-select-2026-10-15');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file','.webp':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));

let browser;const results=[];
try {
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const width of [1280,440]){
 await page.setViewportSize({width,height:900});
 await page.goto('http://127.0.0.1:'+server.address().port+'/?context&modals&integrated');
 await page.getByRole('button',{name:'설정',exact:true}).click();
 const field=page.locator('#nubi-default-shell');
 const options=await field.locator('option').evaluateAll(rows=>rows.map(row=>({value:row.value,label:row.label})));
 assert.equal(new Set(options.map(row=>row.value)).size,options.length,'shell profiles have unique ids');
 assert.equal(options.filter(row=>row.label==='Bash').length,1,'the fixture offers one Bash profile');
 const check=async state=>{const style=await field.evaluate(el=>{const s=getComputedStyle(el);return {image:s.backgroundImage,repeat:s.backgroundRepeat,size:s.backgroundSize,position:s.backgroundPosition};});assert.equal(style.repeat,'no-repeat');assert.match(style.size,/^16px(?: auto)?$/);assert.notEqual(style.image,'none');results.push({width,state,...style});};
 await check('closed');await field.click();await page.locator('.cx-select-menu').waitFor();await check('open');
 const fieldBox=await field.boundingBox(),menuBox=await page.locator('.cx-select-menu').boundingBox();assert(Math.abs(fieldBox.width-menuBox.width)<2);assert(menuBox.x>=0&&menuBox.x+menuBox.width<=width);
 await page.screenshot({path:path.join(dir,`terminal-after-${width}.png`)});
 await page.keyboard.press('Escape');await page.locator('.cx-select-menu').waitFor({state:'hidden'});await check('escape');
 await field.click();const listbox=page.getByRole('listbox',{name:'기본 터미널',exact:true});assert.equal(await listbox.getAttribute('id'),await field.getAttribute('aria-controls'));assert.equal(await listbox.getByRole('option',{name:'Bash',exact:true}).count(),1);await listbox.getByRole('option',{name:'Bash',exact:true}).click();await listbox.waitFor({state:'hidden'});assert.equal(await field.inputValue(),'bash');
 await field.evaluate(el=>el.disabled=true);await check('disabled');
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(dir,'result.json'),JSON.stringify({passed:true,results,errors},null,2));console.log('Terminal selector passed: normal/narrow, open/closed/disabled, Escape, selection and menu width');
} finally {await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));stopBuildService();}
