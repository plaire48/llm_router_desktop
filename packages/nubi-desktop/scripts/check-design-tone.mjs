import {build} from 'esbuild';
import {mkdir, readFile, writeFile, cp} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const dir=path.resolve('verification/design-tone'); await mkdir(dir,{recursive:true});
await build({entryPoints:{workspace:'tests/workspace-design-fixture.jsx',skills:'tests/design-tone-fixture.jsx'},outdir:dir,bundle:true,format:'esm',platform:'browser',
  nodePaths:[path.resolve('node_modules')],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,path.resolve('node_modules',name)])),
  '@e2e/cx-design-system/styles.css':path.resolve('node_modules/@e2e/cx-design-system/dist/styles.css')},loader:{'.woff2':'file','.woff':'file'},define:{__APP_VERSION__:'"fixture"','process.env.NODE_ENV':'"production"'}});
await cp('../../extensions/aipro-chat/public/icons',path.join(dir,'icons'),{recursive:true});
for(const name of ['workspace','skills']) await writeFile(path.join(dir,name+'.html'),`<!doctype html><html lang="ko"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>누비 디자인 점검</title><link rel="stylesheet" href="${name}.css"><div id="root"></div><script type="module" src="${name}.js"></script></html>`);
const server=createServer(async(req,res)=>{try{const file=path.resolve(dir,'.'+new URL(req.url,'http://localhost').pathname); if(!file.startsWith(dir+path.sep))throw Error();
  const data=await readFile(file); res.writeHead(200,{'content-type':({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.woff2':'font/woff2','.webp':'image/webp','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream'}).end(data);}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port, checks=[], errors=[];
const browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true}), page=await browser.newPage({viewport:{width:1280,height:800}});
page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto(origin+'/workspace.html?solution=1&integrated=1'); await page.getByRole('button',{name:'AI Pro',exact:true}).click();
  const draft=page.getByRole('textbox',{name:'작업 요청'}); await draft.fill('기존 조건을 유지하고 변경 결과를 확인해 주세요.');
  const settings=page.getByRole('button',{name:'설정',exact:true}); await settings.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  await page.getByRole('tooltip',{name:'누비 설정',exact:true}).waitFor();
  assert.match(await settings.getAttribute('aria-describedby'),/\S/);
  checks.push('icon actions expose an accessible keyboard tooltip');
  await settings.press('Enter'); await page.getByRole('dialog',{name:'설정',exact:true}).waitFor(); await page.keyboard.press('Escape');
  assert.equal(await settings.evaluate(e=>e===document.activeElement),true); assert.equal(await draft.inputValue(),'기존 조건을 유지하고 변경 결과를 확인해 주세요.');
  checks.push('settings Escape restores the action and retains the request draft');
  await page.getByRole('button',{name:'전송',exact:true}).click(); await page.getByRole('article',{name:'누비 답변'}).waitFor();
  const sizes=await page.locator('.message-assistant .message-body').evaluate(e=>{const s=getComputedStyle(e);return {font:parseFloat(s.fontSize),line:parseFloat(s.lineHeight)};});
  assert(sizes.font>=15&&sizes.line/sizes.font>=1.7); checks.push('conversation text retains a readable body size and line height');
  assert.equal(await page.locator('.nubi-task-actions:empty').first().isVisible(),false);
  const plan=page.getByRole('region',{name:'작업 계획',exact:true});
  assert.equal(await plan.locator('.task-plan-current').isVisible(),true); assert.equal(await plan.locator('.task-plan-pause').isVisible(),false);
  checks.push('empty action rows and duplicate collapsed plan status do not consume reading space');
  await page.screenshot({path:path.join(dir,'conversation-1280.png'),animations:'disabled'});
  await page.getByRole('button',{name:'큰 글자',exact:true}).click();
  assert.equal(await page.locator('.message-assistant .message-body').evaluate(e=>getComputedStyle(e).fontSize),'17px'); checks.push('large text scales the conversation');
  await page.emulateMedia({reducedMotion:'reduce'}); assert.equal(await page.locator('.nubi-task').evaluate(e=>getComputedStyle(e).animationName),'none'); checks.push('system reduced motion disables the entry animation');
  await page.evaluate(()=>{document.body.classList.add('vscode-dark');document.body.style.setProperty('--vscode-editor-background','#181818');document.body.style.setProperty('--vscode-sideBar-background','#181818');});
  assert.equal(await page.locator('.nubi-workbench-content').evaluate(e=>{const c=getComputedStyle(e).backgroundColor;return c.includes('0.094')||c==='rgb(24, 24, 24)';}),true); checks.push('working surface follows the native dark theme');
  await page.goto(origin+'/skills.html'); await page.getByRole('button',{name:'스킬 찾기',exact:true}).click();
  const skillSettings=page.getByRole('button',{name:'스킬 설정',exact:true});
  const glyph=e=>e.querySelector('svg').innerHTML;
  const actualGlyph=await skillSettings.evaluate(glyph);
  // The native settings entry uses the same CX sliders glyph, verified across rendered components.
  const second=await browser.newPage(); await second.goto(origin+'/workspace.html?solution=1&integrated=1'); await second.getByRole('button',{name:'AI Pro',exact:true}).waitFor();
  assert.equal(actualGlyph,await second.getByRole('button',{name:'설정',exact:true}).evaluate(glyph)); await second.close(); checks.push('Workspace and skill settings render the identical common icon');
  for(const width of [1280,440,320]) {
    await page.setViewportSize({width,height:800}); const row=page.getByRole('article',{name:'변경 요청 검토',exact:true});
    const detail=await row.locator('.nubi-skill-row-copy p').evaluate(e=>({text:e.textContent,white:getComputedStyle(e).whiteSpace,overflow:e.scrollWidth>e.clientWidth,height:e.scrollHeight>e.clientHeight}));
    assert.equal(detail.text,await page.evaluate(()=>window.toneDescription)); assert.equal(detail.white,'normal'); assert.equal(detail.overflow,false); assert.equal(detail.height,false);
    assert.equal(await page.locator('.nubi-workbench').evaluate(e=>e.scrollWidth>e.clientWidth),false);
    await page.screenshot({path:path.join(dir,'skills-'+width+'.png'),animations:'disabled'});
    checks.push(`long skill purpose stays fully readable without overflow at ${width}px`);
  }
  assert.deepEqual(errors,[]); await writeFile(path.join(dir,'result.json'),JSON.stringify({passed:checks.length,checks,scope:'Rendered embedded fork components with synthetic data; no Windows or real-model claim.'},null,2)); console.log(JSON.stringify({passed:checks.length,checks}));
} catch(error) {await page.screenshot({path:path.join(dir,'failure.png')}); throw error;}
finally {await browser.close(); await new Promise(resolve=>server.close(resolve));}
