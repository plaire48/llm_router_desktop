// Actual Electron hidden forms and native POST popup; all HTTP(S) is intercepted in an isolated session.
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),temp=await mkdtemp(path.join(os.tmpdir(),'nubi-inline-sso-')),entry=path.join(temp,'main.cjs');
await writeFile(entry,`
const {app,session,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(temp,'state'))});
process.env.NUBI_MAIL_PORTAL_ORIGIN='https://kor3.samsung.net';process.env.NUBI_MAIL_PORTAL_LOGIN_URL='https://kor3.samsung.net/portalapp/home';
app.whenReady().then(async()=>{
 const isolated=session.fromPartition('inline-fixture');let authenticated=false,submissions=0,visible=false;
 await isolated.protocol.handle('https',async request=>{
  const url=new URL(request.url);const html=body=>new Response(body,{headers:{'content-type':'text/html'}});
  if(url.href==='https://kor3.samsung.net/portalapp/home')return authenticated?html('<h1>Fixture portal home</h1>'):Response.redirect('https://samsung.net/loginapp/login');
  if(url.href==='https://samsung.net/loginapp/login')return html('<form method="post" action="/authenticate" target="_blank" rel="opener"><input name="username"><input type="password" name="password"><button type="submit">Login</button></form>');
  if(url.href==='https://samsung.net/authenticate'){
   submissions++;const body=await request.text();if(request.method!=='POST'||body!=='username=fixture&password=fixture-password')return new Response('',{status:400});
   authenticated=true;return html('<script>window.opener.location="https://kor3.samsung.net/portalapp/home";window.close();</script>');
  }
  return new Response('',{status:404});
 });
 app.on('browser-window-created',(_e,w)=>{w.on('show',()=>visible=true);});
 const {MailCredentialLogin}=require(${JSON.stringify(path.resolve('electron-app/mail-credential-login.cjs'))});
 const credentials={username:'fixture',password:'fixture-password'};
 const login=new MailCredentialLogin({BrowserWindow,session:isolated,signal:new AbortController().signal});
 try{await login.run(credentials);const {MailPortal}=require(${JSON.stringify(path.resolve('electron-app/mail-portal.cjs'))});
 const portal=new MailPortal({BrowserWindow,invoke:async()=>({})});portal.window={webContents:{session:isolated}};
 for(const url of ['https://samsung.net','https://samsung.com','https://code.sdsdev.co.kr'])await isolated.cookies.set({url,name:'synthetic',value:'fixture',secure:true});
 await portal.clearPortalSession();const cookies=await isolated.cookies.get({name:'synthetic'});
 global.result={authenticated,submissions,visible,cleared:credentials.username===''&&credentials.password==='',windows:BrowserWindow.getAllWindows().length,remainingDomains:cookies.map(c=>c.domain)};}
 catch(error){global.result={error:error.message,submissions,visible};}
});app.on('window-all-closed',()=>{});`);
let app;
try{
 app=await electron.launch({executablePath:require('electron'),args:[entry],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});
 let result;for(let i=0;i<300;i++){result=await app.evaluate(()=>global.result);if(result)break;await new Promise(r=>setTimeout(r,100));}
 assert.deepEqual(result,{authenticated:true,submissions:1,visible:false,cleared:true,windows:0,remainingDomains:['code.sdsdev.co.kr']});
 await mkdir('verification/mail-session-recovery-2026-10-15',{recursive:true});await writeFile('verification/mail-session-recovery-2026-10-15/electron-sso.json',JSON.stringify({passed:true,result,boundary:'Actual Electron native popup POST/opener. HTTPS intercepted in an isolated synthetic session. No company network, real credentials or Windows OS toast.'},null,2));console.log(JSON.stringify(result));
}finally{await app?.close();await rm(temp,{recursive:true,force:true});}
