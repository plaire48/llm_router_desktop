// Actual loopback HTTP cookies and Electron redirects, isolated from all user sessions.
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),temp=await mkdtemp(path.join(os.tmpdir(),'nubi-mail-cookie-')),events=[];
let mailOrigin,loginOrigin;
const html={'content-type':'text/html; charset=utf-8'};
const mail=createServer((req,res)=>{
 const route=new URL(req.url,'http://fixture').pathname,authenticated=req.headers.cookie?.includes('nubi_fixture=verified')===true;
 events.push({server:'mail',route,method:req.method,authenticated});
 if(route==='/finish'){res.writeHead(200,{...html,'set-cookie':'nubi_fixture=verified; HttpOnly; SameSite=Lax; Path=/; Max-Age=120'}).end(`<script>window.opener.location=${JSON.stringify(mailOrigin+'/portalapp/home')};window.close();</script>`);return;}
 if(route.startsWith('/mail/rest/')){if(!authenticated){res.writeHead(302,{location:loginOrigin+'/sso'}).end();return;}res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(route.endsWith('/userinfo/read')?{userId:'fixture',email:'fixture@example.test'}:[{folderID:1,folderName:'받은메일함',mailCount:0}]));return;}
 if(!authenticated){res.writeHead(302,{location:loginOrigin}).end();return;}
 res.writeHead(200,html).end('<h1>Fixture mailbox</h1>');
});
const login=createServer(async(req,res)=>{
 const route=new URL(req.url,'http://fixture').pathname;events.push({server:'login',route,method:req.method});
 if(route==='/authenticate'||route==='/relay'){
  let body='';for await(const chunk of req)body+=chunk;if(req.method!=='POST'||body!=='proof=fixture'){res.writeHead(400).end();return;}
  res.writeHead(route==='/authenticate'?307:303,{location:route==='/authenticate'?loginOrigin+'/relay':mailOrigin+'/finish'}).end();return;
 }
 res.writeHead(200,html).end(`<form method="post" target="_blank" rel="opener" action="${loginOrigin}/authenticate"><input type="hidden" name="proof" value="fixture"><button id="login">Fixture login</button></form>`);
});
await Promise.all([new Promise(r=>mail.listen(0,'127.0.0.1',r)),new Promise(r=>login.listen(0,'127.0.0.1',r))]);
mailOrigin='http://127.0.0.1:'+mail.address().port;loginOrigin='http://127.0.0.1:'+login.address().port;
const entry=path.join(temp,'main.cjs');await writeFile(entry,`
const {app,BrowserWindow,session}=require('electron');app.setPath('userData',${JSON.stringify(path.join(temp,'state'))});
process.env.NUBI_MAIL_PORTAL_ORIGIN=${JSON.stringify(mailOrigin)};process.env.NUBI_MAIL_PORTAL_LOGIN_URL=${JSON.stringify(mailOrigin+'/portalapp/home')};
app.whenReady().then(async()=>{
 const {BrowserHost}=require(${JSON.stringify(path.resolve('electron-app/browser-host.cjs'))});const {MailPortal}=require(${JSON.stringify(path.resolve('electron-app/mail-portal.cjs'))});
 const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadURL('about:blank');
 global.host=new BrowserHost(win);global.portal=new MailPortal({BrowserWindow,parent:win,invoke:async()=>({}),openPage:(url,options)=>{const row=global.host.create(url,{...options,authentication:true,session:session.fromPartition('persist:nubi-company')});global.loginId=row.id;return {tabId:row.id};},getPageContents:id=>[...global.host.tabs.values()].filter(row=>row.ownerId===id).map(row=>row.view.webContents),closePage:id=>{for(const row of [...global.host.tabs.values()].reverse())if(row.ownerId===id)global.host.closeTab(row.id);}});
 global.portal.sync=async()=>{};
 const pending=process.argv.includes('--restore')?global.portal.restore():global.portal.connect();
 Promise.resolve(pending).then(()=>global.result={connected:global.portal.status().connected},error=>global.result={error:error.message});
});`);
let app;const launch=restore=>electron.launch({executablePath:require('electron'),args:[entry,...(restore?['--restore']:[])],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});
try{
 app=await launch(false);await app.firstWindow();await until(()=>app.evaluate(async()=>!!global.loginId&&await global.host.tab(global.loginId).view.webContents.executeJavaScript('!!document.querySelector("#login")')));
 await new Promise(r=>setTimeout(r,2300));assert(events.filter(e=>e.server==='mail').every(e=>e.route.startsWith('/mail/rest/')||e.route==='/portalapp/home'),'only portal home and fixed API probes before login');assert.equal(events.filter(e=>e.server==='login').length,1,'API login redirects are not followed');
 await app.evaluate(()=>global.host.tab(global.loginId).view.webContents.executeJavaScript('document.querySelector("#login").click()',true));
 await until(()=>app.evaluate(()=>!!global.result));assert.deepEqual(await app.evaluate(()=>global.result),{connected:true});
 assert(events.some(e=>e.route.startsWith('/mail/rest/')&&e.authenticated),'the shared session sends the cookie after login');
 assert(events.filter(e=>e.route.endsWith('/folders')).length>=2,'identity and background verification use the cookie without opening mail');
 assert(!events.some(e=>e.server==='mail'&&e.route==='/portal'),'no manual or automatic mailbox page navigation required');
 const isolated=await app.evaluate(async({BrowserWindow},origin)=>{
  const other=new BrowserWindow({show:false,webPreferences:{partition:'isolated-fixture',sandbox:true,contextIsolation:true,nodeIntegration:false}});
  try{await other.loadURL(origin+'/portal');return await other.webContents.executeJavaScript('location.port');}finally{other.destroy();}
 },mailOrigin);assert.equal(isolated,new URL(loginOrigin).port,'an unrelated partition is redirected back to login');
 await app.evaluate(async({session})=>session.fromPartition('persist:nubi-company').cookies.flushStore());
 await app.close();app=null;const count=events.filter(e=>e.server==='login').length;
 app=await launch(true);await app.firstWindow();await until(()=>app.evaluate(()=>!!global.result));assert.deepEqual(await app.evaluate(()=>global.result),{connected:true});
 assert.equal(events.filter(e=>e.server==='login').length,count,'restart restores a valid persistent cookie without SSO');
 assert.equal(await app.evaluate(()=>global.host.tabs.size),0);
 await app.evaluate(()=>global.portal.connect());assert.equal(await app.evaluate(()=>global.portal.status().connected),true);assert.equal(events.filter(e=>e.server==='login').length,count,'already signed in home connects without entering credentials again');
 const result={passed:true,checks:['actual HttpOnly cookie after popup POST/307/303','unauthenticated API redirects never followed','automatic API authentication while home stays open','no mailbox-page navigation required','isolated partition cannot reuse authentication','app restart restores persistent cookie without login tab','already authenticated home connects without another login'],boundary:'Loopback synthetic cookie only. Not company cookie policy or Windows SSO.'};
 await mkdir('verification/mail-auth-fix-2026-10-14',{recursive:true});await writeFile('verification/mail-auth-fix-2026-10-14/cookie-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await app?.close();await Promise.all([new Promise(r=>mail.close(r)),new Promise(r=>login.close(r))]);await rm(temp,{recursive:true,force:true});}
async function until(check){for(let i=0;i<180;i++){try{if(await check())return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('cookie fixture timed out');}
