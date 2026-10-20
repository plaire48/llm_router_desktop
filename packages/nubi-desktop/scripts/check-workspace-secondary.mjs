import {captureDesign} from './design-rules.mjs';
import {build} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {rendererBundleOptions} from './renderer-bundle.mjs';
import {auditSurfaceTokens} from './surface-token-audit.mjs';
import {assertDialogChrome} from './identity-browser.mjs';

const dir=path.resolve('verification/design-token-audit-2026-10-17/secondary');
await mkdir(dir,{recursive:true});
await build({...rendererBundleOptions(),entryPoints:['tests/workspace-secondary-fixture.jsx'],entryNames:'app',outdir:dir,minify:false});
await writeFile(dir+'/index.html','<!doctype html><html lang="ko"><meta charset="utf-8"><link rel="stylesheet" href="app.css"><div class="desktop-shell" data-platform="darwin"><div id="root"></div></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!file.startsWith(dir+path.sep))throw Error();res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream'}).end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser,page;const errors=[],checks=[];
try{
 browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));await page.route('https://**/*',route=>route.abort());
 for(const width of [1280,440])for(const screen of ['help','profile','team','notice']){
  await page.setViewportSize({width,height:900});await page.goto(`http://127.0.0.1:${server.address().port}/?screen=${screen}`);await page.evaluate(size=>{document.documentElement.style.fontSize=size;},width===440?'20px':'16px');
  const dialog=page.getByRole('dialog');await dialog.waitFor();
  if(screen==='profile')await dialog.getByRole('heading',{name:'기본 정보',exact:true}).waitFor();
  if(screen==='team')await dialog.getByRole('group',{name:'팀 소속',exact:true}).waitFor();
  if(screen==='notice')await dialog.getByText('8명',{exact:true}).waitFor();
  if(screen==='help'){await dialog.getByRole('button',{name:'스킬 설치',exact:true}).first().click();await dialog.getByRole('searchbox',{name:'도움말 검색',exact:true}).fill('설치');await dialog.getByRole('region',{name:'도움말 검색 결과'}).waitFor();}
  const audit=await auditSurfaceTokens(page,`secondary-${screen}-${width}`);
  if(await dialog.evaluate(el=>el.classList.contains('deck-dialog')))await assertDialogChrome(dialog);
  const bounds=await dialog.boundingBox();assert(bounds.x>=-1&&bounds.y>=-1&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=901,screen+': panel stays inside window');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,screen+': no page overflow');
  await captureDesign(dialog,{path:`${dir}/${screen}-${width}.png`});checks.push({screen,width,textNodes:audit.textNodes});
 }
 assert.deepEqual(errors,[]);await writeFile(dir+'/result.json',JSON.stringify({checks,errors,boundary:'Production panels with synthetic read-only profile/team data. No GHES changes or notifications.'},null,2));console.log(JSON.stringify({checks,errors}));
}catch(error){await page?.screenshot({path:dir+'/failure.png'});console.error(await page?.locator('body').innerText());throw error;}finally{await browser?.close();await new Promise(r=>server.close(r));}
