import {build} from 'esbuild';
import {assertDesktopDialog} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {AGENT_COMMANDS} from '../runtime/agent-commands.mjs';
const dir=path.resolve('verification/workflow-ui');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/workflow-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try {
 browser=await chromium.launch({channel:'chrome',headless:true});const p=await browser.newPage({reducedMotion:'reduce'});const errors=[];p.on('pageerror',e=>errors.push(e.message));const origin='http://127.0.0.1:'+server.address().port;
 for(const width of [1000,440,360]){
  await p.setViewportSize({width,height:900});await p.goto(origin+'/?proposal');
  await p.getByRole('button',{name:'반영',exact:true}).waitFor();
  await p.locator('.nubi-proposal-file').click();await p.locator('.nubi-proposal-preview pre').waitFor();
  assert((await p.locator('.nubi-proposal-preview').innerText()).includes('+ const count = 2'));
  for(const name of ['취소','반영','비교']){const button=p.getByRole('button',{name,exact:true});const box=await button.boundingBox();assert(box.x>=0&&box.x+box.width<=width,name+' is visible');await button.click();}
  assert.deepEqual((await p.evaluate(()=>window.calls)).filter(c=>['cancel','apply','compare'].includes(c.method)).map(c=>c.method),['cancel','apply','compare']);
  await p.screenshot({path:dir+'/proposal-'+width+'.png'});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  for(const state of ['stale','conflict','unsupported']){
   await p.goto(origin+'/?proposal&'+state);const expected=state==='stale'?'다시 맞추기':state==='conflict'?'다시 요청':'반영';await p.getByRole('button',{name:expected,exact:true}).waitFor();
   if(state!=='unsupported'){assert.equal(await p.getByRole('button',{name:'반영',exact:true}).count(),0);assert(await p.locator('.nubi-proposal-stale').isVisible());}
   else assert.match(await p.locator('.nubi-proposal-check').getAttribute('title'),/실행이나 화면 검증/);
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:dir+'/proposal-'+state+'-'+width+'.png'});
   await p.getByRole('button',{name:expected,exact:true}).click();assert((await p.evaluate(()=>window.calls)).some(call=>call.method===(state==='stale'?'rebase':state==='conflict'?'replan':'apply')));
   if(state==='stale')await p.getByRole('button',{name:'반영',exact:true}).waitFor();
  }
  if(process.argv.includes('--proposal-only'))continue;
  await p.goto(origin+'/?skills');await p.getByRole('group',{name:'개인 스킬 0 관리'}).waitFor({state:'hidden'});await p.locator('summary[aria-label="개인 스킬 0 관리"]').click();
  const group=p.getByRole('group',{name:'개인 스킬 0 관리'});await group.waitFor();const buttons=await group.locator('button').all();assert.equal(buttons.length,2);const a=await buttons[0].boundingBox(),b=await buttons[1].boundingBox();assert.equal(a.y,b.y);assert(b.x+b.width<=width);await p.screenshot({path:dir+'/skills-'+width+'.png'});await buttons[0].click();assert((await p.evaluate(()=>window.calls)).some(c=>c.method==='openPath'));
  await p.goto(origin+'/?commands');const input=p.getByRole('textbox',{name:'메시지'});await input.focus();await input.press('End');const list=p.getByRole('listbox',{name:'명령과 스킬'});await list.getByRole('option').last().waitFor();
  assert.equal(await list.getByRole('option').count(),AGENT_COMMANDS.length+16);
  const geometry=await list.evaluate(list=>{const r=list.getBoundingClientRect();const rows=[...list.children].map(c=>c.getBoundingClientRect());return {visible:rows.filter(c=>c.top>=r.top&&c.bottom<=r.bottom+1).length,scroll:list.scrollHeight>list.clientHeight};});assert(geometry.visible<=10);assert(geometry.scroll);
  for(let i=0;i<AGENT_COMMANDS.length+6;i++)await input.press('ArrowDown');await p.waitForFunction(()=>document.querySelector('.nubi-command-options').scrollTop>0,{},{timeout:2000});await input.press('Enter');assert.equal(await input.inputValue(),'/skill-6 ');await p.screenshot({path:dir+'/commands-'+width+'.png'});
 }
 assert.deepEqual(errors,[]);console.log(process.argv.includes('--proposal-only')?'Proposal apply/rebase/replan/cancel and unsupported status passed at 1000/440/360px.':'Workflow controls passed at 1000/440/360px.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
