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
 const {mailDialogPending}=require(${JSON.stringify(path.resolve('electron-app/mail-session-dialog.cjs'))});global.dialogPending=()=>mailDialogPending(global.host.tab(global.loginId).view.webContents);
 const win=new BrowserWindow({show:true,width:1100,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadURL('about:blank');
 global.events=[];let authenticated=false;global.expire=loginPath=>{authenticated=false;global.expired=true;global.expiryPath=loginPath;};
 const portalSession=session.fromPartition('persist:nubi-company');
 await portalSession.protocol.handle('https',async request=>{
  const url=new URL(request.url);global.events.push({host:url.hostname,path:url.pathname,method:request.method});
  if(url.hostname==='sso.example.invalid'&&url.pathname==='/authenticate'){
   const body=await request.text();if(request.method!=='POST'||body!=='proof=fixture')return new Response('Whitelabel Error Page',{status:404});
   authenticated=true;global.expired=false;return new Response('<script>window.opener.location="https://mail.example.invalid/portal";window.close();</script>',{headers:{'content-type':'text/html; charset=utf-8'}});
  }
  const loginForm='<form action="https://sso.example.invalid/authenticate" method="post" target="_blank" rel="opener"><input name="proof" value="fixture"><button id="login">Fixture login</button></form>';
  if(global.expired&&['native-expired','native-confirm'].includes(global.expiryPath)&&url.origin==='https://home.example.invalid')return new Response('<script>'+ (global.expiryPath==='native-confirm'?'confirm':'alert')+'("사용자 세션이 만료되었습니다. 브라우저를 종료하고 다시 로그인해 주시기 바랍니다.");setTimeout(()=>location.href="https://www.samsung.net/loginapp/login",600);</script>',{headers:{'content-type':'text/html; charset=utf-8'}});
  if(url.origin==='https://www.samsung.net'&&url.pathname==='/loginapp/abnormal-logout')return new Response('<script>'+(global.expiryPath==='abnormal-confirm'?'confirm':'alert')+'("사용자 세션이 만료되었습니다. 브라우저를 종료하고 다시 로그인해 주시기 바랍니다.");location.href="https://www.samsung.net/loginapp/login";</script>',{headers:{'content-type':'text/html; charset=utf-8'}});
  if(url.origin==='https://www.samsung.net'&&['/loginapp/abnormal-logout','/loginapp/logout'].includes(url.pathname))return new Response('<p>브라우저를 로그인하여 다시 시도해주시기 바랍니다.</p><button id=confirm onclick="location.href=String.fromCharCode(47)+String.fromCharCode(108,111,103,105,110,97,112,112)+String.fromCharCode(47)+String.fromCharCode(108,111,103,105,110)">확인</button>',{headers:{'content-type':'text/html; charset=utf-8'}});
  if(url.origin==='https://www.samsung.net'&&url.pathname==='/loginapp/login')return new Response(loginForm,{headers:{'content-type':'text/html; charset=utf-8'}});
  if(!['https://mail.example.invalid','https://home.example.invalid'].includes(url.origin))return new Response('',{status:403});
  if(url.pathname.startsWith('/mail/rest/')||url.pathname.startsWith('/portal/user/')||url.pathname.startsWith('/approval/rest/')){
   if(!authenticated)return new Response('',{status:global.expired?403:401});
   let value;
   if(url.pathname.endsWith('/get/session/token')){if(request.method!=='GET')return new Response('',{status:405});value={data:{sessionInfo:{epUserId:83421,email:'owner@example.test',token:'fixture-token-must-not-leave-projection'}}};}
   else if(url.pathname.endsWith('/getDeskTopApList')){if(request.method!=='POST'||url.searchParams.get('epid')!=='83421'||request.headers.get('X-EpUserID')!=='83421')return new Response('',{status:400});value={data:[{apId:'fixture-approval',aplnId:'fixture-line'}],totalCount:1};}
   else if(url.pathname.endsWith('/getDeskTopApItem')){if(request.method!=='POST'||await request.text()!==JSON.stringify([{ap:'fixture-approval',ln:'fixture-line'}]))return new Response('',{status:400});value=[{subject:'Fixture approval',result:'Subject: Fixture approval\\r\\nContent-Type: text/html; charset=utf-8\\r\\n\\r\\n<p>Verified approval body</p>'}];}
   else value=url.pathname.endsWith('/userinfo/read')?{email:'owner@example.test'}:url.pathname.endsWith('/auth/policy')?{}:[{folderID:1,folderName:'받은메일함',mailCount:0}];
   return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
  }
  if(global.expired&&url.origin==='https://home.example.invalid')return new Response('<script>location.replace("https://www.samsung.net/loginapp/'+(global.expiryPath==='abnormal-confirm'?'abnormal-logout':global.expiryPath)+'")</script>',{headers:{'content-type':'text/html; charset=utf-8'}});
  return new Response(authenticated?'<h1>Portal ready</h1>':loginForm,{headers:{'content-type':'text/html; charset=utf-8'}});
 });
 global.host=new BrowserHost(win);
 global.other=global.host.create('about:blank').id;
 global.portal=new MailPortal({BrowserWindow,parent:win,invoke:async(_method,args)=>{global.events.push({action:args.action});if(args.action==='portalDocument'){const {normalizePortalMail}=await import('file:///Users/ganadi/Documents/llm_router/packages/nubi-desktop/runtime/mail-portal-content.mjs');const parsed=await normalizePortalMail(Buffer.from(args.raw,'base64'),{includePresentation:true});return {mail:{...parsed.normalized,presentation:parsed.presentation}};}return {};},
  openPage:(url,options)=>{const row=global.host.create(url,{...options,session:portalSession,authentication:true,httpsOnly:true});global.loginId=row.id;void global.host.request({action:'layout',bounds:{x:80,y:100,width:900,height:600},visible:true});return {tabId:row.id};},
  getPageContents:id=>[...global.host.tabs.values()].filter(row=>row.ownerId===id).map(row=>row.view.webContents),
  closePage:id=>{for(const row of [...global.host.tabs.values()].reverse())if(row.ownerId===id)global.host.closeTab(row.id);}
 });
 for(const method of ['identify','loginPageFailed']){const original=global.portal[method].bind(global.portal);global.portal[method]=async(...args)=>{global.events.push({stage:method,state:'start'});try{const value=await original(...args);global.events.push({stage:method,state:'complete'});return value;}catch(error){global.events.push({stage:method,state:'failed',code:error.message});throw error;}}}
 global.portal.sync=async()=>{};
 global.connection=global.portal.connect().then(()=>global.result={ok:true},error=>global.result={error:error.message});
});
`);
let app;
try{
 app=await electron.launch({executablePath:require('electron'),args:[entry],env:{...process.env,ELECTRON_RUN_AS_NODE:undefined}});await app.firstWindow();console.log('fixture: initial login');
 await until(async()=>app.evaluate(async()=>!!global.loginId&&await global.host.tab(global.loginId).view.webContents.executeJavaScript('!!document.querySelector("#login")')));
 const denied=await app.evaluate(async()=>{try{await global.host.request({action:'navigate',id:global.loginId,url:'http://example.invalid'});return false;}catch(error){return error.message==='browser_url_invalid';}});assert.equal(denied,true);
 await app.evaluate(async()=>global.host.tab(global.loginId).view.webContents.executeJavaScript('document.querySelector("#login").click()',true));
 await until(async()=>app.evaluate(()=>!!global.result));
 console.log('fixture: initial login completed');
 const result=await app.evaluate(({BrowserWindow})=>({result:global.result,events:global.events,status:global.portal.status(),tabs:[...global.host.tabs.keys()],other:global.other,windows:BrowserWindow.getAllWindows().length}));
 assert.deepEqual(result.result,{ok:true});assert.equal(result.status.connected,true);assert.deepEqual(result.tabs,[result.other],'only owned authentication tabs close');assert.equal(result.windows,2,'SSO does not create another native popup window');
 const requests=result.events.filter(e=>e.host==='sso.example.invalid');assert.deepEqual(requests,[{host:'sso.example.invalid',path:'/authenticate',method:'POST'}]);
 assert.ok(result.events.some(e=>e.host==='home.example.invalid'),'login begins at the configured home');
 assert.ok(result.events.some(e=>e.host==='mail.example.invalid'&&e.path.endsWith('/folders')),'the background reader verifies the mail API');
 // Replay the user's JS contract through the real Electron session: the mail profile has
 // no EP ID, the portal GET does, and approval list/body need exactly that ID and POST shape.
 const approval=await app.evaluate(async()=>{global.portal.identity={id:'owner@example.test',email:'owner@example.test'};const list=await global.portal.approvals();const title=await global.portal.approvalTitle(list.items[0]);const body=await global.portal.approvalRead(list.items[0]);return {list,title,text:body.mail.text,identity:global.portal.identity};});
 assert.equal(approval.list.items.length,1);assert.equal(approval.title.subject,'Fixture approval');assert.match(approval.text,/Verified approval body/);assert.equal(approval.identity.userId,'83421');assert(!JSON.stringify(approval).includes('fixture-token'));console.log('fixture: portal identity, approval list and body verified');
 let observedDialog;const keepDialog=page=>page.on('dialog',dialog=>{observedDialog=dialog;});for(const page of app.context().pages())keepDialog(page);app.context().on('page',keepDialog);
 for(const loginPath of ['abnormal-logout','abnormal-confirm','logout','native-expired','native-confirm']){
 console.log('fixture: expiry '+loginPath);
 await app.evaluate(async(_electron,loginPath)=>{await global.portal.disconnect();global.expire(loginPath);global.events=[];global.result=null;global.connection=global.portal.connect().then(()=>global.result={ok:true},error=>global.result={error:error.message});},loginPath);
 if(['abnormal-logout','abnormal-confirm','native-expired','native-confirm'].includes(loginPath)){
  await until(()=>app.evaluate(()=>global.host.tab(global.loginId).view.webContents.getURL()==='https://www.samsung.net/loginapp/login'));
 }else{
 if(loginPath==='native-expired'){
  await until(()=>app.evaluate(()=>global.dialogPending()));
 }else await until(()=>app.evaluate(()=>global.host.tab(global.loginId).view.webContents.executeJavaScript('!!document.querySelector("#confirm")')));
 await new Promise(resolve=>setTimeout(resolve,2300));
 const beforeConfirm=await app.evaluate(()=>({connecting:global.portal.status().connecting,result:global.result,guide:global.host.status().tabs.find(row=>row.id===global.loginId)?.mailLoginStage,requests:global.events.filter(row=>row.path?.startsWith('/mail/rest/'))}));
 if(loginPath==='native-expired')assert.equal(beforeConfirm.guide,'expired');
 assert.equal(beforeConfirm.connecting,true);assert.equal(beforeConfirm.result,null);assert.deepEqual(beforeConfirm.requests,[],'no forbidden API probe or tab closure while confirmation is waiting');
 // Other pages remain manual. Only the exact abnormal-logout expiry alert is automatic.
 // Use the Page session that observes the dialog; Playwright's separate CDP session may not own it.
 if(loginPath==='native-expired'){assert(observedDialog,'native alert remains available for the person');await app.evaluate(()=>global.host.tab(global.loginId).view.webContents.debugger.sendCommand('Page.handleJavaScriptDialog',{accept:true}));}
 else await app.evaluate(()=>global.host.tab(global.loginId).view.webContents.executeJavaScript('document.querySelector("#confirm").click()',true));
 }
 await until(async()=>app.evaluate(async(_electron,loginPath)=>{const contents=global.host.tab(global.loginId).view.webContents;return contents.getURL()==='https://www.samsung.net/loginapp/login'&&await contents.executeJavaScript('!!document.querySelector("#login")');},loginPath));
 console.log('fixture: awaiting login '+loginPath);
 // Let at least one connect poll run while the expired API would return 403.
 await new Promise(resolve=>setTimeout(resolve,2300));
 const waiting=await app.evaluate(()=>({connecting:global.portal.status().connecting,result:global.result,guide:global.host.status().tabs.find(row=>row.id===global.loginId)?.mailLoginStage,requests:global.events.filter(row=>row.path?.startsWith('/mail/rest/'))}));
 assert.equal(waiting.guide,'login');assert.equal(waiting.connecting,true);assert.equal(waiting.result,null);assert.deepEqual(waiting.requests,[],'no API probes while abnormal logout is awaiting user input');
 await app.evaluate(async()=>global.host.tab(global.loginId).view.webContents.executeJavaScript('document.querySelector("#login").click()',true));
 await until(async()=>app.evaluate(()=>!!global.result));
 console.log('fixture: recovered '+loginPath);
 const recovered=await app.evaluate(()=>({result:global.result,connected:global.portal.status().connected,tabs:[...global.host.tabs.keys()],other:global.other,events:global.events}));
 assert.deepEqual(recovered.result,{ok:true});assert.equal(recovered.connected,true);assert.deepEqual(recovered.tabs,[recovered.other]);
 assert.equal(recovered.events.filter(row=>row.host==='sso.example.invalid'&&row.method==='POST').length,1);
 assert.equal(recovered.events.filter(row=>row.action==='portalConnect').length,1);
 assert.equal(recovered.events.filter(row=>row.host==='www.samsung.net'&&row.path==='/loginapp/login').length,1,'expired-session confirmation advances exactly once');
 }
 console.log(JSON.stringify({passed:true,checks:['POST popup and opener preserved','same persistent session','verified background mail reader','portal-session EP ID fallback and approval list/body POST contract','no separate login popup','owned tab cleanup','HTTPS-only login navigation','abnormal-logout and portal-home expiry alert/confirm automatically advance to login; unrelated dialogs remain manual; no premature API probes','relogin restores mail through existing SSO flow'],boundary:'Local Electron with isolated mock HTTPS protocol; not company SSO or Windows verification.'}));
}catch(error){
 if(app)console.error('fixture failure state',await app.evaluate(()=>({result:global.result,status:global.portal?.status(),events:global.events,tabs:[...(global.host?.tabs.values()||[])].map(row=>({id:row.id,ownerId:row.ownerId,url:row.view.webContents.getURL(),loading:row.view.webContents.isLoadingMainFrame(),guide:global.host.status().tabs.find(tab=>tab.id===row.id)?.mailLoginStage}))})).catch(()=>({unavailable:true})));
 throw error;
}finally{await app?.close();await rm(temporary,{recursive:true,force:true});}
async function until(check){for(let i=0;i<150;i++){try{if(await check())return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error('portal fixture timed out');}
