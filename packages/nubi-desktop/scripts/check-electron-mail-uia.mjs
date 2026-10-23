import {_electron as electron} from 'playwright';
import {desktopTestWindow,killProcessTree} from './electron-test-window.mjs';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {uiaMailCapture} from '../runtime/mail-desktop-uia.mjs';
import {mailListMetadata} from '../runtime/mail-list-metadata.mjs';
import {MailListIndex} from '../runtime/mail-list-index.mjs';
import {captureDesign} from './design-rules.mjs';
const require=createRequire(import.meta.url),sha=value=>createHash('sha256').update(value).digest('hex');
const temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-uia-native-')),storage=path.join(temporary,'state'),project=path.join(temporary,'project'),output=path.resolve('verification/desktop-mail-uia-2026-10-23/native');
for(const folder of [storage,project,output])await mkdir(folder,{recursive:true});await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root:project}));
const binding={processId:10,hwnd:20,started:'123456',processName:'mySingleDesktopMessage'};
const capture=uiaMailCapture({version:1,binding,capturedAt:new Date().toISOString(),nodes:[{key:'root',parent:null,type:'Window',name:'Synthetic Desktop mail'},{key:'subject',parent:'root',type:'Text',name:'제목: UIA 원문 보관 검증'},{key:'sender',parent:'root',type:'Text',name:'보낸 사람: sender@example.test'},{key:'body',parent:'root',type:'Document',name:'본문',readOnly:true,text:'UIA-NATIVE-ORIGINAL-553311\n암호화해 보관한 화면 본문입니다.'}]});
const account=sha('synthetic-desktop-uia'),id=sha(account+'\0'+capture.uidl),sourceHash=sha(capture.raw),manifest={version:1,id,uidl:capture.uidl,sourceHash,fetchedAt:new Date().toISOString(),mail:capture.normalized};
const record={id,account,mailbox:'other',protocol:'local',sourceStorage:'desktop_uia',uidl:capture.uidl,subject:capture.normalized.subject,from:capture.normalized.from,date:'',fetchedAt:manifest.fetchedAt,sourceHash,manifestHash:sha(JSON.stringify(manifest)),state:'queued',attachmentState:'complete',listMetadata:{sourceHash,...mailListMetadata(capture.normalized)}};
let app,page;const checks=[],errors=[];
try{
 app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,OPENWIKI_CONFIG_DIR:path.join(temporary,'personal'),ELECTRON_RUN_AS_NODE:undefined}});
 page=await desktopTestWindow(app);page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.desktop-shell[data-startup-ready=true]').waitFor({timeout:60000});await page.locator('.nubi-intro').waitFor({state:'detached',timeout:20000});
 const request=async args=>{const result=await page.evaluate(args=>window.nubi.request('mail',args),args);assert.equal(result.__nubiError,undefined,JSON.stringify(result));return result;};
 await request({action:'setAutoWiki',enabled:false});await request({action:'selectMethod',method:'desktop'});let status=await request({action:'confirmStorage',includeAttachments:false});
 // Seed only synthetic observations using the app's OS-backed temporary vault.
 // No live Knox result or credential is injected, returned or logged.
 await app.evaluate(async({safeStorage},{base,storage,root,id,raw,manifest})=>{
  const require=process.getBuiltinModule('node:module').createRequire(base+'/package.json');
  const {connectionVault}=require(base+'/electron-app/connection-vault.cjs'),vault=connectionVault({directory:storage+'/connections-v1',safeStorage});
  const key=Buffer.from(await vault.get('mail-raw-key'),'hex'),fs=require('node:fs/promises'),crypto=require('node:crypto');await fs.mkdir(root+'/'+id,{recursive:true,mode:0o700});
  for(const [name,value] of [['uia.json',raw],['manifest.json',manifest]]){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(id+'/'+name));const bytes=Buffer.concat([cipher.update(Buffer.from(value)),cipher.final()]);await fs.writeFile(root+'/'+id+'/'+name+'.enc',Buffer.concat([Buffer.from('NMR1'),iv,cipher.getAuthTag(),bytes]),{mode:0o600});}
 },{base:process.cwd(),storage,root:status.rawRoot,id,raw:capture.raw.toString(),manifest:JSON.stringify(manifest)});
 const db=new DatabaseSync(path.join(storage,'personal-mail/workspace.db'));try{db.prepare('INSERT INTO records VALUES (?,?)').run('mail:'+id,JSON.stringify(record));new MailListIndex(db).syncKey('mail:'+id);}finally{db.close();}
 await page.getByRole('button',{name:'메일',exact:true}).click();const history=page.getByRole('region',{name:'메일 이력',exact:true});await history.getByRole('button',{name:'메일 설정',exact:true}).click();
 const settings=page.getByRole('dialog',{name:'메일 설정',exact:true}),card=page.getByRole('region',{name:'Knox Desktop 메일',exact:true});await card.waitFor();
 if(process.platform!=='win32'){assert(await card.getByRole('button',{name:'Knox Desktop에 연결',exact:true}).isDisabled());await card.getByText('Windows에서 Knox Desktop을 실행한 뒤 연결해 주세요.',{exact:true}).waitFor();}
 assert.equal(await settings.getByRole('region',{name:'파일에서 가져오기',exact:true}).count(),0);assert.equal(app.windows().length,1);await captureDesign(page,{path:path.join(output,'settings-entry.png')});checks.push('actual settings select Desktop UIA and keep the non-Windows guard without opening portal or file import');
 await page.keyboard.press('Escape');await history.getByRole('tab',{name:'별도 보관',exact:true}).click();
 await page.getByRole('button',{name:'UIA 원문 보관 검증',exact:true}).click();await page.getByLabel('Desktop 읽기 범위',{exact:true}).waitFor();await page.getByText('UIA-NATIVE-ORIGINAL-553311',{exact:false}).first().waitFor();
 await page.getByText('UIA로 읽은 원문',{exact:true}).click();await captureDesign(page,{path:path.join(output,'reader-original.png')});
 const download=path.join(temporary,'observation.json');await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},download);
 await page.getByRole('button',{name:'UIA 원문 다운로드',exact:true}).click();let downloaded;for(let attempt=0;attempt<200;attempt++){try{downloaded=await readFile(download);break;}catch(error){if(error.code!=='ENOENT')throw error;await new Promise(resolve=>setTimeout(resolve,50));}}assert(downloaded,'native original download did not finish');assert.equal(sha(downloaded),sourceHash);checks.push('actual bundled reader and native JSON download preserve the encrypted synthetic UIA original');
 await history.getByRole('button',{name:'메일 설정',exact:true}).click();await settings.getByRole('button',{name:'원본 위치 변경',exact:true}).click();
 const target=path.join(temporary,'selected-originals');await mkdir(target);const expectedRoot=path.join(await realpath(target),'nubi-mail-raw');await app.evaluate(({dialog},directory)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[directory]});},target);
 const location=page.getByRole('dialog',{name:'메일 보관 설정',exact:true});await location.waitFor();assert.equal(await location.getByRole('switch',{name:'첨부 원본도 보관',exact:true}).count(),0);await location.getByRole('button',{name:'폴더 선택',exact:true}).click();await location.waitFor({state:'hidden'});
 status=await request({action:'status',includeMessages:false});assert.equal(status.rawRoot,expectedRoot);assert.match((await request({action:'read',id})).mail.text,/UIA-NATIVE-ORIGINAL/);await settings.getByRole('region',{name:'수집 범위',exact:true}).getByText(status.rawRoot,{exact:true}).waitFor();
 await (await app.browserWindow(page)).evaluate(win=>win.setContentSize(700,900));await page.waitForFunction(()=>innerWidth===700);assert(await settings.evaluate(node=>node.scrollWidth<=node.clientWidth+1));await captureDesign(page,{path:path.join(output,'storage-moved-700.png')});
 await page.reload();await page.locator('.desktop-shell[data-startup-ready=true]').waitFor({timeout:60000});status=await request({action:'status',includeMessages:false});assert.equal(status.connectionMethod,'desktop');assert.equal(status.rawRoot,expectedRoot);assert.match((await request({action:'read',id})).mail.text,/UIA-NATIVE-ORIGINAL/);checks.push('actual native folder picker, encrypted move, narrow settings and renderer reload preserve the original');
 const previous=app.process();await Promise.race([app.close().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,8000))]);killProcessTree(previous);app=null;
 app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,OPENWIKI_CONFIG_DIR:path.join(temporary,'personal'),ELECTRON_RUN_AS_NODE:undefined}});page=await desktopTestWindow(app);page.on('pageerror',error=>errors.push(error.message));await page.locator('.desktop-shell[data-startup-ready=true]').waitFor({timeout:60000});
 status=await request({action:'status',includeMessages:false});assert.equal(status.rawRoot,expectedRoot);assert.equal(status.connectionMethod,'desktop');assert.match((await request({action:'read',id})).mail.text,/UIA-NATIVE-ORIGINAL/);checks.push('a fresh Electron process reopens the relocated original using its persisted OS-backed encryption key');
 assert.deepEqual(errors,[]);await writeFile(path.join(output,'result.json'),JSON.stringify({checks,errors,boundary:'Actual macOS Electron host, OS-backed temporary encryption vault, bundled runtime and native download/location IPC. Observation and row seeded only in the temporary fixture. Windows Knox UIA discovery and DRM read remain unverified.'},null,2));console.log('PASS',JSON.stringify(checks));
}catch(error){await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await writeFile(path.join(output,'failure.json'),JSON.stringify({message:error.message,errors},null,2));throw error;}
finally{const child=app?.process();if(app)await Promise.race([app.close().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,8000))]);if(child)killProcessTree(child);await rm(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:250});}
