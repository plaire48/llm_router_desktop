// Product Electron + bundled worker + existing Pi and scripted provider.
// No native/COM host is injected; unavailable Office must stay unavailable.
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {startFixtureModel} from './fixture-model.mjs';
const require=createRequire(import.meta.url),temp=await mkdtemp(path.join(os.tmpdir(),'nubi-native-electron-')),root=path.join(temp,'project'),storage=path.join(temp,'state'),out=path.resolve('../../artifacts/workspace-native-1/electron');
await mkdir(path.join(root,'openwiki'),{recursive:true});await mkdir(storage);await mkdir(out,{recursive:true});await writeFile(path.join(root,'openwiki/home.md'),'# Fixture\n');
const git=args=>execFileSync('git',['-C',root,...args],{stdio:'ignore'});git(['init']);git(['config','user.name','Fixture']);git(['config','user.email','fixture@example.invalid']);git(['add','.']);git(['commit','-m','Fixture']);await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
const observed=[];const model=await startFixtureModel({respond({results,tools,text,call}){observed.push(tools);assert(tools.includes('native_office_status'));assert(!tools.includes('write_native_office'));if(!results.some(r=>r.apps))return call('native_office_status',{});return text('현재 연결된 Office 문서가 없습니다. Word, Excel, PowerPoint 문서를 수정하려면 native 호스트 연결이 필요합니다.');}});
let app;try{
 app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}});const page=await app.firstWindow();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.locator('.desktop-shell[data-startup-ready="true"]').waitFor();const startup=page.getByText('메일을 연결해 주세요');if(await startup.count())await page.keyboard.press('Escape');
 await page.evaluate(connection=>window.nubi.request('provider',{action:'connect',input:connection}),model.connection);
 const composer=page.getByRole('textbox',{name:'작업 요청'});await composer.fill('Word Excel PowerPoint native 연결을 확인해 줘');await page.getByRole('button',{name:'전송',exact:true}).click();await page.getByText('현재 연결된 Office 문서가 없습니다.',{exact:false}).first().waitFor({timeout:90000});
 const state=await page.evaluate(()=>window.nubi.request('state',{}));const task=state.tasks.find(t=>t.request.includes('native'));assert(task);const status=await page.evaluate(taskId=>window.nubi.request('nativeOfficeStatus',{taskId}),task.id);assert.equal(status.connected,false);assert.deepEqual(status.apps,['word','excel','powerpoint']);assert.equal(state.collaborations.length,0);assert(!task.messages.some(m=>/저장했습니다/.test(m.content)));assert.deepEqual(errors,[]);
 await page.screenshot({path:path.join(out,'unbound-office.png')});await writeFile(path.join(out,'result.json'),JSON.stringify({product:'Electron bundled worker',provider:'scripted local fixture',modelCalls:observed.length,toolCalls:model.calls,nativeStatus:status,errors,windowsOfficeVerified:false},null,2));console.log(JSON.stringify({ok:true,modelCalls:observed.length,nativeConnected:false,errors}));
}finally{await app?.close();model.close();await rm(temp,{recursive:true,force:true});}
