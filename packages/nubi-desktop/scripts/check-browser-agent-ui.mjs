import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {ProjectService} from '../runtime/project-service.mjs';
import {desktopTestWindow} from './electron-test-window.mjs';
import {startFixtureModel} from './fixture-model.mjs';
const require=createRequire(import.meta.url),temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-browser-agent-ui-')),root=path.join(temporary,'project'),storage=path.join(temporary,'state'),evidence=path.resolve('verification/development-browser-2026-10-16/central-ui');
await mkdir(root);await mkdir(storage);await mkdir(path.join(root,'openwiki'));await mkdir(evidence,{recursive:true});await writeFile(path.join(root,'openwiki/home.md'),'# Browser Agent UI\n');
const service=new ProjectService({storageRoot:storage});await service.open(root,{initializeWiki:false});service.dispose();service.store.close();await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
const site=createServer((q,r)=>{r.setHeader('content-type','text/html;charset=utf-8');r.end('<title>브라우저 에이전트 확인</title><h1>브라우저 작업 화면</h1><label>이름<input></label>');});await new Promise(resolve=>site.listen(0,'127.0.0.1',resolve));
const fixture=await startFixtureModel({respond({text}){throw Error('UI-only check must not invoke a model');}});
let app;const errors=[],checks=[];
try{
/* The product opens web pages in the external browser by default (2026-10-17); this check exercises the in-app browser surface, so it selects internal mode in its isolated storage. */
await mkdir(storage,{recursive:true});await writeFile(path.join(storage,'browser-preference.json'),JSON.stringify({mode:'internal',executable:null}));
 app=await electron.launch({executablePath:require('electron'),args:['electron-app'],timeout:30000,env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}});
 const page=await desktopTestWindow(app);page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
 await page.locator('.desktop-shell[data-startup-ready="true"]').waitFor({timeout:60000});await page.waitForFunction(()=>!document.querySelector('.nubi-intro')&&!document.querySelector('.desktop-shell')?.inert,null,{timeout:60000});
 if(await page.getByText('메일을 연결해 주세요',{exact:true}).count())await page.keyboard.press('Escape');
 await page.waitForFunction(()=>document.querySelector('button[aria-label="파일"]')?.disabled===false,null,{timeout:60000});
 await page.evaluate(input=>window.nubi.request('provider',{action:'connect',input}),fixture.connection);
 const loginToast=page.locator('.nubi-feedback-toast');if(await loginToast.count())await loginToast.getByRole('button',{name:'알림 닫기'}).click();
 const composer=page.getByRole('textbox',{name:'작업 요청',exact:true});await composer.fill('현재 브라우저 화면을 확인해 주세요.');
 await page.getByRole('button',{name:'파일',exact:true}).click();await page.getByRole('button',{name:'새 탭',exact:true}).click();await page.getByRole('menuitem',{name:'웹',exact:true}).click();
 const browser=page.getByRole('region',{name:'인터넷 브라우저',exact:true});await browser.waitFor();checks.push('the existing browser stays a page surface beside the central agent');
 await browser.getByRole('textbox',{name:'인터넷 주소 또는 검색어'}).fill('http://127.0.0.1:'+site.address().port);await browser.getByRole('textbox',{name:'인터넷 주소 또는 검색어'}).press('Enter');
 await page.waitForFunction(async()=>{const state=await window.nubi.request('browser',{action:'status'});return state.tabs.find(tab=>tab.id===state.active)?.contentReady;});
 assert.equal(await browser.getByRole('textbox',{name:'브라우저 에이전트 작업 요청'}).count(),0);assert.equal(await browser.locator('textarea').count(),0);
 assert.equal(await page.locator('.nubi-workbench').count(),1);assert.equal(await composer.inputValue(),'현재 브라우저 화면을 확인해 주세요.');checks.push('one central agent composer remains, with its draft preserved and no browser agent input');
 for(const width of [1280,680]){
  await (await app.browserWindow(page)).evaluate((win,width)=>win.setSize(width,900),width);
  await page.waitForTimeout(150);assert.equal(await browser.evaluate(node=>node.scrollWidth>node.clientWidth+1),false);
  await page.screenshot({path:path.join(evidence,`central-agent-browser-${width}.png`),animations:'disabled'});
 }
 checks.push('wide and narrow page surfaces fit');assert.deepEqual(errors,[]);
 assert.equal(fixture.calls.length,0);
 await writeFile(path.join(evidence,'result.json'),JSON.stringify({kind:'built-electron-central-agent-browser-ui',checks,errors,model:'local_fixture_not_invoked',modelCalls:fixture.calls.length,platform:process.platform},null,2));console.log('PASS: '+checks.length+' built Electron central agent/browser UI checks');
}finally{await app?.close();await fixture.close();site.closeAllConnections();await new Promise(resolve=>site.close(resolve));await rm(temporary,{recursive:true,force:true});}
