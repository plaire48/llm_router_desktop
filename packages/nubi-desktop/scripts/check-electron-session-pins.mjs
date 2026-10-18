import {desktopTestWindow} from './electron-test-window.mjs';
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {ProjectService} from '../runtime/project-service.mjs';

const require=createRequire(import.meta.url),temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-session-pins-'));
const root=path.join(temporary,'project-a'),other=path.join(temporary,'project-b'),storage=path.join(temporary,'state'),output=path.resolve('verification/session-pins-2026-10-17');
for(const folder of [root,other]){await mkdir(path.join(folder,'openwiki'),{recursive:true});await writeFile(path.join(folder,'openwiki/home.md'),'# Local wiki\n');}
await mkdir(output,{recursive:true});const service=new ProjectService({storageRoot:storage}),initial=await service.open(root,{initializeWiki:false});
const titles=['오늘 대화','어제 대화','이전 대화',...Array.from({length:7},(_,i)=>`일반 대화 ${i+1}`)],tasks=[];
for(const [i,title]of titles.entries()){
 const task=await service.createTask({request:title}),days=i===0?0:i===1?1:i===2?10:i-1;
 const date=new Date(Date.now()-days*86400000).toISOString();service.store.set('task:'+task.id,{...task,state:'completed',createdAt:date,updatedAt:date});tasks.push(task);
}
const second=await service.open(other,{initializeWiki:false});await service.createTask({request:'다른 프로젝트 대화'});
service.dispose();service.store.close();await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
const {ProjectCatalog}=require('../electron-app/project-catalog.cjs'),catalog=new ProjectCatalog(storage);await catalog.remember(initial);await catalog.remember(second);
let app,page;const errors=[];
async function launch(){
 app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,OPENWIKI_CONFIG_DIR:path.join(temporary,'personal'),ELECTRON_RUN_AS_NODE:undefined}});
 page=await desktopTestWindow(app);page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
 await page.locator('.desktop-shell[data-startup-ready=true]').waitFor({timeout:60000});await page.emulateMedia({reducedMotion:'reduce'});
 await page.locator('.nubi-sidebar-project').first().waitFor();
 if(await page.getByRole('dialog').count())await page.keyboard.press('Escape');
 if(await page.locator('.nubi-sidebar').getAttribute('data-open')!=='true')await page.getByRole('button',{name:'사이드바 펼치기',exact:true}).click();
 await page.locator('.nubi-session-row').first().waitFor();
}
const history=()=>page.getByRole('navigation',{name:'대화 목록',exact:true});
const row=title=>history().locator('.nubi-session-row').filter({has:page.getByRole('button',{name:title,exact:true})});
async function pin(title,enabled=true){
 const trigger=row(title).locator('summary');await trigger.scrollIntoViewIfNeeded();await trigger.focus();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await trigger.click();await page.getByRole('button',{name:title+(enabled?' 고정':' 고정 해제'),exact:true}).click();
 await page.waitForFunction(({title,enabled})=>[...document.querySelectorAll('.nubi-session-row')].find(row=>row.querySelector('.nubi-session-title')?.textContent===title)?.dataset.pinned===String(enabled),{title,enabled});
 assert(await row(title).locator('summary').evaluate(node=>node===document.activeElement),'the moved conversation keeps keyboard focus on its menu');
}
async function order(expected){
 const sections=history().locator(':scope > section');assert.equal(await sections.first().getAttribute('aria-label'),'고정 대화');
 assert.deepEqual(await sections.first().locator('.nubi-session-title').allTextContents(),expected);
 assert.equal(await history().locator('.nubi-session-row').count(),new Set(await history().locator('.nubi-session-title').allTextContents()).size,'each conversation appears once');
 assert.equal(await history().locator(':popover-open').count(),0,'pinning closes the action tray');
}
try{
 await launch();
 if(!process.argv.includes('--order-only')){
  await page.mouse.move(0,0);
  const shade=await row(titles[0]).locator('summary').evaluate(node=>({background:getComputedStyle(node).backgroundColor,ink:getComputedStyle(node).color,radius:getComputedStyle(node).borderRadius}));
  assert.notEqual(shade.background,'rgba(0, 0, 0, 0)','the conversation more button has a persistent shaded surface');
 }
 await history().getByRole('button',{name:/대화 \d+개 더보기/}).click();
 await pin(titles[2]);await order([titles[2]]);
 await pin(titles[1]);await order([titles[1],titles[2]]);
 await pin(titles[0]);await order([titles[0],titles[1],titles[2]]);
 await pin(titles[1],false);await order([titles[0],titles[2]]);
 assert.notEqual(await row(titles[1]).locator('xpath=..').getAttribute('aria-label'),'고정 대화');
 await pin(titles[1]);await order([titles[1],titles[0],titles[2]]);
 await history().getByRole('button',{name:'접기',exact:true}).click();await order([titles[1],titles[0],titles[2]]);
 assert.equal(await history().locator('.nubi-session-row').count(),8,'all three pins remain above the five recent unpinned conversations');
 await page.reload();await page.locator('.desktop-shell[data-startup-ready=true]').waitFor({timeout:60000});await history().getByRole('heading',{name:'고정',exact:true}).waitFor();await order([titles[1],titles[0],titles[2]]);
 const saved=await page.evaluate(projectId=>localStorage.getItem(`nubi-pinned-tasks:${projectId}`),initial.projectId);assert.equal(saved,null,'confirmed pin migration removes the renderer copy');const host=await page.evaluate(()=>window.nubi.request('state',{}));assert.deepEqual(host.conversationNavigation.pinnedIds,[tasks[1].id,tasks[0].id,tasks[2].id]);
 await page.getByRole('button',{name:'project-b 대화 펼치기',exact:true}).click();await page.getByRole('button',{name:'다른 프로젝트 대화',exact:true}).waitFor();assert.equal(await history().getByRole('heading',{name:'고정',exact:true}).count(),0);
 await page.getByRole('button',{name:'project-a 대화 펼치기',exact:true}).click();await history().getByRole('heading',{name:'고정',exact:true}).waitFor();await order([titles[1],titles[0],titles[2]]);
 await app.close();app=null;await launch();await history().getByRole('heading',{name:'고정',exact:true}).waitFor();await order([titles[1],titles[0],titles[2]]);
 for(const width of [1280,440]){
  await page.setViewportSize({width,height:900});await page.evaluate(size=>document.documentElement.style.fontSize=size,width===440?'20px':'16px');
  if(await page.locator('.nubi-sidebar').getAttribute('data-open')!=='true')await page.getByRole('button',{name:/사이드바.*(펼치기|열기)/}).click();
  await row(titles[1]).locator('summary').focus();await page.keyboard.press('Enter');
  const tray=page.getByRole('group',{name:titles[1]+' 관리',exact:true});await tray.waitFor();
  assert(await tray.evaluate(node=>{const r=node.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1;}));
  const buttons=await tray.getByRole('button').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().y));assert(Math.abs(buttons[0]-buttons[1])<1);
  await page.keyboard.press('ArrowRight');assert(await tray.evaluate(node=>node.contains(document.activeElement)));
  await page.keyboard.press('Escape');assert(await row(titles[1]).locator('summary').evaluate(node=>node===document.activeElement));
  await page.screenshot({path:path.join(output,`sidebar-${width}.png`),animations:'disabled'});
 }
 assert.deepEqual(errors,[]);await writeFile(path.join(output,'checks.json'),JSON.stringify({passed:true,scope:'Built macOS Electron with isolated project/task fixtures, no model or external account.',checks:[...(!process.argv.includes('--order-only')?['shaded more button']:[]),'pinned section before dates','most recently pinned first','unpin and re-pin','all pins stay visible when recent history collapses','reload and restart persistence','project isolation','menu keyboard and viewport containment at 1280/440 with enlarged text'],errors},null,2));
 console.log(process.argv.includes('--order-only')?'Built Electron conversation pin order, host persistence and focus passed.':'Built Electron conversation pins and shaded action button passed.');
}catch(error){await page?.screenshot({path:path.join(output,'failure.png'),timeout:5000}).catch(()=>{});throw error;}
finally{await app?.close();await rm(temporary,{recursive:true,force:true});}
