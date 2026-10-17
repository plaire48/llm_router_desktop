import {build} from 'esbuild';
import {assertDesktopDialog} from './identity-browser.mjs';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {DESKTOP_FEATURES} from '../runtime/beta-features.mjs';
import {WELCOME_GREETINGS} from '../ui/welcome-greetings.mjs';
const dir=path.resolve('verification/interaction-controls');await mkdir(dir,{recursive:true});
await build({entryPoints:['tests/shared-ui-fixture.jsx'],outfile:path.join(dir,'app.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),'@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
await writeFile(path.join(dir,'index.html'),'<!doctype html><html lang="ko"><title>Nubi synthetic flow check</title><link rel="stylesheet" href="app.css"><div id="root"></div><script type="module" src="app.js"></script></html>');
const server=createServer(async(req,res)=>{try{const requested=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'));if(!requested.startsWith(dir+path.sep))throw Error();const ext=path.extname(requested),data=await readFile(requested);res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.woff2':'font/woff2','.webp':'image/webp'})[ext]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));



let browser,p;const errors=[];
try{
 browser=await chromium.launch({channel:'chrome',headless:true});p=await browser.newPage({viewport:{width:1280,height:900}});p.setDefaultTimeout(10000);p.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
 const origin='http://127.0.0.1:'+server.address().port;
 for(const width of (process.env.PIN_ONLY?[]:[1280,440,360])){
  await p.setViewportSize({width,height:900});await p.goto(origin+'/?integrated&modals&catalog&toolbar&builtin-commands');
  const settings=p.getByRole('button',{name:'설정',exact:true}),anchor=await settings.boundingBox();await settings.click();
  const dialog=p.getByRole('dialog',{name:'설정',exact:true});await dialog.waitFor();
  const field=dialog.locator('#nubi-default-shell');await field.click();const menu=p.getByRole('listbox',{name:'기본 터미널',exact:true});await menu.waitFor();
  await p.waitForFunction(()=>{const field=document.querySelector('#nubi-default-shell'),menu=document.getElementById(field.getAttribute('aria-controls'));return menu&&Math.abs(field.getBoundingClientRect().width-menu.getBoundingClientRect().width)<1;});
  await p.screenshot({path:path.join(dir,`settings-${width}.png`),animations:'disabled'});await field.press('Escape');
  const settingsBox=await dialog.boundingBox(),sx=anchor.x+anchor.width/2,sy=anchor.y+anchor.height/2;if(sx>=settingsBox.x&&sx<=settingsBox.x+settingsBox.width&&sy>=settingsBox.y&&sy<=settingsBox.y+settingsBox.height)await p.keyboard.press('Escape');else await p.mouse.click(sx,sy);await dialog.waitFor({state:'hidden'});assert(await settings.evaluate(node=>document.activeElement===node));
  // Same opener toggles both full-window and anchored modal surfaces.
  for(const selector of ['.nubi-account-button','.context-trigger','.nubi-reasoning-trigger','.nubi-approval-mode-button']){
   const button=p.locator(selector);await button.click();await p.locator('[aria-modal="true"]').last().waitFor();const box=await button.boundingBox();
   const focused=await p.locator('[aria-modal="true"]').last().evaluate(node=>node.contains(document.activeElement));assert(focused,selector+' initially owns focus');
   const bounds=await p.locator('[aria-modal="true"]').last().boundingBox();assert(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width+1&&bounds.y+bounds.height<=900+1,selector+' remains in the viewport');
   if(width===440)await p.screenshot({path:path.join(dir,selector.slice(1)+'-440.png'),animations:'disabled'});
   const panelBox=await p.locator('[aria-modal="true"]').last().boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;if(x>=panelBox.x&&x<=panelBox.x+panelBox.width&&y>=panelBox.y&&y<=panelBox.y+panelBox.height)await p.keyboard.press('Escape');else await p.mouse.click(x,y);await p.waitForFunction(()=>![...document.querySelectorAll('[aria-modal="true"]')].some(el=>el.getClientRects().length));
  }
  const input=p.locator('textarea');await input.fill('/');assert.equal(await input.inputValue(),'/');const commands=p.getByRole('listbox',{name:'명령과 스킬',exact:true});await commands.waitFor();
  const mail=commands.getByRole('option').filter({hasText:'/mail'}),code=commands.getByRole('option').filter({hasText:'/code'});await code.waitFor();assert(await mail.isVisible());assert.equal(await commands.getByText('보고서 작성',{exact:true}).count(),0);
  const lines=await commands.locator('.nubi-command-copy').evaluateAll(rows=>rows.map(row=>{const name=row.querySelector('strong').getBoundingClientRect(),detail=row.querySelector('small').getBoundingClientRect();return {align:Math.abs((name.top+name.bottom)/2-(detail.top+detail.bottom)/2),fits:row.scrollWidth<=row.clientWidth};}));
  assert(lines.every(row=>row.align<2&&row.fits),JSON.stringify(lines));await p.screenshot({path:path.join(dir,`commands-${width}.png`),animations:'disabled'});
  await input.fill('/code');await input.press('Enter');assert.equal(await input.inputValue(),'','the selected command moves into a chip');
  const chip=p.getByRole('group',{name:'선택한 명령 또는 스킬',exact:true});await chip.getByRole('button',{name:'코드 검색',exact:true}).waitFor();assert.equal(await chip.locator('svg').count(),1,'the selection reuses the command icon without a close icon');
  for(let i=0;i<3;i++){await input.fill('/');await commands.waitFor();await input.fill('');await commands.waitFor({state:'hidden'});}
  await input.fill('/');await commands.waitFor();await input.press('Escape');await commands.waitFor({state:'hidden'});await input.fill('');await input.fill('/mail');await input.press('Enter');await chip.getByRole('button',{name:'메일 검색',exact:true}).waitFor();assert.equal(await chip.count(),1);assert.equal(await input.inputValue(),'');
  await input.fill('보존할 본문 /code');await input.press('Enter');await chip.getByRole('button',{name:'코드 검색',exact:true}).waitFor();assert.equal(await input.inputValue(),'보존할 본문 ');assert.equal(await chip.getByRole('button').count(),1);
  await p.screenshot({path:path.join(dir,`command-chip-${width}.png`),animations:'disabled'});
  await input.fill('/없는항목');await commands.getByText('일치하는 항목이 없어요.',{exact:true}).waitFor();assert(await commands.evaluate(el=>el.scrollHeight<=el.clientHeight+1),'empty results have no scrollbar');
  await input.fill('/');await commands.waitFor();await p.locator('.nubi-composer-skill-trigger').click();await p.getByRole('dialog',{name:'도구 목록',exact:true}).waitFor();await commands.waitFor({state:'hidden'});
  const model=p.locator('.model-trigger'),modelBox=await model.boundingBox();await p.mouse.click(modelBox.x+modelBox.width/2,modelBox.y+modelBox.height/2);await p.getByRole('dialog',{name:'모델 선택',exact:true}).waitFor();assert.equal(await p.getByRole('dialog',{name:'도구 목록',exact:true}).count(),0);assert.equal(await commands.count(),0);
  await p.keyboard.press('Escape');await p.getByRole('dialog',{name:'모델 선택',exact:true}).waitFor({state:'hidden'});await p.waitForFunction(()=>document.activeElement?.matches('.model-trigger'));await input.fill('');await input.fill('/');await commands.waitFor();await input.press('Escape');await chip.getByRole('button',{name:'코드 검색',exact:true}).dblclick();assert.equal(await chip.count(),0);assert.equal(await input.inputValue(),'/');
  // A slash action has no surviving option button. It must still participate
  // in the same picker lifecycle as opening the model dialog by its icon.
  await input.fill('/model');await input.press('Enter');await p.getByRole('dialog',{name:'모델 선택',exact:true}).waitFor();
  const next=p.locator('.context-trigger'),nextBox=await next.boundingBox(),modalBox=await p.getByRole('dialog',{name:'모델 선택',exact:true}).boundingBox(),nx=nextBox.x+nextBox.width/2,ny=nextBox.y+nextBox.height/2;
  // A covered opener is not a click target. Close first on narrow screens;
  // visible sibling controls can replace the current picker in one click.
  if(nx>=modalBox.x&&nx<=modalBox.x+modalBox.width&&ny>=modalBox.y&&ny<=modalBox.y+modalBox.height){await p.keyboard.press('Escape');await p.getByRole('dialog',{name:'모델 선택',exact:true}).waitFor({state:'hidden'});await p.waitForFunction(()=>document.activeElement?.matches('textarea'));await next.click();}
  else await p.mouse.click(nx,ny);
  await p.getByRole('dialog',{name:'컨텍스트 사용량',exact:true}).waitFor();assert.equal(await p.getByRole('dialog',{name:'모델 선택',exact:true}).count(),0);
  await p.keyboard.press('Escape');await p.getByRole('dialog',{name:'컨텍스트 사용량',exact:true}).waitFor({state:'hidden'});await p.waitForFunction(()=>document.activeElement?.matches('.context-trigger'));assert.equal(await commands.count(),0);
  console.log(`PASS ${width}px: dropdown field edges, opener toggles settings/account/context/reasoning/approval, one-line slash menu and keyboard selection.`);
 }
 await p.setViewportSize({width:1280,height:900});await p.goto(origin+'/?integrated&sessions&toolbar');
 const row=p.locator('.nubi-session-row').first();await row.hover();await row.locator('summary[aria-label="실행 중인 분석 관리"]').click();await p.getByRole('button',{name:'실행 중인 분석 고정',exact:true}).click();await p.keyboard.press('Escape');await p.waitForFunction(()=>document.querySelector('.nubi-session-row[data-pinned="true"]'));assert.equal(await row.getAttribute('data-pinned'),'true');await p.screenshot({path:path.join(dir,'pinned-conversation.png'),animations:'disabled'});
 assert.deepEqual(errors,[]);
} catch(error){if(p){console.error(await p.evaluate(()=>({active:document.activeElement?.className,modals:[...document.querySelectorAll('[aria-modal="true"]')].map(n=>({class:n.className,visible:!!n.getClientRects().length,inert:!!n.closest('[inert]'),motion:n.closest('[data-modal-motion]')?.dataset.modalMotion}))})));await p.screenshot({path:path.join(dir,'failure.png')});}throw error;} finally{await browser?.close();server.close();}
