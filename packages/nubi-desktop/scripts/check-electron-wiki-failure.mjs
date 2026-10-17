import {desktopTestWindow} from './electron-test-window.mjs';
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {ProjectService} from '../runtime/project-service.mjs';

const require=createRequire(import.meta.url),temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-wiki-failure-native-'));
const root=path.join(temporary,'project'),storage=path.join(temporary,'state'),output=path.resolve('verification/wiki-failure-2026-10-16');
await mkdir(path.join(root,'openwiki'),{recursive:true});await mkdir(output,{recursive:true});
await writeFile(path.join(root,'app.txt'),'Synthetic source\n');
await writeFile(path.join(root,'openwiki/home.md'),'# 운영 가이드\n\n기존 문서\n');
const service=new ProjectService({storageRoot:storage});let app,page;
try{
  await service.open(root,{initializeWiki:false});
  service.wikiUpdater=async({root:copy,onEvent})=>{
    await writeFile(path.join(copy,'openwiki/saved.md'),'# 보관 문서\n');
    onEvent({type:'progress',stage:'reviewing',completed:0,total:1});
    throw Error('private wrapper',{cause:Error('claude_login_required')});
  };
  const proposal=await service.wikiUpdate({method:'propose'});
  await service.wikiUpdate({method:'run',id:proposal.id,fingerprint:proposal.fingerprint});
  let failed;
  for(let i=0;i<300;i++){
    failed=(await service.wikiUpdate({method:'status'})).updates[0];
    if(failed.state==='failed')break;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(failed.error,'claude_login_required');assert.equal(failed.stage,'reviewing');
  service.dispose();service.store.close();
  await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
  app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,OPENWIKI_CONFIG_DIR:path.join(temporary,'personal'),ELECTRON_RUN_AS_NODE:undefined}});
  page=await desktopTestWindow(app);page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.locator('.desktop-shell[data-startup-ready=true]').waitFor({timeout:60000});
  await page.locator('.nubi-sidebar-project').first().waitFor();
  await page.getByRole('button',{name:'위키',exact:true}).click();
  await page.locator('.nubi-wiki-settings-link').click();
  const card=page.getByRole('region',{name:'위키 갱신',exact:true});
  await card.getByRole('button',{name:'이어서 갱신',exact:true}).waitFor();
  await card.getByText('중단 이유',{exact:true}).click();
  await card.getByText('claude_login_required',{exact:true}).waitFor();
  assert.match(await card.innerText(),/내용 검토/);assert.match(await card.innerText(),/Claude.*로그인/);
  await page.screenshot({path:path.join(output,'native-failure.png'),animations:'disabled'});
  // Closing/reopening settings reads the persisted failure without starting a model.
  await page.keyboard.press('Escape');await page.locator('.nubi-wiki-settings-link').click();
  await card.getByRole('button',{name:'이어서 갱신',exact:true}).waitFor();
  await card.getByText('중단 이유',{exact:true}).click();
  await card.getByText('claude_login_required',{exact:true}).waitFor();
  assert.equal(await readFile(path.join(root,'openwiki/home.md'),'utf8'),'# 운영 가이드\n\n기존 문서\n');
  assert.deepEqual(errors,[]);
  await writeFile(path.join(output,'native-checks.json'),JSON.stringify({scope:'Real built Electron and persisted ProjectService failure with injected updater; no live provider or Windows.',reentry:true,stage:'reviewing',code:'claude_login_required',originalPreserved:true,errors},null,2));
  console.log('Built Electron: persisted Wiki failure, safe cause/stage, settings reentry and original preservation passed.');
}catch(error){await page?.screenshot({path:path.join(output,'native-test-failure.png'),timeout:5000}).catch(()=>{});throw error;}
finally{await app?.close();service.dispose();if(service.store?.db.isOpen)service.store.close();await rm(temporary,{recursive:true,force:true});}
