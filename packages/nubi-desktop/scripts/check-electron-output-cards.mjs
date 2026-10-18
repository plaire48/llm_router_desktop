// Native renderer and persisted synthetic records; no live model, Windows or Office proof.
import {_electron as electron} from 'playwright';
import {desktopTestWindow} from './electron-test-window.mjs';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {ProjectService} from '../runtime/project-service.mjs';
import {registerOutput} from '../runtime/output-files.mjs';
import {storeAgentCapture} from '../runtime/captures.mjs';
import {samplePdf} from '../tests/helpers-document-pdf.mjs';
const require=createRequire(import.meta.url),temp=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-output-cards-'))),root=path.join(temp,'project'),storage=path.join(temp,'state'),out=path.resolve('verification/wave2/outputs-electron');
await mkdir(path.join(root,'openwiki'),{recursive:true});await writeFile(path.join(root,'openwiki/home.md'),'# Local wiki');await mkdir(out,{recursive:true});
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
await writeFile(path.join(root,'capture.png'),Buffer.from(png,'base64'));await writeFile(path.join(root,'report.txt'),'검토 보고서\n확인한 내용과 남은 작업');await writeFile(path.join(root,'report.pdf'),samplePdf());
const zip=new JSZip();zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>산출물 Word 확인</w:t></w:r></w:p></w:body></w:document>');await writeFile(path.join(root,'report.docx'),await zip.generateAsync({type:'nodebuffer'}));
const service=new ProjectService({storageRoot:storage}),initial=await service.open(root,{initializeWiki:false}),task=await service.createTask({request:'산출물 열기 검증'}),runId='output-run';
for(const file of ['capture.png','report.txt','report.pdf','report.docx'])await registerOutput(service,task,{path:file,runId});
const capture=storeAgentCapture(service,task.id,runId,{image:png,width:1,height:1},'web'),card=await registerOutput(service,task,{captureId:capture.id,caption:'호스트가 저장한 캡처',runId});
service.store.set('task:'+task.id,{...task,state:'review',messages:[{id:'answer',role:'assistant',runId,content:'확인할 산출물을 준비했어요.',at:new Date().toISOString()}]});service.dispose();service.store.close();
await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));const {ProjectCatalog}=require('../electron-app/project-catalog.cjs');await new ProjectCatalog(storage).remember(initial);
let app,page;const errors=[],checks=[];
try{
 app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,OPENWIKI_CONFIG_DIR:path.join(temp,'personal'),ELECTRON_RUN_AS_NODE:undefined}});
 page=await desktopTestWindow(app);page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));await page.locator('.desktop-shell[data-startup-ready=true]').waitFor({timeout:60000});await page.emulateMedia({reducedMotion:'reduce'});
 if(await page.getByRole('dialog').count())await page.keyboard.press('Escape');
 const openTask=async()=>{const opener=page.getByRole('button',{name:'사이드바 펼치기',exact:true});if(await opener.count())await opener.click();await page.getByRole('navigation',{name:'대화 목록',exact:true}).getByRole('button',{name:'산출물 열기 검증',exact:true}).click();await page.getByRole('group',{name:'산출물'}).waitFor();};
 await openTask();const cards=page.getByRole('group',{name:'산출물'});assert.equal(await cards.getByRole('button').count(),5);
 for(const name of ['capture.png',card.name]){
  await cards.getByRole('button',{name:name+' 열기',exact:true}).click();const preview=page.locator('.desktop-image-preview').getByRole('img',{name,exact:true});await preview.waitFor();await page.waitForFunction(()=>{const img=document.querySelector('.desktop-image-preview img');return img?.complete&&img.naturalWidth===1;});assert.equal(await preview.getAttribute('alt'),name);checks.push(name==='capture.png'?'프로젝트 이미지 미리보기':'호스트 캡처 미리보기');
 }
 await cards.getByRole('button',{name:'report.txt 열기',exact:true}).click();await page.locator('.monaco-editor').waitFor();await page.waitForFunction(()=>document.querySelector('.monaco-editor')?.innerText.replace(/\s/g,' ').includes('검토 보고서'));checks.push('텍스트 편집기');
 await cards.getByRole('button',{name:'report.pdf 열기',exact:true}).click();await page.getByText('1 / 2',{exact:true}).waitFor();await page.waitForFunction(()=>{const c=document.querySelector('.nubi-pdf-preview canvas');return c&&c.width>0;});checks.push('PDF 미리보기');
 await cards.getByRole('button',{name:'report.docx 열기',exact:true}).click();await page.frameLocator('.nubi-document-preview iframe').getByText('산출물 Word 확인',{exact:true}).waitFor();checks.push('기존 Word 읽기');await page.screenshot({path:path.join(out,'word.png')});
 await page.reload();await page.locator('.desktop-shell[data-startup-ready=true]').waitFor({timeout:60000});if(await page.getByRole('dialog').count())await page.keyboard.press('Escape');await openTask();assert.equal(await page.getByRole('group',{name:'산출물'}).getByRole('button').count(),5);checks.push('새로고침 뒤 카드 보존');
 assert.deepEqual(errors,[]);await writeFile(path.join(out,'result.json'),JSON.stringify({checks,errors,scope:'macOS Electron with persisted synthetic files and host capture; no live model or Windows/Office verification.'},null,2));console.log('산출물 카드 Electron 검사 통과',checks);
}catch(error){if(page){await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await writeFile(path.join(out,'failure.txt'),await page.locator('body').innerText()).catch(()=>{});}throw error;}
finally{await app?.close();await rm(temp,{recursive:true,force:true});}
