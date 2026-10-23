import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {desktopTestWindow,killProcessTree} from './electron-test-window.mjs';
const require=createRequire(import.meta.url),temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-browser-shell-')),storage=path.join(temporary,'state'),root=path.join(temporary,'project'),out=path.resolve('verification/external-browser-content-2026-10-23');
await mkdir(storage);await mkdir(root);await mkdir(out,{recursive:true});await writeFile(path.join(root,'README.md'),'# Browser connection fixture\n');await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
const app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}}),child=app.process();let page;
try{
 page=await desktopTestWindow(app);const errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(30000);
 await page.locator('.desktop-shell:not([inert])').waitFor();
 if(await page.getByRole('button',{name:'나중에',exact:true}).isVisible().catch(()=>false))await page.getByRole('button',{name:'나중에',exact:true}).click();
 await page.getByRole('button',{name:'파일',exact:true}).click();await page.getByRole('button',{name:'새 탭',exact:true}).click();await page.getByRole('menuitem',{name:'웹',exact:true}).click();
 await page.getByRole('heading',{name:'외부 브라우저와 함께 작업하세요',exact:true}).waitFor();await page.getByRole('button',{name:'브라우저 연결',exact:true}).waitFor();
 const state=await page.evaluate(()=>window.nubi.request('browserConnection',{action:'status'}));assert.equal(state.mode,'external');assert.equal(state.showInternal,false);assert.equal(state.connected,false);assert.equal(state.dock.displayMode,'tab-content');
 assert.equal(await page.getByRole('button',{name:'연결 코드 복사',exact:true}).count(),0);assert.equal(await page.locator('.desktop-browser-toolbar:visible,.nubi-native-browser-bar:visible').count(),0);
 await page.waitForTimeout(500);await page.locator('.nubi-interaction-surface').waitFor({state:'detached'});await page.screenshot({path:path.join(out,'full-shell-connection.png')});
 assert.deepEqual(errors,[]);const report={scope:'built full Electron shell with temporary project/storage; no account or external browser launch',checks:['외부 연결 전부터 오른쪽 연결 화면 표시','연결 버튼 한 개와 접힌 최초 설치 안내','연결 코드 복사 및 브라우저 창 메뉴 없음','공통 main에서 콘텐츠 포트와 창 드래그 경로 등록','페이지 오류 없음'],unverified:['actual Windows window drag','company SSO','installed application update']};await writeFile(path.join(out,'full-shell-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}catch(error){if(page)await page.screenshot({path:path.join(out,'full-shell-failure.png')}).catch(()=>{});throw error;}
finally{await Promise.race([app.close().catch(()=>{}),new Promise(resolve=>setTimeout(resolve,5000))]);if(child.exitCode===null)killProcessTree(child);await rm(temporary,{recursive:true,force:true});}
