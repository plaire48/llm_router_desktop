import {build} from 'esbuild';
import {chromium} from 'playwright';
import {mkdir,mkdtemp,writeFile,readFile,cp,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';

const root=process.cwd(),directory=await mkdtemp(path.join(os.tmpdir(),'nubi-wiki-loading-ui-'));
const output=path.join(root,'verification/wiki-settings-loading-2026-10-15');await mkdir(output,{recursive:true});
const styles=['electron-app/workbench.css','design/workspace-identity.css','electron-app/shell.css','electron-app/ios-tokens.css','design/workspace-typography.css','design/workspace-density.css','design/workspace-dialogs.css'];
await writeFile(path.join(directory,'fixture.jsx'),`
import React from 'react';import{createRoot}from'react-dom/client';import{DetailPanel}from'@e2e/cx-design-system';import{DeckDisclosure}from'${root}/../../extensions/aipro-chat/src/DeckSurfaces.jsx';import{WikiUpdate}from'${root}/ui/WikiUpdate.jsx';
import '@e2e/cx-design-system/styles.css';${styles.map(file=>`import '${root}/${file}';`).join('')}
window.calls=0;window.release=null;
const api=async()=>{window.calls++;return await new Promise((resolve,reject)=>{window.release=fail=>fail?reject(Error('fixture_error')):resolve({status:{state:'current',lastUpdate:{updatedAt:'2026-10-15'}},updates:[]});});};
createRoot(document.getElementById('root')).render(<main className="desktop-shell"><DetailPanel className="deck-dialog nubi-panel nubi-panel--wide" title="위키 설정" variant="modal" onClose={()=>{}}><div className="nubi-library"><DeckDisclosure title="위키 준비 완료" icon="bookmark">완료</DeckDisclosure><WikiUpdate api={api}/><DeckDisclosure title="위키 18개" icon="bookmark">문서 목록</DeckDisclosure></div></DetailPanel></main>);
`);
await build({entryPoints:[path.join(directory,'fixture.jsx')],outfile:path.join(directory,'fixture.js'),bundle:true,format:'esm',platform:'browser',nodePaths:[root+'/node_modules'],alias:{...Object.fromEntries(['react','react-dom','@e2e/cx-design-system'].map(name=>[name,root+'/node_modules/'+name])),'@e2e/cx-design-system/styles.css':root+'/node_modules/@e2e/cx-design-system/dist/styles.css'},loader:{'.woff2':'file','.woff':'file'},define:{'process.env.NODE_ENV':'"production"'}});
await cp(path.resolve(root,'../../extensions/aipro-chat/public/icons'),path.join(directory,'icons'),{recursive:true});
await writeFile(path.join(directory,'index.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script type="module" src="fixture.js"></script></html>');
const server=createServer(async(req,res)=>{try{const file=path.resolve(directory,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(directory+path.sep))throw Error();res.setHeader('content-type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser,page;const errors=[],checks=[];
try{
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true});
  page=await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
  for(const width of [1280,440]){
    await page.setViewportSize({width,height:850});await page.goto('http://127.0.0.1:'+server.address().port+'/index.html');
    const bar=page.getByRole('progressbar',{name:'위키 상태 불러오는 중'});await bar.waitFor();
    assert.equal(await bar.getAttribute('aria-valuenow'),null,'unknown completion must not invent a percent');
    await page.getByRole('status').filter({hasText:'1초'}).waitFor();
    const surface=page.locator('.nubi-progress-atmosphere');
    assert.equal(await surface.evaluate(el=>getComputedStyle(el,'::before').animationName),'nubi-progress-breathe');
    const before=await surface.boundingBox();
    await page.waitForTimeout(200);
    assert.deepEqual(await surface.boundingBox(),before,'ambient light must not move content');
    await page.evaluate(()=>document.documentElement.dataset.motionVisibility='hidden');
    assert.equal(await surface.evaluate(el=>getComputedStyle(el,'::before').animationPlayState),'paused');
    await page.evaluate(()=>delete document.documentElement.dataset.motionVisibility);
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await surface.evaluate(el=>getComputedStyle(el,'::before').animationName),'none');
    await page.emulateMedia({reducedMotion:'no-preference'});

    const dialog=page.getByRole('dialog');assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    await page.screenshot({path:path.join(output,'loading-'+width+'.png')});
    await page.evaluate(()=>window.release(true));await page.getByText('위키 상태를 확인하지 못했어요.',{exact:true}).waitFor();
    assert.equal(await page.locator('.nubi-progress-atmosphere').count(),0,'failure stops decorative activity');
    await page.getByRole('button',{name:'다시 확인',exact:true}).click();await bar.waitFor();
    await page.evaluate(()=>window.release(false));await page.getByRole('region',{name:'위키 갱신',exact:true}).waitFor();
    assert.equal(await bar.count(),0);assert.equal(await page.evaluate(()=>window.calls),2);
    assert.equal(await page.locator('.nubi-library').evaluate(el=>getComputedStyle(el).minHeight),'0px');
    await page.screenshot({path:path.join(output,'loaded-'+width+'.png')});
    checks.push({width,progress:true,elapsed:true,errorRetry:true,noClipping:true});
  }
  assert.deepEqual(errors,[]);await writeFile(path.join(output,'checks.json'),JSON.stringify({scope:'Actual React/CX components and fixture API, not live Windows/AI Pro.',checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
}catch(error){await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
