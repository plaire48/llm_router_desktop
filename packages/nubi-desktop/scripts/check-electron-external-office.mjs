import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {startFixtureModel} from './fixture-model.mjs';
const require=createRequire(import.meta.url),temp=await mkdtemp(path.join(os.tmpdir(),'nubi-office-connect-')),root=path.join(temp,'project'),storage=path.join(temp,'state'),out=path.resolve('../../artifacts/external-office-2026-10-17/electron');
await mkdir(root);await mkdir(storage);await mkdir(out,{recursive:true});await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
const model=await startFixtureModel({respond:({text})=>text('연결 화면 검증용 응답입니다.')});let app;
try{
 app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}});
 const page=await app.firstWindow();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.locator('.desktop-shell[data-startup-ready="true"]').waitFor();
 if(await page.getByText('메일을 연결해 주세요').count())await page.keyboard.press('Escape');
 await page.evaluate(connection=>window.nubi.request('provider',{action:'connect',input:connection}),model.connection);
 await page.getByRole('textbox',{name:'작업 요청',exact:true}).waitFor();
 const raw=await page.evaluate(()=>window.nubi.request('_externalOffice',{action:'preview',app:'word'}));assert.equal(raw.__nubiError,'method_invalid');
 for(let i=0;i<2;i++){
  await page.getByRole('button',{name:'스킬 관리',exact:true}).click();await page.getByRole('button',{name:'열린 Office 연결',exact:true}).click();
  await page.getByRole('heading',{name:'Office 문서 연결',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),1);
  if(process.platform!=='win32'){await page.getByRole('button',{name:'Excel',exact:true}).click();await page.getByRole('alert').filter({hasText:'Windows에서 열어 둔 Office 문서'}).waitFor();}
  await page.screenshot({path:path.join(out,`office-dialog-${i}.png`)});await page.keyboard.press('Escape');await page.getByRole('heading',{name:'Office 문서 연결',exact:true}).waitFor({state:'hidden'});
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'result.json'),JSON.stringify({ok:true,checks:['Electron plus menu opens one Office dialog','private registration route rejected','Escape closes and reopens','non-Windows availability is explicit'],platform:process.platform,errors,windowsOfficeVerified:false,nascaVerified:false},null,2));console.log(JSON.stringify({ok:true,platform:process.platform,errors,windowsOfficeVerified:false}));
}catch(error){const page=app&&(await app.windows())[0];if(page){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await writeFile(path.join(out,'failure.txt'),await page.locator('body').innerText());}throw error;}finally{await app?.close();model.close();await rm(temp,{recursive:true,force:true});}
