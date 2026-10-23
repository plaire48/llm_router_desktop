import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {desktopTestWindow} from './electron-test-window.mjs';
import {captureDesign} from './design-rules.mjs';
import {startFixtureModel} from './fixture-model.mjs';

// Actual built Electron host, private empty project/state, no provider or account.
const require=createRequire(import.meta.url),temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-direct-shell-')),storage=path.join(temporary,'state'),root=path.join(temporary,'project'),out=path.resolve('verification/direct-browser-shell-2026-10-23');
await mkdir(storage);await mkdir(root);await mkdir(out,{recursive:true});await writeFile(path.join(root,'example.txt'),'Local browser connection verification\n');await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
const fixture=await startFixtureModel({respond(){throw Error('UI check must not invoke a model');}});
const app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}}),checks=[],errors=[];
let page;
try{
 page=await desktopTestWindow(app);page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.locator('.desktop-shell[data-startup-ready="true"]').waitFor({timeout:60000});
 await page.waitForFunction(()=>!document.querySelector('.nubi-intro')&&!document.querySelector('.desktop-shell')?.inert,null,{timeout:60000});
 if(await page.getByText('메일을 연결해 주세요').count())await page.keyboard.press('Escape');
 await page.waitForFunction(()=>document.querySelector('button[aria-label="파일"]')?.disabled===false,null,{timeout:60000});
 await page.evaluate(input=>window.nubi.request('provider',{action:'connect',input}),fixture.connection);
 if(await page.locator('.nubi-feedback-toast').count())await page.locator('.nubi-feedback-toast').getByRole('button',{name:'알림 닫기'}).click();
 await page.locator('.composer.nubi-compose-card').first().waitFor();
 const shape=await page.locator('.composer.nubi-compose-card').first().evaluate(node=>({outer:getComputedStyle(node).borderTopLeftRadius,inner:getComputedStyle(node.querySelector('.nubi-composer-surface')).borderTopLeftRadius}));
 assert(parseFloat(shape.outer)>=parseFloat(shape.inner)&&parseFloat(shape.outer)>=20,JSON.stringify(shape));
 await captureDesign(page,{path:path.join(out,'workspace-rounded.png')});checks.push({name:'built Electron composer preserves the common rounded surface',shape});
 await page.getByRole('button',{name:'파일',exact:true}).click();await page.getByRole('button',{name:'새 탭',exact:true}).click();await page.getByRole('menu',{name:'새 탭',exact:true}).getByRole('menuitem',{name:'웹',exact:true}).click();
 const openSetup=async()=>{
  await page.getByText('브라우저 설정',{exact:true}).click();await page.getByRole('button',{name:'내부 브라우저 사용',exact:true}).click();
  await page.getByRole('button',{name:'외부 브라우저 연결 설정',exact:true}).click();
  await page.getByRole('dialog',{name:'브라우저 연결',exact:true}).getByRole('switch',{name:'외부 브라우저 연동',exact:true}).click();
  await page.getByRole('dialog',{name:'브라우저 연결',exact:true}).getByText('확장 프로그램 없이 연결해요. 기존 로그인과 탭은 그대로 유지돼요.',{exact:true}).waitFor();
 };
 await openSetup();
 const dialog=page.getByRole('dialog',{name:'브라우저 연결',exact:true});await dialog.waitFor();
 assert.doesNotMatch(await dialog.innerText(),/연결 확장 폴더|개발자 모드|확장을.*설치/);
 assert.match(await dialog.innerText(),/확장 프로그램 없이 연결/);assert.equal(await dialog.getByRole('button',{name:'브라우저 연결',exact:true}).count(),1);
 await captureDesign(page,{path:path.join(out,'browser-connection.png')});checks.push({name:'actual connection dialog uses common UI and extension-free primary action'});
 await (await app.browserWindow(page)).evaluate(win=>win.setSize(760,850));await captureDesign(page,{path:path.join(out,'browser-connection-narrow.png')});
 const overflow=await dialog.evaluate(node=>node.scrollWidth>node.clientWidth+1);assert.equal(overflow,false);checks.push({name:'connection dialog fits narrow window'});
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});await openSetup();await dialog.waitFor();
 assert.match(await dialog.innerText(),/확장 프로그램 없이 연결/);checks.push({name:'connection dialog re-entry preserves the revised flow'});
 assert.deepEqual(errors,[]);assert.equal(fixture.calls.length,0);await writeFile(path.join(out,'report.json'),JSON.stringify({checks,errors,scope:'actual built Electron host with local provider fixture connected for UI only; no browser approval, Samsung Windows, SSO or model execution'},null,2));console.log(JSON.stringify({checks,errors}));
}catch(error){await page?.screenshot({path:path.join(out,'failure.png')});await writeFile(path.join(out,'failure.txt'),String(error.stack)+'\n'+await page?.locator('body').innerText());throw error;}
finally{await app.close();fixture.close();await rm(temporary,{recursive:true,force:true});}
