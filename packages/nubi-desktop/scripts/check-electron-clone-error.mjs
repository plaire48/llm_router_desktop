import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm,access} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {ProjectService} from '../runtime/project-service.mjs';
import {desktopTestWindow} from './electron-test-window.mjs';

const require=createRequire(import.meta.url);
const temp=await mkdtemp(path.join(os.tmpdir(),'nubi-clone-error-'));
const repo=path.join(temp,'source'),dest=path.join(temp,'downloads'),state=path.join(temp,'state');
await mkdir(repo);await mkdir(dest);await writeFile(path.join(repo,'README.md'),'Local fixture');
const service=new ProjectService({storageRoot:state});
await service.open(repo,{initializeWiki:false});service.dispose();service.store.close();
await writeFile(path.join(state,'last-project.json'),JSON.stringify({root:repo}));
let requests=0,app;
const server=createServer((_request,response)=>{requests++;response.writeHead(502);response.end('Bad gateway');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const remote=`http://127.0.0.1:${server.address().port}/unavailable.git`;
try{
  app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:state,ELECTRON_RUN_AS_NODE:undefined}});
  const page=await desktopTestWindow(app),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(30000);
  await page.locator('.desktop-shell[data-startup-ready="true"]').waitFor();
  await page.locator('.nubi-sidebar-project').first().waitFor({timeout:60000});
  await app.evaluate(({dialog},dest)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[dest]});},dest);
  if(!await page.getByRole('button',{name:/Git URL/}).isVisible())await page.getByRole('button',{name:'프로젝트 추가',exact:true}).click();
  await page.getByRole('button',{name:/Git URL/}).click();
  await page.getByLabel('저장소 주소',{exact:true}).fill(remote);
  for(let attempt=0;attempt<2;attempt++){
    const previous=requests;
    await page.getByRole('button',{name:'저장할 폴더 선택',exact:true}).click();
    const notice=page.locator('.nubi-clone-error');
    await notice.getByText('저장소 서버 또는 중간 프록시 오류 (502)',{exact:true}).waitFor();
    assert(requests>previous,'Manual retry must reach the server again');
    assert.equal(await page.getByLabel('저장소 주소',{exact:true}).inputValue(),remote);
    await assert.rejects(access(path.join(dest,'unavailable')),{code:'ENOENT'});
    await notice.locator('summary').click();
    const diagnostic=await notice.locator('pre').innerText();
    assert.match(diagnostic,/HTTP: 502/);assert.match(diagnostic,/Git 종료 코드: 128/);
    assert(!diagnostic.includes(remote));
  }
  const output='verification/git-clone-errors-2026-10-15';await mkdir(output,{recursive:true});
  await page.screenshot({path:path.join(output,'http-502-details.png')});
  await page.locator('.nubi-clone-error summary').click();
  await page.screenshot({path:path.join(output,'http-502.png')});
  await (await app.browserWindow(page)).evaluate(window=>window.setSize(700,850));
  await page.locator('.nubi-clone-error').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(output,'http-502-narrow.png')});
  const bounds=await page.locator('.nubi-clone-error').evaluate(element=>({scroll:element.scrollWidth,width:element.clientWidth}));
  assert(bounds.scroll<=bounds.width+1,'Diagnostic must fit the form');assert.deepEqual(errors,[]);
  await writeFile(path.join(output,'electron.json'),JSON.stringify({passed:true,attempts:2,requests,errors,emptyDestinationRemoved:true,diagnosticsRedacted:true,boundary:'Actual Git HTTP 502, isolated Electron IPC and UI. Company server and Windows MinGit are not verified.'},null,2));
  console.log('Actual Git HTTP 502, persistent UI diagnostics and same-location retry passed.');
}finally{
  await app?.close();await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});
}
