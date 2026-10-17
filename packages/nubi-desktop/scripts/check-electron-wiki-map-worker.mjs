import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {ProjectService} from '../runtime/project-service.mjs';
import {desktopTestWindow} from './electron-test-window.mjs';
const require=createRequire(import.meta.url),temp=await mkdtemp(path.join(os.tmpdir(),'nubi-map-worker-')),root=path.join(temp,'project'),state=path.join(temp,'state');
await mkdir(root);await writeFile(path.join(root,'README.md'),'Synthetic graph verification');
await mkdir(path.join(root,'openwiki'));
for(let i=0;i<30;i++){
 const group=Math.floor(i/10),folder=path.join(root,'openwiki','domain-'+group);await mkdir(folder,{recursive:true});
 await writeFile(path.join(folder,`page-${i}.md`),`---\ntitle: 구성 요소 ${i}\ntype: ${['Process','Integration','Module'][group]}\n---\n# 구성 요소 ${i}\n\n${i%10?`[앞 문서](page-${i-1}.md)`:''}`);
}
const service=new ProjectService({storageRoot:state});await service.open(root,{initializeWiki:false});service.dispose();service.store.close();await writeFile(path.join(state,'last-project.json'),JSON.stringify({root}));
let app;
try{
 app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:state,ELECTRON_RUN_AS_NODE:undefined}});
 const page=await desktopTestWindow(app),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(30000);
 await page.locator('.desktop-shell[data-startup-ready=true]').waitFor();await page.locator('.nubi-sidebar-project').first().waitFor();
 await page.evaluate(()=>{
  window.mapWorkerDone=false;window.mapWorkerErrors=[];
  const Native=Worker;
  window.Worker=class extends Native{
   constructor(...args){
    super(...args);
    if(String(args[0]).includes('wiki-layout')){
     this.addEventListener('message',({data})=>{if(data.done)window.mapWorkerDone=true;});
     this.addEventListener('error',event=>window.mapWorkerErrors.push(event.message));
    }
   }
  };
 });
 for(const name of ['메일','위키']){const button=page.getByRole('button',{name,exact:true});await button.click();assert.equal(await button.getAttribute('aria-pressed'),'true');await button.click();assert.equal(await page.getByRole('button',{name:'홈',exact:true}).getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.nubi-workbench').getAttribute('data-workspace-screen'),'welcome');}
 await page.getByRole('button',{name:'위키',exact:true}).click();await page.getByRole('tab',{name:'관계 지도',exact:true}).click();
 await page.waitForFunction(()=>window.mapWorkerDone);
 assert(await page.locator('.nubi-wiki-map svg g[role="button"]').count()>0);
 await page.getByRole('tab',{name:'종류',exact:true}).click();await page.getByRole('button',{name:'외부 연동',exact:false}).waitFor();
 await page.getByText('묶음과 표시 설정',{exact:true}).click();await page.getByRole('tab',{name:'묶어서 보기',exact:true}).click();
 await page.getByRole('group',{name:'3개 클러스터의 연결',exact:true}).waitFor();
 await page.locator('svg g[role=button]').first().focus();await page.keyboard.press('Enter');
 assert.equal(await page.getByRole('tab',{name:'문서로 보기',exact:true}).getAttribute('aria-selected'),'true');
 assert.deepEqual(await page.evaluate(()=>window.mapWorkerErrors),[]);assert.deepEqual(errors,[]);
 await mkdir('verification/wiki-map-clusters-2026-10-15',{recursive:true});await page.screenshot({path:'verification/wiki-map-clusters-2026-10-15/electron.png'});
 await writeFile('verification/wiki-map-clusters-2026-10-15/electron.json',JSON.stringify({passed:true,workerScheme:'app://bundle',errors,boundary:'Actual isolated macOS Electron with synthetic code wiki. No live model/mailbox or Windows claim.'},null,2));
 console.log('Electron packaged Wiki worker, code kinds and map rendering passed.');
}finally{await app?.close();await rm(temp,{recursive:true,force:true});}
