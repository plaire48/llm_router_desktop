// Isolated Electron fixture: actual POST popup -> opener -> read-only portal session.
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-portal-login-')),entry=path.join(temporary,'main.cjs');
await writeFile(entry,`
const {app,BrowserWindow,session}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(temporary,'state'))});
process.env.NUBI_MAIL_PORTAL_ORIGIN='https://mail.example.invalid';
process.env.NUBI_MAIL_PORTAL_LOGIN_URL='https://home.example.invalid';
app.whenReady().then(async()=>{
 const {BrowserHost}=require(${JSON.stringify(path.resolve('electron-app/browser-host.cjs'))});
 const {MailPortal}=require(${JSON.stringify(path.resolve('electron-app/mail-portal.cjs'))});
 const win=new BrowserWindow({show:false,width:1100,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadURL('about:blank');
 global.events=[];let authenticated=false;
 const portalSession=session.fromPartition('persist:nubi-company');
 await portalSession.protocol.handle('https',async request=>{
  const url=new URL(request.url);global.events.push({host:url.hostname,path:url.pathname,method:request.method});
  if(url.hostname==='sso.example.invalid'&&url.pathname==='/authenticate'){
   const body=await request.text();if(request.method!=='POST'||body!=='proof=fixture')return new Response('Whitelabel Error Page',{status:404});
   authenticated=true;return new Response('<script>window.opener.location="https://mail.example.invalid/portal";window.close();</script>',{headers:{'content-type':'text/html'}});
  }
  if(!['https://mail.example.invalid','https://home.example.invalid'].includes(url.origin))return new Response('',{status:403});
  if(url.pathname.startsWith('/mail/rest/')){
   if(!authenticated)return new Response('',{status:401});
   const value=url.pathname.endsWith('/userinfo/read')?{userId:'fixture-user',email:'owner@example.test'}:[{folderID:1,folderName:'받은메일함',mailCount:0}];
   return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
  }
  return new Response(authenticated?'<h1>Portal ready</h1>':'<form action="https://sso.example.invalid/authenticate" method="post" target="_blank" rel="opener"><input name="proof" value="fixture"><button id="login">Fixture login</button></form>',{headers:{'content-type':'text/html'}});
 });
 global.host=new BrowserHost(win);
 global.other=global.host.create('about:blank').id;
 global.portal=new MailPortal({BrowserWindow,parent:win,invoke:async(_method,args)=>{global.events.push({action:args.action});return {};},
  openPage:(url,options)=>{const row=global.host.create(url,{...options,session:portalSession,authentication:true,httpsOnly:true});global.loginId=row.id;return {tabId:row.id};},
  getPageContents:id=>[...global.host.tabs.values()].filter(row=>row.ownerId===id).map(row=>row.view.webContents),
  closePage:id=>{for(const row of [...global.host.tabs.values()].reverse())if(row.ownerId===id)global.host.closeTab(row.id);}
 });
 global.portal.sync=async()=>{};
 global.connection=global.portal.connect().then(()=>global.result={ok:true},error=>global.result={error:error.message});
});
`);
let app;
try{
 app=await electron.launch({executablePath:require('electron'),args:[entry],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});await app.firstWindow();
 await until(async()=>app.evaluate(async()=>!!global.loginId&&await global.host.tab(global.loginId).view.webContents.executeJavaScript('!!document.querySelector("#login")')));
 const denied=await app.evaluate(async()=>{try{await global.host.request({action:'navigate',id:global.loginId,url:'http://example.invalid'});return false;}catch(error){return error.message==='browser_url_invalid';}});assert.equal(denied,true);
 await app.evaluate(async()=>global.host.tab(global.loginId).view.webContents.executeJavaScript('document.querySelector("#login").click()',true));
 await until(async()=>app.evaluate(()=>!!global.result));
 const result=await app.evaluate(({BrowserWindow})=>({result:global.result,events:global.events,status:global.portal.status(),tabs:[...global.host.tabs.keys()],other:global.other,windows:BrowserWindow.getAllWindows().length}));
 assert.deepEqual(result.result,{ok:true});assert.equal(result.status.connected,true);assert.deepEqual(result.tabs,[result.other],'only owned authentication tabs close');assert.equal(result.windows,2,'SSO does not create another native popup window');
 const requests=result.events.filter(e=>e.host==='sso.example.invalid');assert.deepEqual(requests,[{host:'sso.example.invalid',path:'/authenticate',method:'POST'}]);
 assert.ok(result.events.some(e=>e.host==='home.example.invalid'),'login begins at the configured home');
 assert.ok(result.events.some(e=>e.host==='mail.example.invalid'&&e.path.endsWith('/folders')),'the background reader verifies the mail API');
 console.log(JSON.stringify({passed:true,checks:['POST popup and opener preserved','same persistent session','verified background mail reader','no separate login popup','owned tab cleanup','HTTPS-only login navigation'],boundary:'Local Electron with isolated mock HTTPS protocol; not company SSO or Windows verification.'}));
}finally{await app?.close();await rm(temporary,{recursive:true,force:true});}
async function until(check){for(let i=0;i<150;i++){try{if(await check())return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('portal fixture timed out');}
