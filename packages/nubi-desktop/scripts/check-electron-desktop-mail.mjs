import {_electron as electron} from 'playwright';
import {desktopTestWindow} from './electron-test-window.mjs';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-desktop-mail-native-'));
const storage=path.join(temporary,'state'),archive=path.join(temporary,'archive'),project=path.join(temporary,'project'),output=path.resolve('verification/desktop-mail-2026-10-22/native-reference');
for(const folder of [storage,path.join(archive,'AUTO_INBOX'),project,output])await mkdir(folder,{recursive:true});
await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root:project}));
const original=Buffer.from('Subject: Knox Desktop fixture\r\nFrom: sender@example.invalid\r\nTo: owner@example.invalid\r\nDate: '+new Date().toUTCString()+'\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nPC에 보관한 메일의 합성 본문입니다.');
const source=path.join(archive,'AUTO_INBOX/fixture.mysingle');await writeFile(source,original);
let app,page;const checks=[],errors=[];
try{
 app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,OPENWIKI_CONFIG_DIR:path.join(temporary,'personal'),ELECTRON_RUN_AS_NODE:undefined}});
 page=await desktopTestWindow(app);page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
 await page.locator('.desktop-shell[data-startup-ready=true]').waitFor({timeout:60000});await page.emulateMedia({reducedMotion:'reduce'});
 await page.getByRole('button',{name:'메일',exact:true}).click();await page.getByRole('region',{name:'메일 이력',exact:true}).getByRole('button',{name:'메일 설정',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'메일 설정',exact:true}),card=page.getByRole('region',{name:'Knox Desktop 메일',exact:true});await card.getByRole('button',{name:'저장된 메일 연결',exact:true}).waitFor();
 const request=async args=>{const result=await page.evaluate(args=>window.nubi.request('mail',args),args);assert.equal(result.__nubiError,undefined,JSON.stringify(result));return result;};
 assert.equal((await request({action:'status',includeMessages:false})).desktop.mode,'desktop');
 assert.equal((await app.windows()).length,1,'opening mail must not create a portal session window');
 await page.screenshot({path:path.join(output,'settings-entry.png')});checks.push('actual app defaults to the desktop archive without a portal window');
 if(process.platform!=='win32'){
  await card.getByRole('button',{name:'저장된 메일 연결',exact:true}).click();await card.getByText(/Windows의 Knox Desktop Message/).waitFor();assert.equal((await app.windows()).length,1);
  checks.push('non-Windows reports local source unavailable without starting portal login');
 }
 await request({action:'setAutoWiki',enabled:false});
 await app.evaluate(({dialog},directory)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[directory]});},archive);
 await page.getByRole('region',{name:'파일에서 가져오기',exact:true}).getByRole('button',{name:'폴더 선택',exact:true}).click();
 let status;for(let n=0;n<120;n++){status=await request({action:'status',includeMessages:false});if(['completed','failed'].includes(status.localImport?.state))break;await delay(100);}
 assert.equal(status.localImport.state,'completed',JSON.stringify(status.localImport));assert.equal(status.localCount,1);
 const result=await request({action:'search',query:'',filters:{mailbox:'inbox'}});assert.equal(result.results.length,1);
 const read=await request({action:'read',id:result.results[0].id});assert.match(read.mail.text,/PC에 보관한 메일/);
 const downloaded=path.join(temporary,'downloaded.mysingle');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},downloaded);
 const saved=await page.evaluate(({id,sourceHash})=>window.nubi.request('downloadMail',{id,kind:'raw',expectedSourceHash:sourceHash}),read);assert.equal(saved.saved,true,JSON.stringify(saved));assert.deepEqual(await readFile(downloaded),original);assert.deepEqual(await readFile(source),original);
 checks.push('actual IPC, encrypted intake, metadata search, original read and native original download preserve bytes');
 // Mac cannot discover Windows Desktop Message. Seed only the synthetic
 // fixture's pointer in SQLite, then exercise the actual bundled runtime/IPC
 // and reader without adding a test-only source path API to the product.
 const fixtureDb=new DatabaseSync(path.join(storage,'personal-mail','workspace.db'));
 try{
  const record=JSON.parse(fixtureDb.prepare('SELECT value FROM records WHERE key=?').get('mail:'+read.id).value),reference={version:1,root:await realpath(archive),relative:'AUTO_INBOX/fixture.mysingle',kind:'inbox'};
  fixtureDb.prepare('UPDATE records SET value=? WHERE key=?').run(JSON.stringify({...record,sourceStorage:'desktop_reference',desktopReference:reference,manifestHash:createHash('sha256').update(JSON.stringify(reference)).digest('hex')}),'mail:'+read.id);
 }finally{fixtureDb.close();}
 await rm(path.join(status.rawRoot,read.id),{recursive:true});
 const referenceRead=await request({action:'read',id:read.id,includePresentation:true});assert.equal(referenceRead.mail.storage.mode,'desktop_reference');assert.match(referenceRead.mail.text,/PC에 보관한 메일/);
 const referenceDownload=path.join(temporary,'reference-download.mysingle');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},referenceDownload);
 const referenceSaved=await page.evaluate(({id,sourceHash})=>window.nubi.request('downloadMail',{id,kind:'raw',expectedSourceHash:sourceHash}),read);assert.equal(referenceSaved.saved,true,JSON.stringify(referenceSaved));assert.deepEqual(await readFile(referenceDownload),original);
 await rm(source);const missing=await page.evaluate(id=>window.nubi.request('mail',{action:'read',id}),read.id);assert.equal(missing.__nubiError,'mail_source_missing');await writeFile(source,original);
 checks.push('seeded reference fixture exercises actual bundled read, presentation and download with no stored copy; missing original is refused');
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 const update=page.getByRole('button',{name:'메일 목록 업데이트',exact:true});await update.waitFor();await update.click();
 await page.getByRole('button',{name:'Knox Desktop fixture',exact:true}).click();await page.getByRole('heading',{name:'Knox Desktop fixture',exact:true}).waitFor();
 await page.screenshot({path:path.join(output,'mail-reader.png')});
 await page.getByRole('region',{name:'메일 이력',exact:true}).getByRole('button',{name:'메일 설정',exact:true}).click();await card.waitFor();assert.equal((await request({action:'status',includeMessages:false})).localCount,1);
 await (await app.browserWindow(page)).evaluate(win=>win.setContentSize(700,900));await page.setViewportSize({width:700,height:900});
 assert(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1));await page.screenshot({path:path.join(output,'settings-reopened-700.png')});
 checks.push('reader and reopened settings preserve collected mail in the built Electron app');
 assert.deepEqual(errors,[]);await writeFile(path.join(output,'result.json'),JSON.stringify({checks,errors,boundary:'Actual local Electron app and synthetic MYSINGLE. Reference record seeded only in the temporary test DB; Windows discovery and migration tested separately in Node fixtures. Real Windows Desktop Message, company mail and NASCA remain unverified.'},null,2));console.log('PASS',JSON.stringify(checks));
}catch(error){await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await writeFile(path.join(output,'failure.json'),JSON.stringify({message:error.message,buttons:await page?.getByRole('button').allTextContents().catch(()=>[]),errors},null,2));throw error;}
finally{await app?.close().catch(()=>{});await rm(temporary,{recursive:true,force:true,maxRetries:20,retryDelay:250});}
