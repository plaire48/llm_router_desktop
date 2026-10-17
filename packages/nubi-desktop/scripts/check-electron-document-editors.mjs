import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {startFixtureModel} from './fixture-model.mjs';
const require=createRequire(import.meta.url),temp=await mkdtemp(path.join(os.tmpdir(),'nubi-editors-')),root=path.join(temp,'project'),storage=path.join(temp,'state'),out=path.resolve(process.env.NUBI_UI_OUTPUT||'../../artifacts/document-integrations-2026-10-17/electron');
await mkdir(root);await mkdir(storage);await mkdir(out,{recursive:true});await writeFile(path.join(root,'note.txt'),'saved suffix');await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
let stage='launch',app,read=false,proposed=false;
const model=await startFixtureModel({respond:({messages,results,tools,text,call})=>{
 if(!read){assert.ok(tools.includes('read_editor_range'));read=true;return call('read_editor_range',{});}
 if(!proposed){const o=results.findLast(r=>r.observationId);assert.equal(o.text,'before suffix');proposed=true;return call('propose_editor_edit',{observationId:o.observationId,start:0,end:6,oldText:'before',newText:'after'});}
 assert.ok(messages.some(m=>typeof m.content==='string'&&m.content.includes('"status":"verified"')));return text('열린 문서의 변경을 확인했습니다. 저장은 편집기에서 해 주세요.');
}});
try{
 app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}});
 const page=await app.firstWindow();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.locator('.desktop-shell[data-startup-ready="true"]').waitFor();
 await page.waitForFunction(()=>!document.querySelector('.nubi-intro')&&!document.querySelector('.desktop-shell')?.inert);
 if(await page.getByText('메일을 연결해 주세요').count())await page.keyboard.press('Escape');
 await page.evaluate(connection=>window.nubi.request('provider',{action:'connect',input:connection}),model.connection);
 stage='open buffer';await page.getByRole('button',{name:'파일',exact:true}).click();await page.getByRole('treeitem',{name:'note.txt',exact:true}).dblclick();await page.locator('.desktop-editor .inputarea').first().focus();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type('before suffix');
 stage='connect editor';await page.getByRole('button',{name:'스킬 관리',exact:true}).click();await page.getByRole('button',{name:'문서 편집기 연결',exact:true}).click();await page.getByRole('button',{name:'누비에서 편집',exact:true}).click();await page.locator('.nubi-connection-document').getByText('note.txt',{exact:true}).waitFor();await page.screenshot({path:path.join(out,'editor-connected.png')});assert.equal(await page.getByRole('dialog').count(),1);await page.keyboard.press('Escape');
 stage='request edit';await page.getByRole('textbox',{name:'작업 요청',exact:true}).fill('연결한 문서에서 before를 after로 바꿔 주세요');await page.getByRole('button',{name:'전송',exact:true}).click();
 const question=page.getByRole('region',{name:'답변이 필요한 질문',exact:true});await question.waitFor({timeout:60000});assert.equal(await readFile(path.join(root,'note.txt'),'utf8'),'saved suffix');await page.screenshot({path:path.join(out,'edit-approval.png')});
 stage='approve';await question.locator('.question-option').filter({hasText:'실행'}).first().click();await question.getByRole('button',{name:/답변 보내기|^보내기$/}).click();await page.getByText('열린 문서의 변경을 확인했습니다. 저장은 편집기에서 해 주세요.',{exact:true}).waitFor({timeout:60000});
 assert.equal(await readFile(path.join(root,'note.txt'),'utf8'),'saved suffix');await page.waitForFunction(()=>document.querySelector('.desktop-editor .view-lines')?.textContent.includes('after'));
 stage='undo and save';await page.locator('.desktop-editor .inputarea').first().focus();await page.keyboard.press('ControlOrMeta+Z');await page.waitForFunction(()=>document.querySelector('.desktop-editor .view-lines')?.textContent.includes('before'));await page.getByRole('button',{name:'파일 저장',exact:true}).click();assert.equal(await readFile(path.join(root,'note.txt'),'utf8'),'before suffix');
 stage='reopen modal';await page.getByRole('button',{name:'스킬 관리',exact:true}).click();await page.getByRole('button',{name:'문서 편집기 연결',exact:true}).click();if(process.platform!=='win32'){await page.getByRole('button',{name:'PDF 앱 연결',exact:true}).click();await page.getByRole('alert').filter({hasText:'Windows에서 열린 외부 앱'}).waitFor();}await page.screenshot({path:path.join(out,'editor-reopen.png')});await page.keyboard.press('Escape');assert.deepEqual(errors,[]);
 await writeFile(path.join(out,'result.json'),JSON.stringify({ok:true,platform:process.platform,checks:['actual Electron Monaco unsaved buffer read','approval before write','verified suffix preservation','no automatic file save','Monaco undo and explicit save','modal reentry and Windows capability message'],errors,model:'scripted fixture',windowsOfficeVerified:false,obsidianVerified:false},null,2));console.log(JSON.stringify({ok:true,stage,errors}));
}catch(error){console.error('stage',stage);const page=app&&(await app.windows())[0];if(page){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await writeFile(path.join(out,'failure.txt'),await page.locator('body').innerText());}throw error;}finally{await app?.close();model.close();await rm(temp,{recursive:true,force:true});}
