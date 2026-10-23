import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {ReadTaskPool} from '../runtime/read-task-pool.mjs';
import {desktopTestWindow} from './electron-test-window.mjs';
const temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-isolated-read-')),root=path.join(temporary,'project'),storage=path.join(temporary,'state'),out=path.resolve('verification/read-task-isolation/electron');
await mkdir(path.join(root,'openwiki'),{recursive:true});await mkdir(storage);await mkdir(out,{recursive:true});
const source="export function library(value:number){return value+1;}\n";
await writeFile(path.join(root,'library.ts'),source);await writeFile(path.join(root,'openwiki/home.md'),'# 읽기 작업 검증\n\n합성 자료입니다.');await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
const app=await electron.launch({executablePath:createRequire(import.meta.url)('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,ELECTRON_RUN_AS_NODE:undefined}}),checks=[],errors=[];let page;
const pool=new ReadTaskPool({workerFile:path.resolve('electron-app/lib/backend/read-task-worker.mjs')});
try{
 page=await desktopTestWindow(app);page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));await page.locator('.desktop-shell[data-startup-ready=true]').waitFor({timeout:60000});await page.waitForFunction(()=>!document.querySelector('.nubi-intro')&&!document.querySelector('.desktop-shell')?.inert,null,{timeout:60000});await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'위키',exact:true}).click();const search=page.getByRole('searchbox',{name:'위키 문서 검색',exact:true});await search.waitFor();
 await page.evaluate(()=>{window.isolationProbe=Promise.all(Array.from({length:8},()=>window.nubi.request('codeOutline',{path:'library.ts'})));return true;});await search.fill('검증');
 const rows=await page.evaluate(()=>window.isolationProbe);assert(rows.every(row=>row.symbols?.some(symbol=>symbol.name==='library')&&row.hash?.startsWith('sha256:')));assert.equal(await search.inputValue(),'검증');assert.equal(await readFile(path.join(root,'library.ts'),'utf8'),source);checks.push('built Electron service routes repeated real outlines through the reusable compute process while Wiki input is preserved');
 const map=await pool.run('repository','code-map',{root,files:['library.ts'],projection:'navigation'});assert.equal(map.files['library.ts'].definitions[0].name,'library');assert.equal(map.summary.files,1);assert.equal(map.graph,undefined);checks.push('shipped repository worker returns the bounded navigation projection without changing source');
 const before=pool.snapshot().repository.pid;await pool.run('repository','code-map',{root,files:['library.ts'],projection:'navigation'});assert.equal(pool.snapshot().repository.pid,before);checks.push('shipped worker is reused across requests and its reply survives bundle boundaries');
 await page.screenshot({path:out+'/wiki-during-analysis.png'});assert.deepEqual(errors,[]);await writeFile(out+'/result.json',JSON.stringify({checks,errors,boundary:'Built macOS Electron service and parser process; real local temporary source/Wiki; no model, company login, Windows installer or distributed-machine claim.'},null,2));console.log(JSON.stringify({passed:checks.length,errors}));
}catch(error){await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});await writeFile(out+'/failure.txt',String(error.stack)+'\n'+JSON.stringify(errors));throw error;}
finally{await pool.close();await app.close();await rm(temporary,{recursive:true,force:true});}
