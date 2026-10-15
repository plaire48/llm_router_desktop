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
 const isolated=session.fromPartition('persist:nubi-company');let authenticated=false,submissions=0,visible=false,loginPath='login';const diagnostics=[];
 await isolated.protocol.handle('https',async request=>{
  const url=new URL(request.url);diagnostics.push({event:'fixture-request',path:url.pathname});const html=body=>new Response(body,{headers:{'content-type':'text/html'}});
  if(url.href==='https://kor3.samsung.net/portalapp/home')return authenticated?html('<h1>Fixture portal home</h1>'):Response.redirect('https://samsung.net/loginapp/'+loginPath);
  if(url.href==='https://samsung.net/loginapp/'+loginPath)return html('<form method="post" action="/authenticate" target="_blank" rel="opener"><input name="username"><input type="password" name="password"><button type="submit">Login</button></form>');
  if(url.href==='https://samsung.net/authenticate'){
   submissions++;const body=await request.text();if(request.method!=='POST'||body!=='username=fixture&password=fixture-password')return new Response('',{status:400});
   authenticated=true;return html('<script>window.opener.location="https://kor3.samsung.net/portalapp/home";window.close();</script>');
  }
  if(url.origin==='https://kor3.samsung.net'&&url.pathname.startsWith('/mail/rest/'))return authenticated?new Response(JSON.stringify(url.pathname.endsWith('/userinfo/read')?{userId:'fixture',email:'fixture@example.test'}:[{folderID:1,folderName:'받은메일함',mailCount:0}]),{headers:{'content-type':'application/json'}}):new Response('',{status:401});
  return new Response('',{status:404});
 });
 app.on('browser-window-created',(_e,w)=>{w.on('show',()=>visible=true);w.webContents.on('did-fail-load',(_event,code,_description,_url,isMainFrame)=>diagnostics.push({event:'load-failed',code,isMainFrame}));const load=w.loadURL.bind(w);w.loadURL=async(...args)=>{try{return await load(...args);}catch(error){diagnostics.push({event:'load-rejected',code:error.code,errno:error.errno});throw error;}};});
 const {MailPortal}=require(${JSON.stringify(path.resolve('electron-app/mail-portal.cjs'))});
 const actions=[],results=[];
 const portal=new MailPortal({BrowserWindow,invoke:async(_method,args)=>{actions.push(args.action);if('password' in args||'username' in args)throw Error('credential_leak');return {};}});portal.sync=async()=>{};
 try{
  for(const route of ['login','abnormal-logout','logout']){
   authenticated=false;loginPath=route;const credentials={username:'fixture',password:'fixture-password'};
   await portal.connect({credentials});
   results.push({route,connected:portal.status().connected,cleared:credentials.username===''&&credentials.password===''});
   await portal.disconnect();
  }
  for(const url of ['https://samsung.net','https://samsung.com','https://code.sdsdev.co.kr'])await isolated.cookies.set({url,name:'synthetic',value:'fixture',secure:true});
  await portal.clearPortalSession();const cookies=await isolated.cookies.get({name:'synthetic'});portal.dispose();
  global.result={results,submissions,visible,connections:actions.filter(action=>action==='portalConnect').length,remainingDomains:cookies.map(c=>c.domain)};
 }catch(error){portal.dispose();global.result={error:error.message,submissions,visible,diagnostics};}
});app.on('window-all-closed',()=>{});`);
let app;
try{
 app=await electron.launch({executablePath:require('electron'),args:[entry],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});
 let result;for(let i=0;i<300;i++){result=await app.evaluate(()=>global.result);if(result)break;await new Promise(r=>setTimeout(r,100));}
 assert.deepEqual(result,{results:['login','abnormal-logout','logout'].map(route=>({route,connected:true,cleared:true})),submissions:3,visible:false,connections:3,remainingDomains:['code.sdsdev.co.kr']});
 await mkdir('verification/mail-session-recovery-2026-10-15',{recursive:true});await writeFile('verification/mail-session-recovery-2026-10-15/electron-sso.json',JSON.stringify({passed:true,result,boundary:'Actual Electron native popup POST/opener. HTTPS intercepted in an isolated synthetic session. No company network, real credentials or Windows OS toast.'},null,2));console.log(JSON.stringify(result));
}finally{await app?.close();await rm(temp,{recursive:true,force:true});}
