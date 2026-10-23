import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {desktopTestWindow,killProcessTree} from './electron-test-window.mjs';

const require=createRequire(import.meta.url),temporary=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-reader-shell-'))),root=path.join(temporary,'project'),storage=path.join(temporary,'state'),mail=path.join(temporary,'AUTO_INBOX');
await Promise.all([mkdir(root),mkdir(storage),mkdir(mail)]);await mkdir(path.join(root,'openwiki'));
const text='# Reader shell verification\n\n'+Array.from({length:60},(_,i)=>'검증 문단 '+(i+1)+': 중앙 목록과 오른쪽 상세를 함께 읽습니다.').join('\n\n');
await writeFile(path.join(root,'openwiki/home.md'),text);await writeFile(path.join(root,'openwiki/second.md'),'# Second verification page\n\n연결한 두 번째 문서입니다.');
await writeFile(path.join(root,'example.txt'),'보존할 파일 초안\n');
for(const args of [['init'],['config','user.name','Fixture'],['config','user.email','fixture@example.test'],['add','.'],['commit','-m','Reader fixture']])execFileSync('git',['-C',root,...args],{stdio:'ignore'});
await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
await writeFile(path.join(mail,'one.eml'),'Subject: Reader verification mail\r\nFrom: fixture@example.test\r\nTo: reader@example.test\r\nDate: Fri, 23 Oct 2026 10:00:00 +0900\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n'+text);
const app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,OPENWIKI_CONFIG_DIR:path.join(temporary,'openwiki-state'),NUBI_WEB_PORT:undefined,ELECTRON_RUN_AS_NODE:undefined}}),checks=[],errors=[],output=path.resolve('verification/reader-shell-2026-10-23');
await mkdir(output,{recursive:true});const child=app.process();let page;
try{
 page=await desktopTestWindow(app);page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.locator('.desktop-shell[data-startup-ready=true]').waitFor({timeout:60000});
 await page.locator('.nubi-intro').waitFor({state:'detached',timeout:15000});
 await page.waitForFunction(()=>document.querySelector('[aria-label="파일"]')?.disabled===false);
 const request=(method,args)=>page.evaluate(({method,args})=>window.nubi.request(method,args),{method,args});
 await page.getByRole('button',{name:'위키',exact:true}).click();
 const pane=page.getByRole('complementary',{name:'보조 작업 영역'});
 await pane.getByRole('heading',{name:'Reader shell verification',exact:true}).waitFor();
 assert.equal(await page.locator('.nubi-wiki-browser .nubi-wiki-document').count(),0);
 await pane.getByRole('button',{name:'위키 수정',exact:true}).click();
 await pane.getByRole('textbox',{name:'위키 본문',exact:true}).fill(text+'\n\n보관할 미저장 초안');
 await page.getByRole('button',{name:'오른쪽 사이드바 닫기',exact:true}).click();
 await pane.waitFor({state:'hidden'});
 await page.locator('.nubi-wiki-result').filter({hasText:'Reader shell verification'}).click();
 assert.match(await pane.getByRole('textbox',{name:'위키 본문',exact:true}).inputValue(),/보관할 미저장 초안/);
 assert.equal(await readFile(path.join(root,'openwiki/home.md'),'utf8'),text);
 await page.screenshot({path:output+'/wiki.png',animations:'disabled'});
 checks.push('실제 Electron에서 위키 상세 이동, 닫기와 재열기, 미저장 초안과 원본 파일 보존 확인');
 await page.getByRole('button',{name:'메일',exact:true}).click();
 // The test chooses only its synthetic EML folder through the product import.
 await app.evaluate(({dialog},directory)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[directory]});},mail);
 const imported=await request('importMailFolder',{});assert.equal(imported.__nubiError,undefined,JSON.stringify(imported));
 let mailStatus;for(let attempt=0;attempt<150;attempt++){mailStatus=await request('mail',{action:'status',includeMessages:false});if(mailStatus.localImport?.state==='completed'&&mailStatus.localImport.imported===1)break;if(mailStatus.localImport?.state==='failed')break;await new Promise(resolve=>setTimeout(resolve,100));}
 assert.equal(mailStatus.localImport?.imported,1,JSON.stringify(mailStatus.localImport));
 // Re-enter through the real navigation to refresh the local list.
 await page.getByRole('button',{name:'홈',exact:true}).click();await page.getByRole('button',{name:'메일',exact:true}).click();
 await page.getByRole('button',{name:'Reader verification mail',exact:true}).click();
 await pane.getByRole('heading',{name:'Reader verification mail',exact:true}).waitFor();
 assert.equal(await page.locator('.nubi-mail-history .nubi-mail-history-detail').count(),0);
 assert.equal(await pane.getByRole('article',{name:'메일 본문'}).count(),1);
 await page.screenshot({path:output+'/mail.png',animations:'disabled'});
 checks.push('실제 EML 가져오기와 원문 읽기로 메일 상세가 오른쪽에서 표시됨');
 await page.getByRole('button',{name:'보조 영역 넓게 보기',exact:true}).click();
 await page.getByRole('button',{name:'3분할로 돌아가기',exact:true}).click();
 await page.getByRole('button',{name:'오른쪽 사이드바 닫기',exact:true}).click();await pane.waitFor({state:'hidden'});
 assert.equal(await page.locator('.nubi-mail-results').isVisible(),true);
 checks.push('상세 확대, 복귀와 닫기 후 중앙 목록 유지 확인');
 assert.deepEqual(errors,[]);
 await writeFile(output+'/checks.json',JSON.stringify({scope:'Current Electron shell and worker, temporary Git project and synthetic EML; no company accounts or Windows native docking',checks,errors},null,2));console.log(checks.join('\n'));
}catch(error){if(page){await page.screenshot({path:output+'/failure.png'}).catch(()=>{});await writeFile(output+'/failure.txt',JSON.stringify({checks,errors,message:error.message,body:await page.locator('body').innerText()},null,2));}throw error;}
finally{await Promise.race([app.close().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,10000))]);killProcessTree(child);await rm(temporary,{recursive:true,force:true});}
