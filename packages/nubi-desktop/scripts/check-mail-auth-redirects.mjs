// Isolated Electron fixture: actual POST popup -> opener -> read-only portal session.
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const upgrade=process.argv.includes('--upgrade'),home=process.argv.includes('--home');
const require=createRequire(import.meta.url),temporary=await mkdtemp(path.join(os.tmpdir(),'nubi-portal-login-')),entry=path.join(temporary,'main.cjs');
await writeFile(entry,`
const {app,BrowserWindow,session}=require('electron');
app.setPath('userData',${JSON.stringify(path.join(temporary,'state'))});
process.env.NUBI_MAIL_PORTAL_ORIGIN=${JSON.stringify((upgrade?'http:':'https:')+'//mail.example.invalid')};
process.env.NUBI_MAIL_PORTAL_LOGIN_URL='https://home.example.invalid';
app.whenReady().then(async()=>{
 const {BrowserHost}=require(${JSON.stringify(path.resolve('electron-app/browser-host.cjs'))});
 const {MailPortal}=require(${JSON.stringify(path.resolve('electron-app/mail-portal.cjs'))});
 const win=new BrowserWindow({show:true,width:1100,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadURL('about:blank');
 global.events=[];global.loadFailures=[];let authenticated=false;
 const portalSession=session.fromPartition('persist:nubi-company');
 const handle=async request=>{
  const url=new URL(request.url);global.events.push({host:url.hostname,path:url.pathname,method:request.method,protocol:url.protocol});
  if(url.protocol==='http:')return new Response(null,{status:302,headers:{location:'https://mail.example.invalid'+url.pathname+url.search}});
  if(url.hostname==='home.example.invalid'&&url.pathname==='/')return new Response(null,{status:302,headers:{location:'https://home.example.invalid/start'}});
  if(url.hostname==='sso.example.invalid'&&['/authenticate','/relay','/verify'].includes(url.pathname)){
   const body=await request.text();if(request.method!=='POST'||body!=='proof=fixture')return new Response('POST lost',{status:400});
   const target=url.pathname==='/authenticate'?'/relay':url.pathname==='/relay'?'/verify':'/finish';
   return new Response(null,{status:url.pathname==='/authenticate'?307:url.pathname==='/relay'?308:303,headers:{location:'https://sso.example.invalid'+target}});
  }
  if(url.hostname==='sso.example.invalid'&&url.pathname==='/finish'){
   if(request.method!=='GET')return new Response('Wrong callback method',{status:400});
   authenticated=true;return new Response('<script>window.opener.location="${home?'https://home.example.invalid/ready':'https://mail.example.invalid/portal'}";window.close();</script>',{headers:{'content-type':'text/html'}});
  }
  if(!['https://mail.example.invalid','https://home.example.invalid'].includes(url.origin))return new Response('',{status:403});
  if(url.pathname.startsWith('/mail/rest/')){
   if(!authenticated)return new Response('',{status:401});
   const value=url.pathname.endsWith('/userinfo/read')?{userId:'fixture-user',email:'owner@example.test'}:[{folderID:1,folderName:'받은메일함',mailCount:0}];
   return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
  }
  return new Response(authenticated?'<h1>Portal ready</h1>':'<form action="https://sso.example.invalid/authenticate" method="post" target="_blank" rel="opener"><input name="proof" value="fixture"><button id="login">Fixture login</button></form>',{headers:{'content-type':'text/html'}});
 };
 await portalSession.protocol.handle('http',handle);await portalSession.protocol.handle('https',handle);
 if(!await portalSession.protocol.isProtocolHandled('https'))throw Error('fixture_protocol_unavailable');
 global.host=new BrowserHost(win);
 global.other=global.host.create('about:blank').id;
 global.portal=new MailPortal({BrowserWindow,parent:win,invoke:async(_method,args)=>{global.events.push({action:args.action});return {};},
  openPage:(url,options)=>{const row=global.host.create(url,{...options,session:portalSession,authentication:true,httpsOnly:${!upgrade}});global.loginId=row.id;if(row.view.webContents.session!==portalSession)throw Error('fixture_session_mismatch');row.view.webContents.on('did-fail-load',(_event,code,description,_url,isMain)=>{if(isMain)global.loadFailures.push({code,description});});void global.host.request({action:'layout',bounds:{x:80,y:100,width:900,height:600},visible:true});return {tabId:row.id};},
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
 if(!upgrade){const denied=await app.evaluate(async()=>{try{await global.host.request({action:'navigate',id:global.loginId,url:'http://example.invalid'});return false;}catch(error){return error.message==='browser_url_invalid';}});assert.equal(denied,true);}
 await app.evaluate(async()=>global.host.tab(global.loginId).view.webContents.executeJavaScript('document.querySelector("#login").click()',true));
 await until(async()=>app.evaluate(()=>!!global.result));
 const result=await app.evaluate(({BrowserWindow})=>({result:global.result,events:global.events,status:global.portal.status(),tabs:[...global.host.tabs.keys()],other:global.other,windows:BrowserWindow.getAllWindows().length}));
 assert.deepEqual(result.result,{ok:true});assert.equal(result.status.connected,true);assert.deepEqual(result.tabs,[result.other],'only owned authentication tabs close');assert.equal(result.windows,2,'SSO does not create another native popup window');
 const requests=result.events.filter(e=>e.host==='sso.example.invalid');assert.deepEqual(requests.map(({path,method})=>({path,method})),[{path:'/authenticate',method:'POST'},{path:'/relay',method:'POST'},{path:'/verify',method:'POST'},{path:'/finish',method:'GET'}]);
 assert.ok(result.events.some(e=>e.host==='home.example.invalid'),'login begins at the configured home');
 assert.ok(result.events.some(e=>e.host==='mail.example.invalid'&&e.path.endsWith('/folders')),'the background reader verifies the mail API');
 if(home)assert(!result.events.some(e=>e.host==='mail.example.invalid'&&e.method==='GET'),'login on home requires no mailbox navigation');
 console.log(JSON.stringify({passed:true,upgrade,home,checks:['302 home redirect, POST 307 and 308, then 303 GET callback preserved','POST popup and opener preserved','same persistent session','verified background mail reader','no separate login popup','owned tab cleanup','automatic home authentication without manual continuation'],boundary:'Local Electron with isolated mock HTTPS protocol; not company SSO or Windows verification.'}));
}catch(error){if(app)console.error(JSON.stringify(await app.evaluate(()=>({result:global.result,events:global.events,loadFailures:global.loadFailures,state:global.portal?.status(),tabs:global.host?.status()}))));throw error;}finally{await app?.close();await rm(temporary,{recursive:true,force:true});}
async function until(check){for(let i=0;i<150;i++){try{if(await check())return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('portal fixture timed out');}
