import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-browser-popup-'));
const requests=[];const server=createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;requests.push({path:req.url,method:req.method,body});res.setHeader('Content-Type','text/html; charset=utf-8');if(req.url==='/post')return res.end('<h1>'+req.method+':'+body+'</h1>');res.end(`<h1>Local browser check</h1><button id="write" onclick="const w=window.open('about:blank');window.popupPresent=!!w;if(w){w.document.write('<h1>Child content</h1>');w.document.close();}">Write popup</button><form action="/post" method="post" target="_blank"><input name="selection" value="fixture"><button id="post">Post popup</button></form>`);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port,entry=path.join(temporary,'main.cjs');
await writeFile(entry,`const {app,BrowserWindow,session}=require('electron');app.setPath('userData',${JSON.stringify(path.join(temporary,'data'))});app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:1100,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadURL('about:blank');const {BrowserHost}=require(${JSON.stringify(path.resolve('electron-app/browser-host.cjs'))});global.browserHost=new BrowserHost(win);global.portalSession=session.fromPartition('persist:portal-fixture');global.browserHost.create(${JSON.stringify(origin)},{session:global.portalSession,authentication:true});await global.browserHost.request({action:'layout',bounds:{x:80,y:100,width:900,height:600},visible:true});});`);
let app;
try{app=await electron.launch({executablePath:require('electron'),args:[entry],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});await app.firstWindow();
 for(let i=0;i<60;i++){if(await app.evaluate(()=>!!global.browserHost?.active))break;await new Promise(r=>setTimeout(r,100));}
 await new Promise(r=>setTimeout(r,400));
 const opener=await app.evaluate(()=>global.browserHost.active);
 await app.evaluate(async()=>global.browserHost.tab().view.webContents.executeJavaScript("document.querySelector('#write').click()",true));await new Promise(r=>setTimeout(r,300));
 const popup=await app.evaluate(async({},{opener})=>{const host=global.browserHost;return {present:await host.tab(opener).view.webContents.executeJavaScript('window.popupPresent'),text:await host.tab().view.webContents.executeJavaScript('document.body.innerText'),visible:host.tab().view.getVisible?.(),status:host.status().tabs.find(t=>t.id===host.active)};},{opener});
 await app.evaluate(async({},{opener})=>{const host=global.browserHost;await host.request({action:'select',id:opener});await host.tab().view.webContents.executeJavaScript("document.querySelector('#post').click()",true);},{opener});await new Promise(r=>setTimeout(r,500));
 const security=await app.evaluate(()=>{const prefs=global.browserHost.tab().view.webContents.getLastWebPreferences();return {sandbox:prefs.sandbox,contextIsolation:prefs.contextIsolation,nodeIntegration:prefs.nodeIntegration,webSecurity:prefs.webSecurity};});
 const ownership=await app.evaluate(({},{opener})=>{const host=global.browserHost;return {group:[...host.tabs.values()].every(row=>row.ownerId===opener),session:[...host.tabs.values()].every(row=>row.view.webContents.session===global.portalSession),authentication:[...host.tabs.values()].every(row=>row.authentication)};},{opener});assert.deepEqual(ownership,{group:true,session:true,authentication:true});
 const post=requests.filter(x=>x.path==='/post');console.log(JSON.stringify({popup,post}));
 if(!process.argv.includes('--baseline')){assert.deepEqual(security,{sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true});assert.equal(popup.present,true);assert.equal(popup.text,'Child content');assert.equal(popup.visible,true);assert.equal(popup.status.contentReady,true);assert.equal(post.at(-1)?.method,'POST');assert.equal(post.at(-1)?.body,'selection=fixture');
 const failure=await app.evaluate(async()=>{const host=global.browserHost,row=host.tab();row.view.webContents.emit('did-fail-load',{},-105,'private message','https://private.invalid/?token=secret',true);return {status:host.status().tabs.find(t=>t.id===row.id),visible:row.view.getVisible()};});assert.equal(failure.status.error,'browser_dns_failed');assert.equal(failure.visible,false);assert(!JSON.stringify(failure.status).includes('secret'));
 const recovered=await app.evaluate(async()=>{const host=global.browserHost,row=host.tab();row.view.webContents.emit('did-start-loading');return {error:row.error,visible:row.view.getVisible()};});assert.equal(recovered.error,null);assert.equal(recovered.visible,true);
 console.log('Electron browser: opener, written blank popup, POST, hidden failure view and reload recovery passed.');}
}finally{await app?.close();await new Promise(r=>server.close(r));await rm(temporary,{recursive:true,force:true});}
