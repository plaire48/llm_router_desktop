import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {ProjectService} from '../runtime/project-service.mjs';
import {desktopTestWindow} from './electron-test-window.mjs';
const require=createRequire(import.meta.url),temporary=await realpath(await mkdtemp(path.join(os.tmpdir(),'nubi-wiki-notice-'))),storage=path.join(temporary,'state'),root=path.join(temporary,'project');
await mkdir(path.join(root,'openwiki'),{recursive:true});await writeFile(path.join(root,'openwiki/home.md'),'# Project guide\n\nWiki notification fixture.\n');
const service=new ProjectService({storageRoot:storage}),overview=await service.open(root,{initializeWiki:false});service.dispose();service.store.close();
await writeFile(path.join(storage,'last-project.json'),JSON.stringify({root}));
let app;
try{
 app=await electron.launch({executablePath:require('electron'),args:['electron-app'],env:{...process.env,NUBI_STORAGE_ROOT:storage,OPENWIKI_CONFIG_DIR:path.join(temporary,'openwiki-config'),ELECTRON_RUN_AS_NODE:undefined}});
 const page=await desktopTestWindow(app);page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.locator('.desktop-shell[data-startup-ready="true"]').waitFor({timeout:60000});await page.locator('.nubi-sidebar-project').first().waitFor();
 // Simulate only the trusted native notification click, not SSO or a real Windows toast.
 const send=phase=>app.evaluate(({BrowserWindow},event)=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('app://bundle'))?.webContents.send('nubi:host-event',event),{type:'wiki_open',projectId:overview.projectId,jobId:'fixture-wiki-job',phase});
 await send('created');await page.locator('.nubi-wiki-browser').waitFor();
 await send('ready');await page.locator('.nubi-library').waitFor();
 assert.deepEqual(errors,[]);console.log('Passed: saved Wiki notification opens Wiki browser; ready notification opens existing update review; no renderer errors. Windows toast rendering is not verified.');
}finally{await app?.close();await rm(temporary,{recursive:true,force:true});}
